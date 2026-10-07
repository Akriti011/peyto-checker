"""Writes the filled Excel: original sheet untouched + 'Peyto Result' and 'Summary' sheets."""
import io
import pandas as pd
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

RED, PINK, BLUSH, WHITE, INK = "E40000", "FFD6DC", "FFF1F3", "FFFFFF", "3A0A10"
FILL = {"protected": "E40000", "unprotected": "FFB3BF", "not_feasible": "FFFFFF", "not_found": "FFF1F3"}
FONT = {"protected": WHITE, "unprotected": INK, "not_feasible": RED, "not_found": "8A4A55"}


def _short(n):
    return n.split("_")[-1] if "_" in n else n


def build(original_df: pd.DataFrame, result: dict) -> bytes:
    out = []
    for r in result["rows"]:
        p = {x["role"]: x for x in r.get("paths", [])}
        fails = [c for c in r.get("checks", []) if not c["ok"]]
        out.append({
            "LSI": r["lsi"], "CKT ID": r["ckt_id"] or "-", "Service Type": r.get("service_type") or "-",
            "Ring": r.get("ring") or "-", "Customer Mux": r.get("customer_mux") or "-",
            "Peyto Feasibility": r["label"],
            "Primary Path": " > ".join(_short(h) for h in p["primary"]["hops"]) if "primary" in p else "-",
            "Secondary Path": " > ".join(_short(h) for h in p["secondary"]["hops"]) if "secondary" in p else "-",
            "Design Check": "-" if r["design_ok"] is None else ("PASS" if not fails else f"{len(fails)} issue(s)"),
            "Remarks": r["reason"] + ("" if not fails else " | " + "; ".join(c["detail"] for c in fails)),
            "_status": r["status"],
        })
    res_df = pd.DataFrame(out)
    s = result["summary"]
    sum_df = pd.DataFrame([
        ("LSIs checked", s["lsis"]), ("CKT IDs found", s["ckts"]), ("Feasible - Protected", s["protected"]),
        ("Feasible - Unprotected", s["unprotected"]), ("Not Feasible", s["not_feasible"]),
        ("LSI not found", s["not_found"]), ("Design issues", s["design_issues"])], columns=["Metric", "Count"])

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        original_df.to_excel(xw, sheet_name="Input", index=False)
        res_df.drop(columns="_status").to_excel(xw, sheet_name="Peyto Result", index=False)
        sum_df.to_excel(xw, sheet_name="Summary", index=False)
        thin = Side(style="thin", color=PINK)
        for name in ("Peyto Result", "Summary", "Input"):
            ws = xw.sheets[name]
            for c in ws[1]:
                c.font = Font(bold=True, color=WHITE); c.fill = PatternFill("solid", fgColor=RED)
                c.alignment = Alignment(vertical="center", horizontal="center")
            ws.row_dimensions[1].height = 24
            ws.freeze_panes = "A2"
            for row in ws.iter_rows(min_row=2):
                for c in row:
                    c.border = Border(bottom=thin)
                    c.alignment = Alignment(vertical="top", wrap_text=True)
            for i, col in enumerate(ws.columns, 1):
                w = max(len(str(c.value or "")) for c in col)
                ws.column_dimensions[get_column_letter(i)].width = min(max(12, w + 2), 60)
        ws = xw.sheets["Peyto Result"]
        fcol = list(res_df.columns).index("Peyto Feasibility") + 1
        for i, st in enumerate(res_df["_status"], start=2):
            c = ws.cell(row=i, column=fcol)
            c.fill = PatternFill("solid", fgColor=FILL[st]); c.font = Font(bold=True, color=FONT[st])
            if i % 2 == 0:
                for col in range(1, len(res_df.columns)):
                    if col != fcol:
                        ws.cell(row=i, column=col).fill = PatternFill("solid", fgColor=BLUSH)
    return buf.getvalue()
