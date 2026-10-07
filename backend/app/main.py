"""FastAPI server: JSON API for the Angular UI + serves the built UI from ../frontend/dist."""
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from engine.data import Inventory, DATA_DIR
from engine import pipeline, report, rules

app = FastAPI(title="Peyto Checker POC", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:4200"], allow_methods=["*"], allow_headers=["*"])

INV = Inventory()
JOBS: dict[str, bytes] = {}          # in-memory for the POC
DEMO_SHEET = DATA_DIR / "demo_lsi_sheet.xlsx"


@app.get("/api/overview")
def overview():
    return {**INV.overview(), "rules": len(rules.RULE_CATALOG)}


@app.get("/api/rules")
def get_rules():
    cfg = pipeline.load_cfg()
    return {"rules": [{"id": i, "title": t, "ref": r} for i, t, r in rules.RULE_CATALOG], "config": cfg}


@app.get("/api/rings")
def get_rings():
    return [{"name": r.name, "kind": r.kind, "nodes": len(r.nodes), "peyto": r.peyto_routers,
             "alarms": sum(l["status"] != "OK" for l in r.links)} for r in INV.rings.values()]


@app.get("/api/rings/{name}")
def get_ring(name: str):
    r = INV.rings.get(name)
    if not r:
        raise HTTPException(404, "Ring not found")
    return {"name": r.name, "kind": r.kind, "nodes": r.nodes, "links": r.links}


@app.get("/api/demo-sheet")
def demo_sheet():
    return FileResponse(DEMO_SHEET, filename="demo_lsi_sheet.xlsx")


@app.post("/api/check")
async def check(file: UploadFile | None = File(None), demo: bool = Form(False)):
    if demo or file is None:
        data, name = DEMO_SHEET.read_bytes(), DEMO_SHEET.name
    else:
        data, name = await file.read(), file.filename or "sheet.xlsx"
    try:
        df, col, lsis = pipeline.read_lsis(data, name)
    except Exception as e:
        raise HTTPException(400, f"Could not read the sheet: {e}")
    if not lsis:
        raise HTTPException(400, "No LSI values found in the sheet")
    result = pipeline.run(lsis, INV)
    job = uuid.uuid4().hex[:10]
    JOBS[job] = report.build(df, result)
    return {"job_id": job, "file": name, "lsi_column": str(col), **result}


@app.get("/api/download/{job_id}")
def download(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Result expired, run the check again")
    return Response(JOBS[job_id], media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="peyto_result_{job_id}.xlsx"'})


# ---- serve the built Angular app (production mode) -------------------------
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "peyto-ui" / "browser"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets", check_dir=False), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
