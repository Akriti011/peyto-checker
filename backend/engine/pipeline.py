"""LSI sheet in -> results out. Pure Python, no web code, so it can also run from a script or cron.

Per LSI:
  1. Chitragupt             LSI -> CKT ID(s)
  2. SSH fallback (PuTTY)   only if Chitragupt had nothing: T3 / T4 MPLS nodes
  3. NMS export             CKT ID -> ring, customer mux, tunnels
  4. Peyto feasibility      primary / secondary path to B2B Peyto
  5. ECI design rules
A failure on one LSI never stops the batch: that row becomes "Manual Check Needed".
"""
import io, re, time
from pathlib import Path
import pandas as pd
import yaml

from .data import Inventory
from . import feasibility, rules
from connectors.base import ConnectorError, Lookup, with_retries

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


class Connections:
    """Everything one batch needs. Built from Settings; closed after the batch."""

    def __init__(self, settings, inventory: Inventory | None = None, chitragupt_client=None):
        """chitragupt_client: an already logged-in client from the user's OLM session
        (it belongs to the session, so it is not closed after the batch)."""
        from connectors import chitragupt, ssh_lookup
        self.s = settings
        c = settings.cfg
        self._own_chit = chitragupt_client is None
        if not c["chitragupt"]["enabled"]:
            self.chitragupt = None
        else:
            self.chitragupt = chitragupt_client or chitragupt.make(settings)
        self.ssh = ssh_lookup.SshCktFinder(settings) if c["ssh"]["enabled"] else None
        self.nms = inventory or Inventory(settings.nms_export_dir)
        self.retries, self.wait = c.get("retries", 2), c.get("retry_wait_seconds", 2)
        self.alerts: list[str] = []          # batch-level problems shown in the UI (e.g. session expired)

    def alert(self, msg):
        if msg not in self.alerts:
            self.alerts.append(msg)

    def close(self):
        for x in ((self.chitragupt if self._own_chit else None), self.ssh):
            if x:
                try:
                    x.close()
                except Exception:
                    pass


def _safe(source, fn, retries, wait, conn=None) -> Lookup:
    from connectors.chitragupt import SessionExpired
    try:
        return with_retries(fn, retries, wait)
    except SessionExpired as e:
        if conn is not None:
            conn.alert(str(e))
        return Lookup(source, "error", note=str(e))
    except ConnectorError as e:
        return Lookup(source, "error", note=str(e))
    except Exception as e:                      # never let one LSI kill the batch
        return Lookup(source, "error", note=f"{type(e).__name__}: {str(e)[:120]}")


def _trace(step, lk: Lookup | None = None, status=None, note=""):
    if lk is not None:
        return {"step": step, "status": lk.status, "note": lk.note, "ms": lk.ms, "ckt_ids": lk.ckt_ids}
    return {"step": step, "status": status, "note": note, "ms": 0, "ckt_ids": []}


def find_ckts(lsi, conn: Connections):
    """-> (ckt_ids, source, trace, had_error)"""
    trace, err = [], False
    if conn.chitragupt:
        lk = _safe("chitragupt", lambda: conn.chitragupt.lookup(lsi), conn.retries, conn.wait, conn)
        trace.append(_trace("Chitragupt", lk))
        if lk.found:
            return lk.ckt_ids, "chitragupt", trace, False
        err |= lk.status == "error"
    if conn.ssh:
        lk = _safe("ssh", lambda: conn.ssh.lookup(lsi), conn.retries, conn.wait, conn)
        trace.append(_trace("SSH (T3/T4)", lk))
        if lk.found:
            return lk.ckt_ids, "ssh", trace, False
        err |= lk.status == "error"
    return [], "", trace, err


def _empty_row(lsi, status, label, reason, source="", trace=None, ckt=""):
    return {"lsi": lsi, "ckt_id": ckt, "ckt_source": source, "status": status, "label": label, "reason": reason,
            "ring": "", "customer_mux": "", "service_type": "", "paths": [], "checks": [], "design_ok": None,
            "trace": trace or []}


def check_lsi(lsi, conn: Connections, cfg):
    labels = cfg["feasibility_labels"]
    ckts, source, trace, err = find_ckts(lsi, conn)
    if not ckts:
        if err:
            return [_empty_row(lsi, "manual_check", labels["manual_check"],
                               "A lookup system did not answer (see trace). Check this LSI by hand.", trace=trace)]
        return [_empty_row(lsi, "not_found", labels["not_found"],
                           "No CKT ID in Chitragupt or on the T3/T4 nodes", trace=trace)]
    rows = []
    for ckt in ckts:
        svcs = conn.nms.services_for_ckt(ckt)
        if not svcs:
            t = trace + [_trace("NMS", status="not_found", note=f"{ckt} not in NMS export")]
            rows.append(_empty_row(lsi, "manual_check", labels["manual_check"],
                                   f"CKT {ckt} found via {source} but not in the NMS export. Check in LightSoft.",
                                   source, t, ckt))
            continue
        for s in svcs:
            t = trace + [_trace("NMS", status="found", note=f"Ring {s['ring']}, mux {s['customer_mux']}")]
            ring = conn.nms.rings.get(s["ring"])
            f = feasibility.check(ring, s["customer_mux"], labels)
            checks = rules.run(s, conn.nms.tunnels_for(s["ckt_id"]), cfg)
            t.append(_trace("Peyto paths", status=f["status"], note=f["reason"]))
            rows.append({"lsi": lsi, "ckt_id": s["ckt_id"], "ckt_source": source,
                         "service_type": s["service_type"], "ring": s["ring"], "customer_mux": s["customer_mux"],
                         **f, "checks": checks, "design_ok": all(c["ok"] for c in checks), "trace": t})
    return rows


def summarize(lsis, rows, t0):
    return {
        "lsis": len(lsis),
        "ckts": sum(1 for r in rows if r["ckt_id"]),
        "protected": sum(r["status"] == "protected" for r in rows),
        "unprotected": sum(r["status"] == "unprotected" for r in rows),
        "not_feasible": sum(r["status"] == "not_feasible" for r in rows),
        "not_found": sum(r["status"] == "not_found" for r in rows),
        "manual_check": sum(r["status"] == "manual_check" for r in rows),
        "design_issues": sum(r["design_ok"] is False for r in rows),
        "via_chitragupt": len({r["lsi"] for r in rows if r["ckt_source"] == "chitragupt"}),
        "via_ssh": len({r["lsi"] for r in rows if r["ckt_source"] == "ssh"}),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
    }


def run(lsis, conn: Connections, cfg=None, progress=None):
    """progress(done, total, lsi, new_rows) is called after every LSI (for the live UI)."""
    t0 = time.perf_counter()
    cfg = cfg or load_cfg()
    rows = []
    for i, lsi in enumerate(lsis, 1):
        new = check_lsi(lsi, conn, cfg)
        rows.extend(new)
        if progress:
            progress(i, len(lsis), lsi, new)
    return {"summary": summarize(lsis, rows, t0), "rows": rows, "alerts": list(getattr(conn, "alerts", []))}
