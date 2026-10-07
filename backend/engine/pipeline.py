"""LSI sheet in -> results out. Pure Python, no web code, so it can also run from a script or cron."""
import io, re, time
from pathlib import Path
import pandas as pd
import yaml

from .data import Inventory
from . import feasibility, rules

CFG_PATH = Path(__file__).resolve().parent.parent / "config" / "rules.yaml"


def load_cfg():
    return yaml.safe_load(CFG_PATH.read_text())


def read_lsis(file_bytes: bytes, filename: str = "sheet.xlsx"):
    """Find the LSI column (header containing 'LSI'), fall back to the first column."""
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes), dtype=str)
    else:
        df = pd.read_excel(io.BytesIO(file_bytes), dtype=str)
    df = df.fillna("")
    col = next((c for c in df.columns if "lsi" in str(c).lower()), df.columns[0])
    seen, lsis = set(), []
    for v in df[col]:
        v = re.sub(r"\.0$", "", str(v).strip())
        if v and v not in seen:
            seen.add(v); lsis.append(v)
    return df, col, lsis


def run(lsis, inv: Inventory | None = None, cfg=None):
    t0 = time.perf_counter()
    inv = inv or Inventory()
    cfg = cfg or load_cfg()
    labels = cfg["feasibility_labels"]
    rows = []
    for lsi in lsis:
        svcs = inv.ckts_for_lsi(lsi)
        if not svcs:
            rows.append({"lsi": lsi, "ckt_id": "", "status": "not_found", "label": labels["not_found"],
                         "reason": "No service found with this LSI in the Customer field",
                         "ring": "", "customer_mux": "", "service_type": "", "paths": [], "checks": [],
                         "design_ok": None})
            continue
        for s in svcs:
            ring = inv.rings.get(s["ring"])
            f = feasibility.check(ring, s["customer_mux"], labels)
            checks = rules.run(s, inv.tunnels_for(s["ckt_id"]), cfg)
            rows.append({"lsi": lsi, "ckt_id": s["ckt_id"], "service_type": s["service_type"],
                         "ring": s["ring"], "customer_mux": s["customer_mux"], **f,
                         "checks": checks, "design_ok": all(c["ok"] for c in checks)})
    summary = {
        "lsis": len(lsis),
        "ckts": sum(1 for r in rows if r["ckt_id"]),
        "protected": sum(r["status"] == "protected" for r in rows),
        "unprotected": sum(r["status"] == "unprotected" for r in rows),
        "not_feasible": sum(r["status"] == "not_feasible" for r in rows),
        "not_found": sum(r["status"] == "not_found" for r in rows),
        "design_issues": sum(r["design_ok"] is False for r in rows),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
    return {"summary": summary, "rows": rows}
