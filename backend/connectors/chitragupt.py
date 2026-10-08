"""Chitragupt connector: LSI -> CKT ID(s). Read-only, never changes anything.

Two strategies (pick in config/connectors.yaml -> chitragupt.strategy):

  api      Calls the same URL the Chitragupt web page calls behind the scenes.
           Fast and stable. Find the URL once with F12 > Network while searching.
  browser  Drives a headless Chrome with Playwright, exactly like a person:
           login, type LSI, read the result. Use only if there is no clean API.

Both log in with a READ-ONLY service account from .env, never a personal ID.
"""
import time

import requests

from .base import ConfigError, ConnectorError, Lookup, extract_ckts


class ChitraguptApi:
    def __init__(self, s):
        self.s = s
        self.c = s.cfg["chitragupt"]
        self.regex = s.cfg["ckt_id_regex"]
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "PeytoChecker/1.0 (read-only automation)"
        self.logged_in = False

    def _login(self):
        path = self.c["login"]["path"]
        if not path or self.logged_in:
            return
        if not self.s.chitragupt_user:
            raise ConfigError("CHITRAGUPT_USER is not set in .env")
        lg = self.c["login"]
        try:
            r = self.http.post(self.s.chitragupt_url + path, timeout=self.c["timeout_seconds"],
                               data={lg["username_field"]: self.s.chitragupt_user,
                                     lg["password_field"]: self.s.chitragupt_pass})
        except requests.RequestException as e:
            raise ConnectorError(f"Chitragupt not reachable: {type(e).__name__}")
        if r.status_code >= 400:
            raise ConnectorError(f"Chitragupt login failed (HTTP {r.status_code})")
        self.logged_in = True

    def lookup(self, lsi: str) -> Lookup:
        if not self.s.chitragupt_url:
            raise ConfigError("Chitragupt URL is not set (CHITRAGUPT_URL in .env)")
        t0 = time.perf_counter()
        self._login()
        url = self.s.chitragupt_url + self.c["api"]["search_path"].format(lsi=requests.utils.quote(lsi))
        try:
            r = self.http.get(url, timeout=self.c["timeout_seconds"])
            if r.status_code == 401:                 # session expired -> log in again once
                self.logged_in = False
                self._login()
                r = self.http.get(url, timeout=self.c["timeout_seconds"])
        except requests.RequestException as e:
            raise ConnectorError(f"Chitragupt search failed: {type(e).__name__}")
        if r.status_code >= 500:
            raise ConnectorError(f"Chitragupt server error (HTTP {r.status_code})")
        if r.status_code >= 400:
            return Lookup("chitragupt", "error", note=f"HTTP {r.status_code}", ms=_ms(t0))
        ckts = extract_ckts(r.text, self.regex)
        time.sleep(self.c.get("delay_between_searches", 0))
        return Lookup("chitragupt", "found" if ckts else "not_found", ckts,
                      note="" if ckts else "No CKT ID in Chitragupt", ms=_ms(t0))

    def close(self):
        self.http.close()


class ChitraguptBrowser:
    """Headless Chrome. One login per batch; the session is reused for every LSI."""

    def __init__(self, s):
        self.s = s
        self.c = s.cfg["chitragupt"]
        self.b = self.c["browser"]
        self.regex = s.cfg["ckt_id_regex"]
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
        timeout = self.c["timeout_seconds"] * 1000
        self.page.set_default_timeout(timeout)
        try:
            self.page.goto(self.s.chitragupt_url + self.c["login"]["path"])
            if self.b.get("username_selector") and self.page.locator(self.b["username_selector"]).count():
                self.page.fill(self.b["username_selector"], self.s.chitragupt_user)
                self.page.fill(self.b["password_selector"], self.s.chitragupt_pass)
                self.page.click(self.b["submit_selector"])
                self.page.wait_for_load_state("networkidle")
        except Exception as e:
            self.close()
            raise ConnectorError(f"Chitragupt login (browser) failed: {type(e).__name__}")

    def lookup(self, lsi: str) -> Lookup:
        if not self.s.chitragupt_url:
            raise ConfigError("Chitragupt URL is not set (CHITRAGUPT_URL in .env)")
        t0 = time.perf_counter()
        self._start()
        p = self.page
        try:
            if self.b.get("search_page") and self.b["search_page"] not in p.url:
                p.goto(self.s.chitragupt_url + self.b["search_page"])
            box = p.locator(self.b["search_selector"]).first
            box.fill("")
            box.fill(lsi)
            if self.b.get("search_button_selector"):
                p.locator(self.b["search_button_selector"]).first.click()
            else:
                box.press("Enter")
            p.wait_for_load_state("networkidle")
            text = p.locator("body").inner_text()
        except Exception as e:
            raise ConnectorError(f"Chitragupt page error: {type(e).__name__}")
        ckts = extract_ckts(text, self.regex)
        if ckts and lsi not in text:                 # stale page from the previous LSI
            return Lookup("chitragupt", "error", note="Result page did not show this LSI", ms=_ms(t0))
        time.sleep(self.c.get("delay_between_searches", 0))
        return Lookup("chitragupt", "found" if ckts else "not_found", ckts,
                      note="" if ckts else "No CKT ID in Chitragupt", ms=_ms(t0))

    def close(self):
        if self._browser:
            try:
                self._browser.close()
            except Exception:
                pass
        if self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass
        self._pw = self._browser = self.page = None


def make(s):
    return ChitraguptBrowser(s) if s.cfg["chitragupt"]["strategy"] == "browser" else ChitraguptApi(s)


def _ms(t0):
    return round((time.perf_counter() - t0) * 1000, 1)
