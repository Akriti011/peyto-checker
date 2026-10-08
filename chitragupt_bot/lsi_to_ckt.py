"""
Chitragupt bot (v1): LSI list -> CKT ID(s).

Kya karta hai:
  1. Chrome kholta hai aur Chitragupt ke link pe jaata hai
  2. RUKTA hai -> tum khud apni old ID se login karo, phir terminal mein Enter
  3. Har LSI ko search bar mein type karke Enter dabata hai
  4. Result page se CKT ID jaisa text padhta hai aur Excel mein likhta hai

Ye sirf search karta hai aur padhta hai. Chitragupt mein kuch change nahi karta.
Login ID / password is code mein KABHI mat likhna.

Run:
  python3 lsi_to_ckt.py --input lsi_list.xlsx            (test: pehle 5 LSI)
  python3 lsi_to_ckt.py --input lsi_list.xlsx --limit 0  (saari LSI)
"""
import argparse, re, sys, time
from pathlib import Path

import pandas as pd
import yaml
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

HERE = Path(__file__).resolve().parent
CFG = yaml.safe_load((HERE / "config.yaml").read_text())
DEBUG_DIR = HERE / "debug_screens"


def read_lsis(path: Path):
    df = pd.read_csv(path, dtype=str) if path.suffix.lower() == ".csv" else pd.read_excel(path, dtype=str)
    df = df.fillna("")
    col = next((c for c in df.columns if "lsi" in str(c).lower()), df.columns[0])
    seen, out = set(), []
    for v in df[col]:
        v = re.sub(r"\.0$", "", str(v).strip())
        if v and v not in seen:
            seen.add(v); out.append(v)
    print(f"[i] '{col}' column se {len(out)} LSI mile")
    return out


def find_search_box(page):
    """config mein selector diya hai to wahi, warna page ka pehla visible text box."""
    if CFG.get("search_selector"):
        return page.locator(CFG["search_selector"]).first
    for sel in ["input[type=search]", "input[placeholder*=LSI i]", "input[placeholder*=search i]",
                "input[name*=search i]", "input[type=text]"]:
        loc = page.locator(sel)
        for i in range(loc.count()):
            if loc.nth(i).is_visible():
                return loc.nth(i)
    return None


def search_one(page, lsi, ckt_re, shot):
    box = find_search_box(page)
    if box is None:
        return [], "ERROR: search box nahi mila (config.yaml mein search_selector daalo)"
    box.fill("")
    box.fill(lsi)
    if CFG.get("search_button_selector"):
        page.locator(CFG["search_button_selector"]).first.click()
    else:
        box.press("Enter")
    try:
        page.wait_for_load_state("networkidle", timeout=CFG["wait_seconds"] * 1000)
    except PWTimeout:
        pass
    time.sleep(CFG.get("extra_wait_seconds", 1))
    if shot:
        DEBUG_DIR.mkdir(exist_ok=True)
        page.screenshot(path=str(DEBUG_DIR / f"lsi_{lsi}.png"), full_page=True)
    text = page.locator("body").inner_text()
    ckts = list(dict.fromkeys(ckt_re.findall(text)))   # unique, order same
    if ckts and lsi not in text:
        # page pe abhi purani LSI ka result ho sakta hai -> bharosa mat karo
        return ckts, "CHECK: page pe ye LSI nahi dikhi, manually verify karo"
    return ckts, ("FOUND" if ckts else "NOT FOUND")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="LSI wali Excel/CSV")
    ap.add_argument("--output", default="lsi_ckt_result.xlsx")
    ap.add_argument("--limit", type=int, default=5, help="kitni LSI (0 = saari). Default 5 = test")
    args = ap.parse_args()

    if not CFG.get("chitragupt_url") or "PASTE" in CFG["chitragupt_url"]:
        sys.exit("config.yaml mein chitragupt_url daalo (browser address bar se copy karke)")

    lsis = read_lsis(Path(args.input))
    if args.limit:
        lsis = lsis[: args.limit]
    ckt_re = re.compile(CFG["ckt_id_regex"])
    rows = []

    with sync_playwright() as p:
        # Profile folder mein login session yaad rehta hai, password nahi save hota code mein
        kwargs = dict(user_data_dir=str(HERE / ".browser_profile"), headless=False, viewport={"width": 1366, "height": 850})
        try:
            ctx = p.chromium.launch_persistent_context(channel="chrome", **kwargs)   # Mac ka installed Chrome
        except Exception:
            ctx = p.chromium.launch_persistent_context(**kwargs)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(CFG["chitragupt_url"])

        print("\n" + "=" * 60)
        print(" Browser mein apni OLD ID se login karo.")
        print(" Jab LSI wala search bar dikhne lage, yahan aake ENTER dabao.")
        print("=" * 60)
        input()

        for i, lsi in enumerate(lsis, 1):
            try:
                ckts, status = search_one(page, lsi, ckt_re, shot=i <= 3)
            except Exception as e:
                ckts, status = [], f"ERROR: {type(e).__name__}: {str(e)[:120]}"
            rows.append({"LSI": lsi, "CKT ID(s)": ", ".join(ckts), "Count": len(ckts), "Status": status})
            print(f"[{i}/{len(lsis)}] {lsi} -> {', '.join(ckts) or '-'}  ({status})")
            time.sleep(CFG.get("delay_between_searches", 1))   # site pe load mat daalo

        ctx.close()

    out = Path(args.output)
    pd.DataFrame(rows).to_excel(out, index=False)
    found = sum(r["Status"] == "FOUND" for r in rows)
    print(f"\n[done] {found}/{len(rows)} LSI ki CKT ID mili -> {out.resolve()}")
    print(f"[i] Pehli 3 search ke screenshots: {DEBUG_DIR}")


if __name__ == "__main__":
    main()
