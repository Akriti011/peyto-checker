"""Pipeline + connector tests that need no network: fake connectors stand in for
Chitragupt / SSH, and the demo NMS export in sample_data/ is the inventory."""
import pytest

from connectors import settings as settings_mod
from connectors.base import ConnectorError, Lookup, extract_ckts, with_retries
from connectors.ssh_lookup import SshCktFinder
from engine import pipeline
from engine.data import Inventory

INV = Inventory()
CFG = pipeline.load_cfg()
SVC = INV.services.iloc[0]
CKT = SVC["ckt_id"]


class FakeChit:
    def __init__(self, table=None, fail=False):
        self.table, self.fail, self.calls = table or {}, fail, 0

    def lookup(self, lsi):
        self.calls += 1
        if self.fail:
            raise ConnectorError("Chitragupt not reachable")
        c = self.table.get(lsi, [])
        return Lookup("chitragupt", "found" if c else "not_found", c)

    def close(self):
        pass


class FakeSsh(FakeChit):
    def lookup(self, lsi, tier_hint=None):
        r = super().lookup(lsi)
        r.source = "ssh"
        return r


def conn(chit=None, ssh=None):
    c = pipeline.Connections.__new__(pipeline.Connections)
    c.chitragupt, c.ssh, c.nms, c.retries, c.wait = chit, ssh, INV, 1, 0
    return c


def test_found_in_chitragupt_skips_ssh():
    ssh = FakeSsh({"1": [CKT]})
    rows = pipeline.check_lsi("1", conn(FakeChit({"1": [CKT]}), ssh), CFG)
    assert rows[0]["ckt_source"] == "chitragupt" and rows[0]["ckt_id"] == CKT
    assert ssh.calls == 0
    assert rows[0]["status"] in ("protected", "unprotected", "not_feasible")


def test_ssh_fallback_when_chitragupt_empty():
    rows = pipeline.check_lsi("2", conn(FakeChit(), FakeSsh({"2": [CKT]})), CFG)
    assert rows[0]["ckt_source"] == "ssh"
    assert [t["step"] for t in rows[0]["trace"]][:2] == ["Chitragupt", "SSH (T3/T4)"]


def test_not_found_anywhere():
    rows = pipeline.check_lsi("3", conn(FakeChit(), FakeSsh()), CFG)
    assert rows[0]["status"] == "not_found"


def test_system_down_gives_manual_check_and_retries():
    chit = FakeChit(fail=True)
    rows = pipeline.check_lsi("4", conn(chit, FakeSsh()), CFG)
    assert rows[0]["status"] == "manual_check"
    assert chit.calls == 2                       # 1 try + 1 retry


def test_ckt_missing_in_nms_export():
    rows = pipeline.check_lsi("5", conn(FakeChit({"5": ["ZZZ-T9999999"]}), None), CFG)
    assert rows[0]["status"] == "manual_check" and "NMS" in rows[0]["reason"]


def test_one_bad_lsi_does_not_stop_batch():
    class Boom(FakeChit):
        def lookup(self, lsi):
            if lsi == "bad":
                raise RuntimeError("unexpected")
            return super().lookup(lsi)
    res = pipeline.run(["bad", "ok"], conn(Boom({"ok": [CKT]}), None), CFG)
    assert [r["status"] for r in res["rows"]][0] == "manual_check"
    assert res["rows"][1]["ckt_id"] == CKT


def test_retry_helper():
    n = {"i": 0}

    def flaky():
        n["i"] += 1
        if n["i"] < 3:
            raise ConnectorError("x")
        return "ok"
    assert with_retries(flaky, 2, 0) == "ok"


def test_ckt_regex():
    txt = "LSI-4401276 CKT:SIFY-T1843438 and STLZ-T150102-Live, again SIFY-T1843438"
    assert extract_ckts(txt, CFG_REGEX()) == ["SIFY-T1843438", "STLZ-T150102-Live"]


def CFG_REGEX():
    return settings_mod.load().cfg["ckt_id_regex"]


@pytest.mark.parametrize("cmd", ["configure terminal", "show run; reload", "delete flash:", "show x\nreload"])
def test_ssh_blocks_non_readonly_commands(cmd):
    s = settings_mod.load()
    s.cfg = {**s.cfg, "ssh": {**s.cfg["ssh"], "command": cmd}}
    with pytest.raises(ConnectorError):
        SshCktFinder(s).build_command("4401276")


def test_ssh_rejects_weird_lsi():
    with pytest.raises(ConnectorError):
        SshCktFinder(settings_mod.load()).build_command("123; reload")


def test_tier_hint_goes_first():
    f = SshCktFinder(settings_mod.load())
    assert f.tiers_to_try("T4") == ["T4", "T3"]
    assert f.tiers_to_try(None) == ["T3", "T4"]


def test_settings_live_reads_env(monkeypatch):
    monkeypatch.setenv("PEYTO_MODE", "live")
    monkeypatch.setenv("CHITRAGUPT_URL", "http://chitragupt.example/")
    monkeypatch.setenv("SSH_T3_NODES", "202.123.0.1, 202.123.0.2")
    s = settings_mod.load()
    assert s.mode == "live" and s.chitragupt_url == "http://chitragupt.example"
    assert s.ssh_nodes["T3"] == ["202.123.0.1", "202.123.0.2"]
    assert "PASS" not in str(s.public()).upper()
