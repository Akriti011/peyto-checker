from connectors.base import Lookup
from engine.data import Inventory
from engine import pipeline

INV = Inventory()


class _ChitFromExport:
    """Stands in for Chitragupt: uses the LSI column of the demo NMS export."""
    def lookup(self, lsi):
        c = [s["ckt_id"] for s in INV.ckts_for_lsi(lsi)]
        return Lookup("chitragupt", "found" if c else "not_found", c)

    def close(self):
        pass


def _conn():
    c = pipeline.Connections.__new__(pipeline.Connections)
    c.chitragupt, c.ssh, c.nms, c.retries, c.wait = _ChitFromExport(), None, INV, 0, 0
    return c


def by_ckt(rows):
    return {r["ckt_id"] or r["lsi"]: r for r in rows}


def test_demo_outcomes():
    lsis = ["4398937", "4401276", "4412058", "4423711", "4430985", "4447120",
            "4452288", "4469031", "4470554", "4481902", "4492317"]
    res = pipeline.run(lsis, _conn())
    r = by_ckt(res["rows"])
    assert r["SIFY-T1843438"]["status"] == "protected"
    assert r["SIFY-T1843438_Peyto"]["status"] == "protected"        # one LSI -> two CKTs
    assert r["NOVA-T1712290"]["status"] == "protected"
    assert r["ORBT-T1698842"]["status"] == "unprotected"            # second path through PRI-GTW only
    assert r["KRNX-T1733105"]["status"] == "not_feasible"           # isolated between two alarms
    assert r["VYOM-T1740021"]["status"] == "unprotected"            # single homed linear ring
    assert r["4470554"]["status"] == "not_found"
    assert res["summary"]["ckts"] == 11


def test_design_rules_flag_violations():
    r = by_ckt(pipeline.run(["4412058", "4423711", "4469031", "4481902", "4452288"], _conn())["rows"])
    fails = lambda c: {x["id"] for x in r[c]["checks"] if not x["ok"]}
    assert fails("ITP-T1645065_ENK_ODU") == {"TUN-BFD"}
    assert fails("NOVA-T1712290") == {"MSPW-DIV"}
    assert fails("ZEPH-T1755310") == {"SVC-ROOT"}
    assert fails("TARA-T1761188") == {"TUN-PROT", "SVC-BSC", "SVC-SIG"}
    assert fails("VYOM-T1740021") == {"TUN-COS"}


def test_protected_paths_are_disjoint():
    row = by_ckt(pipeline.run(["4398937"], _conn())["rows"])["SIFY-T1843438"]
    a, b = (set(p["hops"][1:]) for p in row["paths"])
    assert not a & b
