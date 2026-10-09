"""Per-user login sessions for auth.mode = olm.

Flow (same in demo and live):
    1. user types OLM ID + password in the Peyto UI  -> start()
    2. Chitragupt sends an OTP, user types it        -> verify_otp()
    3. jobs run with this session: Chitragupt reuses the logged-in client,
       SSH to T3/T4 uses the same OLM ID + password
    4. logout / idle timeout / max age               -> everything wiped

Security: the password lives only in this process's memory, inside the
session object, and is dropped on logout or expiry. It is never logged,
never written to disk and never sent back to the browser.
"""
import secrets
import threading
import time
from dataclasses import dataclass, field

from . import chitragupt as chit_mod
from .base import ConnectorError
from .chitragupt import LOGGED_IN, OTP_REQUIRED


@dataclass
class UserSession:
    sid: str
    olm_id: str
    _password: str = field(repr=False)
    settings: object = field(repr=False)
    chitragupt: object = field(repr=False, default=None)
    created: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    ssh_status: str = "not_checked"          # not_checked | checking | ok | failed: ...
    busy: bool = False                       # a job is running with this session

    @property
    def state(self):
        return self.chitragupt.state if self.chitragupt else "logged_out"

    def job_settings(self):
        return self.settings.for_user(self.olm_id, self._password)

    def wipe(self):
        self._password = ""
        if self.chitragupt:
            try:
                self.chitragupt.close()
            except Exception:
                pass
        self.chitragupt = None


class SessionStore:
    def __init__(self, settings):
        self.s = settings
        a = settings.cfg.get("auth") or {}
        self.idle = a.get("idle_minutes", 60) * 60
        self.max_age = a.get("max_hours", 8) * 3600
        self._d: dict[str, UserSession] = {}
        self._lock = threading.Lock()

    # ---- lifecycle -----------------------------------------------------------
    def start(self, olm_id: str, password: str) -> UserSession:
        olm_id = (olm_id or "").strip()
        if not olm_id or not password:
            raise ConnectorError("Enter OLM ID and password")
        if len(olm_id) > 64 or not olm_id.replace("_", "").replace(".", "").replace("-", "").isalnum():
            raise ConnectorError("OLM ID looks wrong")
        sess = UserSession(secrets.token_urlsafe(24), olm_id, password, self.s, chit_mod.make(self.s))
        try:
            sess.chitragupt.start_login(olm_id, password)
        except Exception:
            sess.wipe()
            raise
        with self._lock:
            self._d[sess.sid] = sess
        if sess.state == LOGGED_IN:
            self._check_ssh(sess)
        return sess

    def verify_otp(self, sess: UserSession, otp: str):
        sess.chitragupt.submit_otp(otp)
        sess.last_used = time.time()
        if sess.state == LOGGED_IN:
            self._check_ssh(sess)
        return sess.state

    def get(self, sid: str | None) -> UserSession | None:
        if not sid:
            return None
        self.expire()
        with self._lock:
            sess = self._d.get(sid)
        return sess

    def touch(self, sess):
        sess.last_used = time.time()

    def end(self, sid: str | None):
        with self._lock:
            sess = self._d.pop(sid or "", None)
        if sess:
            sess.wipe()

    def expire(self):
        now = time.time()
        with self._lock:
            dead = [k for k, v in self._d.items() if not v.busy and
                    (now - v.last_used > self.idle or now - v.created > self.max_age)]
            gone = [self._d.pop(k) for k in dead]
        for v in gone:
            v.wipe()

    def info(self, sess: UserSession | None):
        if not sess:
            return {"logged_in": False, "state": "logged_out", "auth": self.s.auth_mode}
        now = time.time()
        left = min(self.idle - (now - sess.last_used), self.max_age - (now - sess.created))
        return {"logged_in": sess.state == LOGGED_IN, "state": sess.state, "olm_id": sess.olm_id,
                "auth": self.s.auth_mode, "expires_in_s": max(0, int(left)),
                "systems": {"chitragupt": "ok" if sess.state == LOGGED_IN else
                            ("otp" if sess.state == OTP_REQUIRED else "logged_out"),
                            "ssh": sess.ssh_status,
                            # same OLM login works for these too; wired up once their access route is known
                            "cfm": "not connected yet",
                            "nms": "export file" if self.s.cfg["nms"]["source"] == "export" else "nbi"}}

    # ---- SSH login check in the background (nodes can be slow) ----------------
    def _check_ssh(self, sess: UserSession):
        if not self.s.cfg["ssh"]["enabled"]:
            sess.ssh_status = "off"
            return
        sess.ssh_status = "checking"

        def run():
            from .ssh_lookup import SshCktFinder
            js = sess.job_settings()
            nodes = [n for t in js.cfg["ssh"]["tier_order"] for n in (js.ssh_nodes.get(t) or [])]
            if not nodes:
                sess.ssh_status = "failed: no T3/T4 nodes configured"
                return
            f = SshCktFinder(js)
            try:
                f._connect(nodes[0])
                sess.ssh_status = "ok"
            except Exception as e:
                sess.ssh_status = f"failed: {str(e)[:120]}"
            finally:
                f.close()

        threading.Thread(target=run, daemon=True).start()
