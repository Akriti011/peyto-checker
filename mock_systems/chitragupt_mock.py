"""Fake Chitragupt (demo only). Behaves like the real portal's login:

  GET  /login              OLM ID + password form
  POST /login              correct password -> OTP page (pending cookie)
  GET  /otp                OTP form
  POST /otp                correct OTP -> session cookie -> /search
  GET  /search?lsi=...     HTML result page (browser / Playwright strategy)
  GET  /api/search?lsi=... JSON result (API strategy)

Demo login: any OLM ID, password "demo", OTP "123456" (IDs starting svc_ skip OTP).
Run:  python -m mock_systems.chitragupt_mock   (port 8101)
"""
import os, re, secrets
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from mock_systems.common import split

app = FastAPI(title="Fake Chitragupt (demo)")
CHIT, _ = split()
SESSIONS: dict[str, str] = {}          # session token -> OLM ID
PENDING: dict[str, str] = {}           # pending (password ok, OTP not yet) -> OLM ID
DEMO_PASSWORD = os.getenv("MOCK_CHITRAGUPT_PASSWORD", "demo")
DEMO_OTP = os.getenv("MOCK_OTP", "123456")

STYLE = """<style>body{font-family:Arial;margin:40px;background:#fafafa}
.bar{background:#7a1f2b;color:#fff;padding:10px 16px;margin:-40px -40px 30px}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 12px}
input{padding:6px;width:260px}.err{color:#b00}</style>"""
BAR = "<div class=bar>CHITRAGUPT &middot; DEMO COPY &middot; synthetic data</div>"


def _user(req: Request):
    return SESSIONS.get(req.cookies.get("chit_session", ""))


@app.get("/", response_class=HTMLResponse)
def home(req: Request):
    return RedirectResponse("/search" if _user(req) else "/login")


@app.get("/login", response_class=HTMLResponse)
def login_page(err: str = ""):
    msg = f"<p class=err>{err}</p>" if err else ""
    return f"""<html><head><title>Chitragupt login (DEMO)</title>{STYLE}</head><body>{BAR}{msg}
    <form method=post action=/login>
      <p><input name=username id=username placeholder="OLM ID"></p>
      <p><input name=password id=password type=password placeholder="Password"></p>
      <button id=login type=submit>Login</button></form></body></html>"""


@app.post("/login")
def do_login(username: str = Form(""), password: str = Form("")):
    if not username or password != DEMO_PASSWORD:
        return RedirectResponse("/login?err=Invalid+OLM+ID+or+password", status_code=303)
    tok = secrets.token_hex(12)
    if username.startswith("svc_"):            # service accounts have no OTP
        SESSIONS[tok] = username
        r = RedirectResponse("/search", status_code=303)
        r.set_cookie("chit_session", tok, httponly=True)
        return r
    PENDING[tok] = username
    r = RedirectResponse("/otp", status_code=303)
    r.set_cookie("chit_pending", tok, httponly=True)
    return r


@app.get("/otp", response_class=HTMLResponse)
def otp_page(req: Request, err: str = ""):
    if req.cookies.get("chit_pending") not in PENDING:
        return RedirectResponse("/login")
    msg = f"<p class=err>{err}</p>" if err else "<p>OTP sent to your registered mobile.</p>"
    return f"""<html><head><title>Chitragupt OTP (DEMO)</title>{STYLE}</head><body>{BAR}{msg}
    <form method=post action=/otp>
      <p><input name=otp id=otp inputmode=numeric placeholder="Enter OTP"></p>
      <button id=verify type=submit>Verify</button></form></body></html>"""


@app.post("/otp")
def do_otp(req: Request, otp: str = Form("")):
    pend = req.cookies.get("chit_pending", "")
    if pend not in PENDING:
        return RedirectResponse("/login?err=Session+expired", status_code=303)
    if not re.fullmatch(r"\d{4,8}", otp or "") or otp != DEMO_OTP:
        return RedirectResponse("/otp?err=Wrong+OTP", status_code=303)
    tok = secrets.token_hex(12)
    SESSIONS[tok] = PENDING.pop(pend)
    r = RedirectResponse("/search", status_code=303)
    r.set_cookie("chit_session", tok, httponly=True)
    r.delete_cookie("chit_pending")
    return r


@app.get("/search", response_class=HTMLResponse)
def search_page(req: Request, lsi: str = ""):
    user = _user(req)
    if not user:
        return RedirectResponse("/login")
    rows = ""
    if lsi:
        ckts = CHIT.get(lsi.strip(), [])
        rows = "".join(f"<tr><td>{lsi}</td><td>{c}</td><td>Active</td></tr>" for c in ckts) \
            or f"<tr><td colspan=3>No record found for {lsi}</td></tr>"
        rows = f"<table id=results><tr><th>LSI</th><th>Circuit ID</th><th>Status</th></tr>{rows}</table>"
    return f"""<html><head><title>Chitragupt search</title>{STYLE}</head><body>{BAR}
    <p>Logged in as <b>{user}</b></p>
    <form method=get action=/search><input type=search name=lsi id=lsi placeholder="Search LSI" value="{lsi}">
    <button id=go type=submit>Search</button></form><br>{rows}</body></html>"""


@app.get("/api/search")
def api_search(req: Request, lsi: str):
    if not _user(req):
        return JSONResponse({"error": "login required"}, status_code=401)
    ckts = CHIT.get(lsi.strip(), [])
    return {"lsi": lsi, "count": len(ckts), "records": [{"lsi": lsi, "circuit_id": c, "status": "Active"} for c in ckts]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("MOCK_HOST", "127.0.0.1"), port=int(os.getenv("MOCK_CHITRAGUPT_PORT", "8101")))
