"""Fake Chitragupt (demo only). Looks and behaves like a simple inventory portal:

  GET  /login              login form
  POST /login              username + password -> session cookie
  GET  /search?lsi=...     HTML result page (for the browser / Playwright strategy)
  GET  /api/search?lsi=... JSON result (for the API strategy)

Demo login: any username, password "demo".
Run:  python -m mock_systems.chitragupt_mock   (port 8101)
"""
import os, secrets
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from mock_systems.common import split

app = FastAPI(title="Fake Chitragupt (demo)")
CHIT, _ = split()
SESSIONS: set[str] = set()
DEMO_PASSWORD = os.getenv("MOCK_CHITRAGUPT_PASSWORD", "demo")

STYLE = """<style>body{font-family:Arial;margin:40px;background:#fafafa}
.bar{background:#7a1f2b;color:#fff;padding:10px 16px;margin:-40px -40px 30px}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 12px}
input{padding:6px;width:260px}</style>"""


def _authed(req: Request):
    return req.cookies.get("chit_session") in SESSIONS


@app.get("/", response_class=HTMLResponse)
def home(req: Request):
    return RedirectResponse("/search" if _authed(req) else "/login")


@app.get("/login", response_class=HTMLResponse)
def login_page():
    return f"""<html><head><title>Chitragupt (DEMO)</title>{STYLE}</head><body>
    <div class=bar>CHITRAGUPT &middot; DEMO COPY &middot; synthetic data</div>
    <form method=post action=/login>
      <p><input name=username id=username placeholder="User ID"></p>
      <p><input name=password id=password type=password placeholder="Password"></p>
      <button id=login type=submit>Login</button></form></body></html>"""


@app.post("/login")
def do_login(username: str = Form(...), password: str = Form(...)):
    if not username or password != DEMO_PASSWORD:
        return HTMLResponse("Invalid credentials", status_code=401)
    tok = secrets.token_hex(12)
    SESSIONS.add(tok)
    r = RedirectResponse("/search", status_code=303)
    r.set_cookie("chit_session", tok, httponly=True)
    return r


@app.get("/search", response_class=HTMLResponse)
def search_page(req: Request, lsi: str = ""):
    if not _authed(req):
        return RedirectResponse("/login")
    rows = ""
    if lsi:
        ckts = CHIT.get(lsi.strip(), [])
        rows = "".join(f"<tr><td>{lsi}</td><td>{c}</td><td>Active</td></tr>" for c in ckts) \
            or f"<tr><td colspan=3>No record found for {lsi}</td></tr>"
        rows = f"<table id=results><tr><th>LSI</th><th>Circuit ID</th><th>Status</th></tr>{rows}</table>"
    return f"""<html><head><title>Chitragupt search</title>{STYLE}</head><body>
    <div class=bar>CHITRAGUPT &middot; DEMO COPY</div>
    <form method=get action=/search><input type=search name=lsi id=lsi placeholder="Search LSI" value="{lsi}">
    <button id=go type=submit>Search</button></form><br>{rows}</body></html>"""


@app.get("/api/search")
def api_search(req: Request, lsi: str):
    if not _authed(req):
        return JSONResponse({"error": "login required"}, status_code=401)
    ckts = CHIT.get(lsi.strip(), [])
    return {"lsi": lsi, "count": len(ckts), "records": [{"lsi": lsi, "circuit_id": c, "status": "Active"} for c in ckts]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("MOCK_HOST", "127.0.0.1"), port=int(os.getenv("MOCK_CHITRAGUPT_PORT", "8101")))
