"""Chitragupt connector: LSI -> CKT ID(s). Read-only, never changes anything.

Two strategies (config/connectors.yaml -> chitragupt.strategy):

  api      Calls the same URL the Chitragupt web page calls behind the scenes.
           Fast and stable. Find the URL once with F12 > Network while searching.
  browser  Drives a headless Chrome with Playwright, exactly like a person:
           login, type LSI, read the result. Use when there is no clean API.

Login is two-step, like the real portal:
    start_login(olm_id, password) -> "otp_required" | "logged_in"
    submit_otp(otp)               -> "logged_in"
In auth.mode = olm the user types OLM ID, password and OTP in the Peyto UI;
nothing is saved to disk. In auth.mode = service a service account from .env
logs in by itself (only works if that account has no OTP).
"""
import queue
import re
import threading
import time

import requests

from .base import ConfigError, ConnectorError, Lookup, extract_ckts


class LoginError(ConnectorError):
    """Wrong OLM ID / password / OTP. Shown to the user as-is."""


class SessionExpired(ConfigError):
    """Chitragupt logged us out. The user must log in again (OTP cannot be automated)."""


LOGGED_OUT, OTP_REQUIRED, LOGGED_IN = "logged_out", "otp_required", "logged_in"


class _Base:
    def __init__(self, s):
        self.s = s
        self.c = s.cfg["chitragupt"]
        self.lg = self.c["login"]
        self.otp = self.c.get("otp") or {}
        self.regex = s.cfg["ckt_id_regex"]
        self.state = LOGGED_OUT
        self.user = ""

    def _need_url(self):
        if not self.s.chitragupt_url:
            raise ConfigError("Chitragupt URL is not set (CHITRAGUPT_URL in .env)")

    def _ensure_login(self):
        """Service mode logs in by itself; OLM mode must already be logged in via the UI."""
        if self.state == LOGGED_IN:
            return
        if self.s.auth_mode == "service":
            if not self.s.chitragupt_user:
                raise ConfigError("CHITRAGUPT_USER is not set in .env")
            if self.start_login(self.s.chitragupt_user, self.s.chitragupt_pass) != LOGGED_IN:
                raise ConfigError("Service account is asking for OTP. Use auth.mode: olm instead")
            return
        raise SessionExpired("Not logged in to Chitragupt. Login with your OLM ID + OTP first")

    def _ms(self, t0):
        return round((time.perf_counter() - t0) * 1000, 1)


# --------------------------------------------------------------------------- API
class ChitraguptApi(_Base):
    def __init__(self, s):
        super().__init__(s)
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "PeytoChecker/1.0 (read-only automation)"
        self._otp_re = re.compile(self.otp.get("required_regex") or r"name=[\"']?otp\b", re.I)

    def _post(self, path, data):
        try:
            return self.http.post(self.s.chitragupt_url + path, data=data, timeout=self.c["timeout_seconds"])
        except requests.RequestException as e:
            raise ConnectorError(f"Chitragupt not reachable: {type(e).__name__}")

    def start_login(self, user, password):
        self._need_url()
        if not self.lg.get("path"):
            self.state, self.user = LOGGED_IN, user
            return self.state
        self.http.cookies.clear()
        r = self._post(self.lg["path"], {self.lg["username_field"]: user, self.lg["password_field"]: password})
        if r.status_code >= 500:
            raise ConnectorError(f"Chitragupt login error (HTTP {r.status_code})")
        failed = self.lg.get("failed_marker")
        if r.status_code in (401, 403) or (failed and failed.lower() in r.text.lower()):
            raise LoginError("Chitragupt: wrong OLM ID or password")
        self.user = user
        if self.otp.get("enabled", True) and (self._otp_re.search(r.text) or self.otp.get("path", "/otp") in r.url):
            self.state = OTP_REQUIRED
        elif self.lg["path"] in r.url:
            raise LoginError("Chitragupt: login did not go through (still on the login page)")
        else:
            self.state = LOGGED_IN
        return self.state

    def submit_otp(self, otp):
        if self.state != OTP_REQUIRED:
            raise LoginError("No OTP was requested. Start the login again")
        if not re.fullmatch(r"\d{4,8}", str(otp).strip()):
            raise LoginError("OTP should be 4-8 digits")
        r = self._post(self.otp.get("path", "/otp"), {self.otp.get("field", "otp"): str(otp).strip()})
        failed = self.otp.get("failed_marker")
        if r.status_code >= 400 or (failed and failed.lower() in r.text.lower()) or self._otp_re.search(r.text):
            raise LoginError("Chitragupt: wrong or expired OTP")
        if self.lg.get("path") and self.lg["path"] in r.url:
            self.state = LOGGED_OUT
            raise LoginError("Chitragupt: OTP step timed out, login again")
        self.state = LOGGED_IN
        return self.state

    def lookup(self, lsi: str) -> Lookup:
        self._need_url()
        t0 = time.perf_counter()
        self._ensure_login()
        url = self.s.chitragupt_url + self.c["api"]["search_path"].format(lsi=requests.utils.quote(lsi))
        try:
            r = self.http.get(url, timeout=self.c["timeout_seconds"], allow_redirects=False)
        except requests.RequestException as e:
            raise ConnectorError(f"Chitragupt search failed: {type(e).__name__}")
        if r.status_code in (401, 403) or (r.is_redirect and self.lg.get("path", "/login") in r.headers.get("location", "")):
            self.state = LOGGED_OUT
            raise SessionExpired("Chitragupt session expired. Login again with OLM ID + OTP")
        if r.status_code >= 500:
            raise ConnectorError(f"Chitragupt server error (HTTP {r.status_code})")
        if r.status_code >= 400:
            return Lookup("chitragupt", "error", note=f"HTTP {r.status_code}", ms=self._ms(t0))
        ckts = extract_ckts(r.text, self.regex)
        time.sleep(self.c.get("delay_between_searches", 0))
        return Lookup("chitragupt", "found" if ckts else "not_found", ckts,
                      note="" if ckts else "No CKT ID in Chitragupt", ms=self._ms(t0))

    def close(self):
        self.http.close()
        self.state = LOGGED_OUT


# --------------------------------------------------------------------------- browser
class _Worker:
    """Playwright objects must stay on the thread that made them. Every browser call
    is run on this one thread, whichever web request or job asks for it."""

    def __init__(self):
        self.q = queue.Queue()
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    def _loop(self):
        while True:
            fn, box, done = self.q.get()
            if fn is None:
                done.set()
                return
            try:
                box["ok"] = fn()
            except BaseException as e:      # pass the error back to the caller
                box["err"] = e
            done.set()

    def call(self, fn, timeout=120):
        box, done = {}, threading.Event()
        self.q.put((fn, box, done))
        if not done.wait(timeout):
            raise ConnectorError("Browser did not respond in time")
        if "err" in box:
            raise box["err"]
        return box.get("ok")

    def stop(self):
        done = threading.Event()
        self.q.put((None, None, done))
        done.wait(5)


class ChitraguptBrowser(_Base):
    """Headless Chrome. One login per session; every LSI reuses it."""

    def __init__(self, s):
        super().__init__(s)
        self.b = self.c["browser"]
        self._w = _Worker()
        self._pw = self._browser = self.page = None

    def _start(self):
        if self.page:
            return
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise ConfigError("Playwright is not installed (pip install playwright)")
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=True)
        self.page = self._browser.new_page()
        self.page.set_default_timeout(self.c["timeout_seconds"] * 1000)

    def _visible(self, sel):
        try:
            return bool(sel) and self.page.locator(sel).first.is_visible()
        except Exception:
            return False

    def start_login(self, user, password):
        self._need_url()

        def go():
            self._start()
            p = self.page
            try:
                p.goto(self.s.chitragupt_url + (self.lg.get("path") or ""))
                if not self._visible(self.b["username_selector"]):
                    return LOGGED_IN                       # no login form at all
                p.fill(self.b["username_selector"], user)
                p.fill(self.b["password_selector"], password)
                p.click(self.b["submit_selector"])
                p.wait_for_load_state("networkidle")
            except ConnectorError:
                raise
            except Exception as e:
                raise ConnectorError(f"Chitragupt login page error: {type(e).__name__}")
            if self.otp.get("enabled", True) and self._visible(self.b.get("otp_selector")):
                return OTP_REQUIRED
            if self._visible(self.b["username_selector"]):
                raise LoginError("Chitragupt: wrong OLM ID or password")
            return LOGGED_IN

        self.state = self._w.call(go)
        self.user = user
        return self.state

    def submit_otp(self, otp):
        if self.state != OTP_REQUIRED:
            raise LoginError("No OTP was requested. Start the login again")
        if not re.fullmatch(r"\d{4,8}", str(otp).strip()):
            raise LoginError("OTP should be 4-8 digits")

        def go():
            p = self.page
            try:
                p.fill(self.b["otp_selector"], str(otp).strip())
                p.click(self.b["otp_submit_selector"])
                p.wait_for_load_state("networkidle")
            except Exception as e:
                raise ConnectorError(f"Chitragupt OTP page error: {type(e).__name__}")
            if self._visible(self.b["otp_selector"]):
                raise LoginError("Chitragupt: wrong or expired OTP")
            if self._visible(self.b["username_selector"]):
                raise LoginError("Chitragupt: OTP step timed out, login again")
            return LOGGED_IN

        try:
            self.state = self._w.call(go)
        except LoginError as e:
            if "timed out" in str(e):
                self.state = LOGGED_OUT
            raise
        return self.state

    def lookup(self, lsi: str) -> Lookup:
        self._need_url()
        t0 = time.perf_counter()
        self._ensure_login()

        def go():
            p = self.page
            try:
                if self.b.get("search_page") and self.b["search_page"] not in p.url:
                    p.goto(self.s.chitragupt_url + self.b["search_page"])
                if self._visible(self.b["username_selector"]):
                    self.state = LOGGED_OUT
                    raise SessionExpired("Chitragupt session expired. Login again with OLM ID + OTP")
                box = p.locator(self.b["search_selector"]).first
                box.fill("")
                box.fill(lsi)
                if self.b.get("search_button_selector"):
                    p.locator(self.b["search_button_selector"]).first.click()
                else:
                    box.press("Enter")
                p.wait_for_load_state("networkidle")
                return p.locator("body").inner_text()
            except ConnectorError:
                raise
            except Exception as e:
                raise ConnectorError(f"Chitragupt page error: {type(e).__name__}")

        text = self._w.call(go)
        ckts = extract_ckts(text, self.regex)
        if ckts and lsi not in text:                 # stale page from the previous LSI
            return Lookup("chitragupt", "error", note="Result page did not show this LSI", ms=self._ms(t0))
        time.sleep(self.c.get("delay_between_searches", 0))
        return Lookup("chitragupt", "found" if ckts else "not_found", ckts,
                      note="" if ckts else "No CKT ID in Chitragupt", ms=self._ms(t0))

    def close(self):
        def go():
            for x in (self._browser,):
                try:
                    x and x.close()
                except Exception:
                    pass
            try:
                self._pw and self._pw.stop()
            except Exception:
                pass
            self._pw = self._browser = self.page = None
        try:
            self._w.call(go, timeout=15)
        except Exception:
            pass
        self._w.stop()
        self.state = LOGGED_OUT


def make(s):
    return ChitraguptBrowser(s) if s.cfg["chitragupt"]["strategy"] == "browser" else ChitraguptApi(s)
