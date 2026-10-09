"""FastAPI server: JSON API for the Angular UI + serves the built UI from ../frontend/dist.

Mode comes from PEYTO_MODE in .env (demo | live). In demo mode the fake
Chitragupt and fake T3/T4 nodes are started automatically inside this process.
"""
import logging, threading, time, uuid
from pathlib import Path

import pandas as pd
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from connectors import settings as settings_mod
from connectors.base import ConnectorError
from connectors.session import SessionStore
from engine.data import Inventory, DATA_DIR
from engine import pipeline, report, rules

log = logging.getLogger("peyto")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SETTINGS = settings_mod.load()
import sys as _sys
if str(settings_mod.ROOT) not in _sys.path:          # lets demo mode import mock_systems/
    _sys.path.insert(0, str(settings_mod.ROOT))
app = FastAPI(title="Peyto Checker", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"], allow_methods=["*"], allow_headers=["*"])

DEMO_SHEET = DATA_DIR / "demo_lsi_sheet.xlsx"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
RUN_LOCK = threading.Lock()          # one batch at a time: gentle on Chitragupt / nodes
MAX_JOBS = 20
INV: Inventory | None = None
INV_ERROR = ""
SESSIONS = SessionStore(SETTINGS)
COOKIE = "peyto_sid"
OLM = SETTINGS.auth_mode == "olm"


def load_inventory():
    global INV, INV_ERROR
    try:
        INV, INV_ERROR = Inventory(SETTINGS.nms_export_dir), ""
    except Exception as e:
        INV, INV_ERROR = None, str(e)
        log.warning("NMS export not loaded: %s", e)


def start_demo_systems():
    """Fake Chitragupt + fake T3/T4 nodes, only in demo mode."""
    import os
    if os.getenv("PEYTO_AUTOSTART_MOCKS", "1") != "1":
        return
    try:
        import uvicorn
        from mock_systems import ssh_node_mock
        from mock_systems.chitragupt_mock import app as chit_app
        ssh_node_mock.start_background()
        cfg = uvicorn.Config(chit_app, host="127.0.0.1", port=8101, log_level="warning")
        threading.Thread(target=uvicorn.Server(cfg).run, daemon=True).start()
        time.sleep(0.5)
        log.info("Demo systems started: fake Chitragupt :8101, fake T3 :2201, fake T4 :2202")
    except OSError as e:
        log.info("Demo systems already running? (%s)", e)
    except Exception as e:
        log.warning("Could not start demo systems: %s", e)


@app.on_event("startup")
def _startup():
    log.info("Peyto Checker starting in %s mode", SETTINGS.mode.upper())
    if SETTINGS.is_demo:
        start_demo_systems()
    load_inventory()


# ---------------------------------------------------------------- info
@app.get("/api/health")
def health():
    return {"ok": True, "version": app.version, **SETTINGS.public(),
            "nms_loaded": INV is not None, "nms_error": INV_ERROR,
            "demo_login_hint": "Any OLM ID · password demo · OTP 123456" if SETTINGS.is_demo and OLM else ""}


# ---------------------------------------------------------------- OLM login (auth.mode = olm)
def _sess(request: Request):
    return SESSIONS.get(request.cookies.get(COOKIE))


def _require_session(request: Request):
    """olm mode: the caller must be logged in. service mode: no session needed."""
    if not OLM:
        return None
    sess = _sess(request)
    if not sess or sess.state != "logged_in":
        raise HTTPException(401, "Login with your OLM ID + OTP first")
    SESSIONS.touch(sess)
    return sess


def _login_error(e):
    return JSONResponse({"detail": str(e)}, status_code=401 if "wrong" in str(e).lower() or "olm" in str(e).lower()
                        else 502)


@app.get("/api/auth/session")
def auth_session(request: Request):
    return SESSIONS.info(_sess(request))


@app.post("/api/auth/login")
def auth_login(request: Request, body: dict = Body(...)):
    if not OLM:
        raise HTTPException(400, "Login is not needed: this server uses service accounts")
    SESSIONS.end(request.cookies.get(COOKIE))           # one login per browser
    try:
        sess = SESSIONS.start(body.get("olm_id", ""), body.get("password", ""))
    except ConnectorError as e:
        return _login_error(e)
    log.info("login started for %s (%s)", sess.olm_id, sess.state)
    r = JSONResponse(SESSIONS.info(sess))
    r.set_cookie(COOKIE, sess.sid, httponly=True, samesite="lax", max_age=SESSIONS.max_age)
    return r


@app.post("/api/auth/otp")
def auth_otp(request: Request, body: dict = Body(...)):
    sess = _sess(request)
    if not sess:
        raise HTTPException(401, "Login expired, enter OLM ID and password again")
    try:
        SESSIONS.verify_otp(sess, str(body.get("otp", "")))
    except ConnectorError as e:
        return _login_error(e)
    log.info("login complete for %s", sess.olm_id)
    return SESSIONS.info(sess)


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    SESSIONS.end(request.cookies.get(COOKIE))
    r = JSONResponse({"logged_in": False, "state": "logged_out", "auth": SETTINGS.auth_mode})
    r.delete_cookie(COOKIE)
    return r


@app.get("/api/preflight")
def preflight(request: Request, lsi: str = ""):
    """Read-only connectivity check of every system (same as python -m connectors.preflight)."""
    from connectors import preflight as pf
    sess = _sess(request) if OLM else None
    if sess and sess.state == "logged_in":
        res = pf.run(sess.job_settings(), lsi or None, chitragupt_client=sess.chitragupt)
    else:
        res = pf.run(SETTINGS, lsi or None)
    return {"mode": SETTINGS.mode, "passed": sum(r["ok"] for r in res), "total": len(res), "checks": res}


@app.get("/api/overview")
def overview():
    base = INV.overview() if INV else {"rings": 0, "nodes": 0, "peyto_routers": 0, "services": 0, "lsis": 0,
                                        "alarmed_links": 0}
    return {**base, "rules": len(rules.RULE_CATALOG), "mode": SETTINGS.mode}


@app.get("/api/rules")
def get_rules():
    cfg = pipeline.load_cfg()
    return {"rules": [{"id": i, "title": t, "ref": r} for i, t, r in rules.RULE_CATALOG], "config": cfg}


@app.get("/api/rings")
def get_rings():
    if not INV:
        return []
    return [{"name": r.name, "kind": r.kind, "nodes": len(r.nodes), "peyto": r.peyto_routers,
             "alarms": sum(l["status"] != "OK" for l in r.links)} for r in INV.rings.values()]


@app.get("/api/rings/{name}")
def get_ring(name: str):
    r = INV.rings.get(name) if INV else None
    if not r:
        raise HTTPException(404, "Ring not found")
    return {"name": r.name, "kind": r.kind, "nodes": r.nodes, "links": r.links}


# ---------------------------------------------------------------- demo sheet
def _demo_sheet_bytes():
    """Demo mode: LSIs that exercise every path (Chitragupt hit, SSH fallback, unknown)."""
    try:
        from mock_systems.common import demo_lsis
        df = pd.DataFrame({"S.No": range(1, len(demo_lsis()) + 1), "LSI": demo_lsis(),
                           "Peyto Feasibility": [""] * len(demo_lsis())})
        import io
        b = io.BytesIO(); df.to_excel(b, index=False)
        return b.getvalue(), "demo_lsi_sheet.xlsx"
    except Exception:
        return DEMO_SHEET.read_bytes(), DEMO_SHEET.name


@app.get("/api/demo-sheet")
def demo_sheet():
    data, name = _demo_sheet_bytes()
    return Response(data, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- NMS export upload (semi-automatic live mode)
@app.post("/api/nms-export")
async def upload_nms_export(files: list[UploadFile] = File(...)):
    if SETTINGS.is_demo:
        raise HTTPException(400, "Demo mode uses built-in sample NMS data")
    SETTINGS.nms_export_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        name = Path(f.filename or "").name
        if not name.lower().endswith((".csv", ".xlsx", ".xls")):
            raise HTTPException(400, f"{name}: only CSV / Excel files")
        (SETTINGS.nms_export_dir / name).write_bytes(await f.read())
        saved.append(name)
    load_inventory()
    return {"saved": saved, "nms_loaded": INV is not None, "nms_error": INV_ERROR}


@app.post("/api/nms-export/reload")
def reload_nms():
    load_inventory()
    return {"nms_loaded": INV is not None, "nms_error": INV_ERROR}


# ---------------------------------------------------------------- jobs
async def _read_upload(file, demo):
    if demo or file is None:
        data, name = _demo_sheet_bytes()
    else:
        data, name = await file.read(), file.filename or "sheet.xlsx"
    try:
        df, col, lsis = pipeline.read_lsis(data, name)
    except Exception as e:
        raise HTTPException(400, f"Could not read the sheet: {e}")
    if not lsis:
        raise HTTPException(400, "No LSI values found in the sheet")
    if INV is None:
        raise HTTPException(503, f"NMS data not loaded: {INV_ERROR}")
    return df, col, lsis, name


def _run_job(job_id, df, lsis, sess=None):
    job = JOBS[job_id]

    def progress(done, total, lsi, new_rows):
        with JOBS_LOCK:
            job.update(done=done, current=lsi)
            job["rows"].extend(new_rows)

    with RUN_LOCK:
        job["status"] = "running"
        conn = None
        if sess:
            sess.busy = True
        try:
            if sess:
                conn = pipeline.Connections(sess.job_settings(), INV, chitragupt_client=sess.chitragupt)
            else:
                conn = pipeline.Connections(SETTINGS, INV)
            result = pipeline.run(lsis, conn, progress=progress)
            who = f"{SETTINGS.mode} · run by {sess.olm_id}" if sess else SETTINGS.mode
            job["xlsx"] = report.build(df, result, who)
            with JOBS_LOCK:
                job.update(status="done", summary=result["summary"], rows=result["rows"], current="",
                           alerts=result.get("alerts", []))
            log.info("job %s done: %s", job_id, result["summary"])
        except Exception as e:
            log.exception("job %s failed", job_id)
            job.update(status="error", error=f"{type(e).__name__}: {e}")
        finally:
            if conn:
                conn.close()
            if sess:
                sess.busy = False
                SESSIONS.touch(sess)


def _new_job(name, col, lsis, sess=None):
    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        if len(JOBS) >= MAX_JOBS:
            for k in sorted(JOBS, key=lambda k: JOBS[k]["created"])[: len(JOBS) - MAX_JOBS + 1]:
                JOBS.pop(k, None)
        JOBS[job_id] = {"job_id": job_id, "file": name, "lsi_column": str(col), "status": "queued", "total": len(lsis),
                        "done": 0, "current": "", "rows": [], "summary": None, "error": "", "created": time.time(),
                        "mode": SETTINGS.mode, "alerts": [], "owner": sess.sid if sess else "",
                        "olm_id": sess.olm_id if sess else ""}
    return job_id


def _public(job, since=0):
    j = {k: v for k, v in job.items() if k not in ("xlsx", "rows", "owner")}
    j["rows"] = job["rows"][since:]
    j["row_offset"] = since
    return j


def _own_job(request, job_id):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (server restarted?)")
    if OLM and job.get("owner") and job["owner"] != request.cookies.get(COOKIE):
        raise HTTPException(403, "This result belongs to another user")
    return job


@app.post("/api/jobs")
async def create_job(request: Request, file: UploadFile | None = File(None), demo: bool = Form(False)):
    sess = _require_session(request)
    df, col, lsis, name = await _read_upload(file, demo)
    job_id = _new_job(name, col, lsis, sess)
    threading.Thread(target=_run_job, args=(job_id, df, lsis, sess), daemon=True).start()
    return {"job_id": job_id, "total": len(lsis)}


@app.get("/api/jobs/{job_id}")
def get_job(request: Request, job_id: str, since: int = 0):
    job = _own_job(request, job_id)
    with JOBS_LOCK:
        return _public(job, since)


@app.post("/api/check")
async def check(request: Request, file: UploadFile | None = File(None), demo: bool = Form(False)):
    """Synchronous version (scripts / old UI): waits for the whole batch."""
    sess = _require_session(request)
    df, col, lsis, name = await _read_upload(file, demo)
    job_id = _new_job(name, col, lsis, sess)
    import anyio
    await anyio.to_thread.run_sync(_run_job, job_id, df, lsis, sess)
    job = JOBS[job_id]
    if job["status"] != "done":
        raise HTTPException(500, job["error"])
    return {"job_id": job_id, "file": name, "lsi_column": str(col), "mode": SETTINGS.mode,
            "summary": job["summary"], "rows": job["rows"]}


@app.get("/api/download/{job_id}")
def download(request: Request, job_id: str):
    job = _own_job(request, job_id)
    if "xlsx" not in job:
        raise HTTPException(404, "Result expired, run the check again")
    return Response(job["xlsx"], media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="peyto_result_{job_id}.xlsx"'})


# ---- serve the built Angular app (production mode) -------------------------
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "peyto-ui" / "browser"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets", check_dir=False), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
