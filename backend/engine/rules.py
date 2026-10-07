"""ECI design-guideline checks. Each rule returns {id, title, ok, detail}."""

RULE_CATALOG = [
    ("TUN-PROT", "Tunnels are Linear 1:1 protected", "IMPORTANT NOTES #3"),
    ("TUN-COS", "Control Channel CoS 7", "Prerequisite 2(e)"),
    ("TUN-BFD", "BFD period 10 ms", "Prerequisite 2(e)"),
    ("MSPW-DIV", "Main and standby MSPW use different tunnels", "IMPORTANT NOTES #4"),
    ("SVC-ROOT", "Max 4 root ports in the L2VPN", "Scenario 16"),
    ("SVC-BSC", "BSC 50MB at leaf, 1GE at root", "IMPORTANT NOTES #1"),
    ("SVC-SIG", "Signaling enabled (MSPW / MC-LAG / PWR)", "IMPORTANT NOTES #5"),
]


def run(service, tunnels, cfg):
    t, s = cfg["tunnel"], cfg["service"]
    res = []

    def add(rid, ok, detail):
        title, ref = next((x[1], x[2]) for x in RULE_CATALOG if x[0] == rid)
        res.append({"id": rid, "title": title, "ref": ref, "ok": ok, "detail": detail})

    bad = [x for x in tunnels if x["protection"] != t["protection"]]
    add("TUN-PROT", not bad, "All tunnels protected" if not bad else
        "Unprotected: " + ", ".join(f'{x["tunnel"]} ({x["mspw_role"]})' for x in bad))

    bad = [x for x in tunnels if int(x["cc_cos"]) != t["control_channel_cos"]]
    add("TUN-COS", not bad, f'CoS {t["control_channel_cos"]} on all tunnels' if not bad else
        ", ".join(f'{x["tunnel"]} uses CoS {x["cc_cos"]}' for x in bad))

    bad = [x for x in tunnels if int(x["bfd_ms"]) != t["bfd_ms"]]
    add("TUN-BFD", not bad, f'BFD {t["bfd_ms"]} ms on all tunnels' if not bad else
        ", ".join(f'{x["tunnel"]} has BFD {x["bfd_ms"]} ms' for x in bad))

    names = [x["tunnel"] for x in tunnels]
    dup = len(names) != len(set(names))
    add("MSPW-DIV", not dup, "Main and standby on separate tunnels" if not dup else
        "Main and standby share tunnel " + next(n for n in names if names.count(n) > 1))

    rp = int(service["root_ports"])
    add("SVC-ROOT", rp <= s["max_root_ports"], f"{rp} root port(s)" if rp <= s["max_root_ports"] else
        f"{rp} root ports, limit is {s['max_root_ports']}")

    ok = service["bsc_leaf"] == s["bsc_leaf"] and service["bsc_root"] == s["bsc_root"]
    add("SVC-BSC", ok, f'Leaf {service["bsc_leaf"]}, root {service["bsc_root"]}' +
        ("" if ok else f' (expected {s["bsc_leaf"]} / {s["bsc_root"]})'))

    sig = service["signaling_enabled"].upper() == "Y"
    add("SVC-SIG", sig or not s["signaling_enabled"], "Signaling enabled" if sig else "Signaling disabled")
    return res
