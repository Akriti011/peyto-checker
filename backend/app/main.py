"""FastAPI server: JSON API for the Angular UI + serves the built UI from ../frontend/dist.

Mode comes from PEYTO_MODE in .env (demo | live). In demo mode the fake
Chitragupt and fake T3/T4 nodes are started automatically inside this process.
"""
import logging, threading, time, uuid
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from connectors import settings as settings_mod
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
            "nms_loaded": INV is not None, "nms_error": INV_ERROR}


@app.get("/api/preflight")
def preflight(lsi: str = ""):
    """Read-only connectivity check of every system (same as python -m connectors.preflight)."""
    from connectors import preflight as pf
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


def _run_job(job_id, df, lsis):
    job = JOBS[job_id]

    def progress(done, total, lsi, new_rows):
        with JOBS_LOCK:
            job.update(done=done, current=lsi)
            job["rows"].extend(new_rows)

    with RUN_LOCK:
        job["status"] = "running"
        conn = None
        try:
            conn = pipeline.Connections(SETTINGS, INV)
            result = pipeline.run(lsis, conn, progress=progress)
            job["xlsx"] = report.build(df, result, SETTINGS.mode)
            with JOBS_LOCK:
                job.update(status="done", summary=result["summary"], rows=result["rows"], current="")
            log.info("job %s done: %s", job_id, result["summary"])
        except Exception as e:
            log.exception("job %s failed", job_id)
            job.update(status="error", error=f"{type(e).__name__}: {e}")
        finally:
            if conn:
                conn.close()


def _new_job(name, col, lsis):
    job_id = uuid.uuid4().hex[:10]
    with JOBS_LOCK:
        if len(JOBS) >= MAX_JOBS:
            for k in sorted(JOBS, key=lambda k: JOBS[k]["created"])[: len(JOBS) - MAX_JOBS + 1]:
                JOBS.pop(k, None)
        JOBS[job_id] = {"job_id": job_id, "file": name, "lsi_column": str(col), "status": "queued", "total": len(lsis),
                        "done": 0, "current": "", "rows": [], "summary": None, "error": "", "created": time.time(),
                        "mode": SETTINGS.mode}
    return job_id


def _public(job, since=0):
    j = {k: v for k, v in job.items() if k not in ("xlsx", "rows")}
    j["rows"] = job["rows"][since:]
    j["row_offset"] = since
    return j


@app.post("/api/jobs")
async def create_job(file: UploadFile | None = File(None), demo: bool = Form(False)):
    df, col, lsis, name = await _read_upload(file, demo)
    job_id = _new_job(name, col, lsis)
    threading.Thread(target=_run_job, args=(job_id, df, lsis), daemon=True).start()
    return {"job_id": job_id, "total": len(lsis)}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, since: int = 0):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (server restarted?)")
    with JOBS_LOCK:
        return _public(job, since)


@app.post("/api/check")
async def check(file: UploadFile | None = File(None), demo: bool = Form(False)):
    """Synchronous version (scripts / old UI): waits for the whole batch."""
    df, col, lsis, name = await _read_upload(file, demo)
    job_id = _new_job(name, col, lsis)
    _run_job(job_id, df, lsis)
    job = JOBS[job_id]
    if job["status"] != "done":
        raise HTTPException(500, job["error"])
    return {"job_id": job_id, "file": name, "lsi_column": str(col), "mode": SETTINGS.mode,
            "summary": job["summary"], "rows": job["rows"]}


@app.get("/api/download/{job_id}")
def download(job_id: str):
    job = JOBS.get(job_id)
    if not job or "xlsx" not in job:
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
