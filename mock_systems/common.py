"""Shared demo data for the fake Airtel systems.

Everything here is SYNTHETIC. It is built from backend/sample_data/services.csv
(the demo NMS export), so the three fake systems always agree with each other:

  * Fake Chitragupt knows LSI -> CKT ID for most LSIs
  * The last N LSIs are deliberately "missing" in Chitragupt and are only
    findable by logging into a fake T3 / T4 MPLS node over SSH (the PuTTY step)
  * DEMO_UNKNOWN_LSI exists nowhere, so the UI shows a "manual check" row
"""
from pathlib import Path
import csv

ROOT = Path(__file__).resolve().parent.parent
SERVICES = ROOT / "backend" / "sample_data" / "services.csv"
MISSING_IN_CHITRAGUPT = 2          # how many LSIs only the SSH nodes know
DEMO_UNKNOWN_LSI = "9999999"


def _load():
    by_lsi = {}
    with SERVICES.open(newline="") as f:
        for row in csv.DictReader(f):
            lsi = (row.get("lsi") or "").strip()
            if lsi:
                by_lsi.setdefault(lsi, []).append(row["ckt_id"].strip())
    return by_lsi


def split():
    """-> (chitragupt_map, {"T3": map, "T4": map})"""
    by_lsi = _load()
    lsis = list(by_lsi)
    hidden = lsis[-MISSING_IN_CHITRAGUPT:] if len(lsis) > MISSING_IN_CHITRAGUPT else []
    chit = {l: c for l, c in by_lsi.items() if l not in hidden}
    nodes = {"T3": {}, "T4": {}}
    for i, l in enumerate(hidden):
        nodes["T3" if i % 2 == 0 else "T4"][l] = by_lsi[l]
    return chit, nodes


def demo_lsis():
    """LSI list for the demo upload sheet, including one unknown LSI."""
    return list(_load()) + [DEMO_UNKNOWN_LSI]
