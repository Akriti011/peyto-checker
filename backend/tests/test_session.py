"""OLM login + OTP flow against the fake Chitragupt (started on a free port)."""
import socket
import sys
import threading
import time

import pytest
import uvicorn

from connectors import settings as settings_mod
from connectors.base import ConnectorError
from connectors.chitragupt import LoginError, SessionExpired, ChitraguptApi
from connectors.session import SessionStore

sys.path.insert(0, str(settings_mod.ROOT))
from mock_systems.chitragupt_mock import app as mock_app  # noqa: E402


@pytest.fixture(scope="module")
def portal():
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0))
        port = so.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(mock_app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(50):
        if srv.started:
            break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True


@pytest.fixture
def s(portal, monkeypatch):
    monkeypatch.setenv("PEYTO_MODE", "demo")      # tests never depend on your own .env
    monkeypatch.setenv("PEYTO_AUTH", "olm")
    st = settings_mod.load()
    st.chitragupt_url = portal
    st.cfg = {**st.cfg, "chitragupt": {**st.cfg["chitragupt"], "delay_between_searches": 0},
              "ssh": {**st.cfg["ssh"], "enabled": False}}
    return st


def test_otp_flow_then_search(s):
    c = ChitraguptApi(s)
    with pytest.raises(SessionExpired):
        c.lookup("4398937")                       # olm mode: no auto login
    assert c.start_login("B0123456", "demo") == "otp_required"
    with pytest.raises(LoginError):
        c.submit_otp("000000")
    assert c.state == "otp_required"              # can retry after a wrong OTP
    assert c.submit_otp("123456") == "logged_in"
    assert c.lookup("4398937").ckt_ids == ["SIFY-T1843438", "SIFY-T1843438_Peyto"]


def test_wrong_password(s):
    with pytest.raises(LoginError):
        ChitraguptApi(s).start_login("B0123456", "nope")


def test_otp_format_checked(s):
    c = ChitraguptApi(s)
    c.start_login("B0123456", "demo")
    with pytest.raises(LoginError):
        c.submit_otp("12ab")


def test_portal_logout_is_detected(s):
    c = ChitraguptApi(s)
    c.start_login("B0123456", "demo")
    c.submit_otp("123456")
    c.http.cookies.clear()                        # portal forgot us
    with pytest.raises(SessionExpired):
        c.lookup("4398937")
    assert c.state == "logged_out"


def test_service_mode_logs_in_by_itself(s):
    s.cfg = {**s.cfg, "auth": {**s.cfg["auth"], "mode": "service"}}
    c = ChitraguptApi(s)                          # demo service account svc_demo has no OTP
    assert c.lookup("4398937").found


def test_session_store_wipes_password(s):
    st = SessionStore(s)
    sess = st.start("B0123456", "demo")
    assert sess.state == "otp_required" and not st.info(sess)["logged_in"]
    st.verify_otp(sess, "123456")
    info = st.info(sess)
    assert info["logged_in"] and info["olm_id"] == "B0123456"
    assert "demo" not in str(info)                # password never leaves memory
    assert sess.job_settings().ssh_user == "B0123456"
    st.end(sess.sid)
    assert sess._password == "" and st.get(sess.sid) is None


def test_session_idle_timeout(s):
    st = SessionStore(s)
    sess = st.start("B0123456", "demo")
    sess.last_used -= st.idle + 1
    assert st.get(sess.sid) is None and sess._password == ""


def test_bad_olm_id_rejected(s):
    with pytest.raises(ConnectorError):
        SessionStore(s).start("abc; rm -rf", "demo")
