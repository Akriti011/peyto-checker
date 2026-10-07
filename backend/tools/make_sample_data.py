"""
Generates the DEMO dataset used by the POC.

Ring / node names for MAH4P01A04 and APM4P36C02 are taken from the training deck
screenshots so the demo looks familiar. MAH4P02B11, all LSI numbers, customer codes
and tunnel values are INVENTED for demonstration only. Replace sample_data/ with real
exports before using results for anything.
"""
import csv, os
import pandas as pd

OUT = os.path.join(os.path.dirname(__file__), "..", "sample_data")
os.makedirs(OUT, exist_ok=True)

rings = {
    "MAH4P01A04": {"kind": "ring", "nodes": [
        "PUN_TNGMH_SGT_P_E56863", "PUN_TNGMH_SGT_P_E51025", "PUN_TNGMH_SMT_P_E50461",
        "RGD_TNGMH_MAP_P_E50462", "MAH_BCLMH_KTE_P_E51098", "PEN_TNGMH_AGM_P_E88863",
        "PEN_TNGMH_AGM_P_E51097", "BCLMH_BAM_P_E51187", "NGT_TNGMH_OIC_P_E51096",
        "MHA_TNGMH_KPK_P_E51094", "INP_BCLMH_MHT_P_E51095", "KED_TNGMH_NBE_P_E51093",
        "CIL_BCLMH_LTG_P_E51092", "CIN_TNGMH_SVD_P_E51091", "HTK_TNGMH_HTV_P_E51265",
        "KPR_BCLMH_NGC_P_E51263", "KPR_BCLMH_NGC_P_E53928", "PAS_BCLMH_PAT_P_E97269",
        "SAN_TNGMH_MRD_P_E51066", "SAT_TNGMH_KRD_P_E51829", "SAT_TNGMH_SBZ_P_E53892",
        "LND_TNGMH_LND_P_E51027", "LMH_TNGMH_NSS_P_E51026"],
        "gateways": {"PUN_TNGMH_SGT_P_E51025": ("PRI-GTW", "PEYTO#1-PUN"),
                     "PEN_TNGMH_AGM_P_E51097": ("SEC-GTW", "PEYTO#2-PEN")},
        "alarms": {}},
    "APM4P36C02": {"kind": "ring", "nodes": [
        "BLI_TNGMH_BNR_P_E51869", "NND_TNGMH_HTN_P_E56281", "CHA_TNGMH_SMR_P_E51329",
        "BPR_BCLMH_BUS_P_E51865", "CLH_BCLMH_DTC_P_E53874", "RJR_BCLMH_NCK_P_E86078",
        "RJR_BCLMH_DRH_P_E94391", "AWP_BCLAP_UCG_P_E54419", "ADL_BCLAP_NCK_P_E54420",
        "MVF_BCLAP_VML_P_E55007", "NED_TNGAP_DAD_P_E54415", "NML_BCLAP_SUT_P_E54416",
        "DWP_BCLAP_MDL_P_E55021", "BNN_BCLAP_MCY_P_E54793", "MCQ_BCLAP_MRY_P_E54699",
        "NEQ_BCLAP_NVM_P_E55020", "YDA_BCLAP_YOE_P_E82678", "BON_BCLAP_NAC_P_E57208",
        "BLI_BCLMH_KBK_P_E90136"],
        "gateways": {"NND_TNGMH_HTN_P_E56281": ("PRI-GTW", "PEYTO#1-NND"),
                     "NEQ_BCLAP_NVM_P_E55020": ("SEC-GTW", "PEYTO#2-NEQ")},
        "alarms": {("NED_TNGAP_DAD_P_E54415", "NML_BCLAP_SUT_P_E54416"): "LOS (Critical)",
                   ("DWP_BCLAP_MDL_P_E55021", "BNN_BCLAP_MCY_P_E54793"): "LOF (Major)"}},
    "MAH4P02B11": {"kind": "linear", "nodes": [
        "NSK_TNGMH_CBS_P_E61201", "NSK_BCLMH_DWK_P_E61202", "NSK_BCLMH_PNC_P_E61203",
        "NSK_TNGMH_GNG_P_E61204", "NSK_BCLMH_SPR_P_E61205"],
        "gateways": {"NSK_TNGMH_CBS_P_E61201": ("PRI-GTW", "PEYTO#1-NSK")},
        "alarms": {}},
}

with open(f"{OUT}/ring_nodes.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["ring", "kind", "order", "node", "role", "peyto_router"])
    for r, d in rings.items():
        for i, n in enumerate(d["nodes"]):
            role, peyto = d["gateways"].get(n, ("NE", ""))
            w.writerow([r, d["kind"], i, n, role, peyto])

with open(f"{OUT}/ring_links.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["ring", "node_a", "node_b", "link_type", "status", "alarm"])
    for r, d in rings.items():
        ns = d["nodes"]
        pairs = list(zip(ns, ns[1:])) + ([(ns[-1], ns[0])] if d["kind"] == "ring" else [])
        for a, b in pairs:
            al = d["alarms"].get((a, b)) or d["alarms"].get((b, a)) or ""
            w.writerow([r, a, b, "RING", "ALARM" if al else "OK", al])
        for gw, (_, peyto) in d["gateways"].items():
            w.writerow([r, gw, peyto, "B2B-NNI", "OK", ""])

# service_type, mspw/signaling, bsc and root ports feed the design rules
services = [
    # lsi,     ckt_id,                 type,  ring,          customer mux,               leaf_bsc, root_bsc, root_ports, signaling
    ("4398937", "SIFY-T1843438",        "P2MP", "MAH4P01A04", "CIL_BCLMH_LTG_P_E51092", "50MB", "1GE", 2, "Y"),
    ("4398937", "SIFY-T1843438_Peyto",  "P2MP", "MAH4P01A04", "CIL_BCLMH_LTG_P_E51092", "50MB", "1GE", 2, "Y"),
    ("4401276", "STLZ-T150102-Live",    "P2MP", "MAH4P01A04", "MHA_TNGMH_KPK_P_E51094", "50MB", "1GE", 1, "Y"),
    ("4412058", "ITP-T1645065_ENK_ODU", "P2P",  "MAH4P01A04", "SAT_TNGMH_KRD_P_E51829", "50MB", "1GE", 1, "Y"),
    ("4423711", "NOVA-T1712290",        "P2MP", "APM4P36C02", "YDA_BCLAP_YOE_P_E82678", "50MB", "1GE", 2, "Y"),
    ("4430985", "ORBT-T1698842",        "P2MP", "APM4P36C02", "ADL_BCLAP_NCK_P_E54420", "50MB", "1GE", 2, "Y"),
    ("4447120", "KRNX-T1733105",        "P2MP", "APM4P36C02", "DWP_BCLAP_MDL_P_E55021", "50MB", "1GE", 1, "Y"),
    ("4452288", "VYOM-T1740021",        "P2MP", "MAH4P02B11", "NSK_BCLMH_PNC_P_E61203", "50MB", "1GE", 1, "Y"),
    ("4469031", "ZEPH-T1755310",        "P2MP", "MAH4P01A04", "PAS_BCLMH_PAT_P_E97269", "50MB", "1GE", 5, "Y"),
    ("4481902", "TARA-T1761188",        "P2MP", "APM4P36C02", "BON_BCLAP_NAC_P_E57208", "100MB", "1GE", 2, "N"),
    ("4492317", "SIFY-T1860021",        "P2MP", "MAH4P01A04", "CIN_TNGMH_SVD_P_E51091", "50MB", "1GE", 2, "Y"),
]
pd.DataFrame(services, columns=["lsi", "ckt_id", "service_type", "ring", "customer_mux", "bsc_leaf",
                                "bsc_root", "root_ports", "signaling_enabled"]).to_csv(f"{OUT}/services.csv", index=False)

# two tunnels (main / standby MSPW) per service; a few deliberate guideline violations
tunnels = []
for lsi, ckt, *_ in services:
    tunnels.append([ckt, f"T-{ckt[-6:]}-M", "main", "Linear 1:1", 7, 10])
    tunnels.append([ckt, f"T-{ckt[-6:]}-S", "standby", "Linear 1:1", 7, 10])
def patch(ckt, role, **kw):
    for t in tunnels:
        if t[0] == ckt and t[2] == role:
            for k, v in kw.items():
                t[{"name": 1, "protection": 3, "cos": 4, "bfd": 5}[k]] = v
patch("ITP-T1645065_ENK_ODU", "main", bfd=50)
patch("NOVA-T1712290", "standby", name="T-712290-M")           # same tunnel as main
patch("VYOM-T1740021", "main", cos=5)
patch("TARA-T1761188", "standby", protection="Unprotected")
pd.DataFrame(tunnels, columns=["ckt_id", "tunnel", "mspw_role", "protection", "cc_cos", "bfd_ms"]).to_csv(
    f"{OUT}/tunnels.csv", index=False)

# demo input sheet, as it would arrive: LSI list (+ one unknown LSI)
pd.DataFrame({"S.No": range(1, 12),
              "LSI": ["4398937", "4401276", "4412058", "4423711", "4430985", "4447120",
                      "4452288", "4469031", "4470554", "4481902", "4492317"],
              "Circle": ["MH"] * 4 + ["AP"] * 3 + ["MH"] * 4,
              "Request Date": ["07-10-2026"] * 11}).to_excel(f"{OUT}/demo_lsi_sheet.xlsx", index=False)
print("sample data written to", os.path.abspath(OUT))
