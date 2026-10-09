"""Preflight = "can this machine actually talk to every system?"

Run on the office laptop / internal VM before anything else:

    cd backend && python -m connectors.preflight            # uses .env
    cd backend && python -m connectors.preflight --lsi 4401276

Each check is read-only. Nothing is changed anywhere. Output is a simple
PASS / FAIL list you can screenshot for your manager.
"""
import argparse
import socket
import time

from . import settings as settings_mod
from .base import ConnectorError


def _tcp(host, port, timeout=5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "reachable"
    except OSError as e:
        return False, f"{type(e).__name__}: {e}"


def run(s=None, lsi: str | None = None, chitragupt_client=None):
    """chitragupt_client: an already logged-in client (OLM session). Not closed here."""
    from urllib.parse import urlparse
    from .chitragupt import make as make_chit
    from .ssh_lookup import SshCktFinder
    from engine.data import Inventory

    s = s or settings_mod.load()
    out = []

    def add(system, check, ok, detail):
        out.append({"system": system, "check": check, "ok": bool(ok), "detail": detail})

    add("Config", f"Mode = {s.mode}", True, "PEYTO_MODE from .env")

    # ---- Chitragupt
    if not s.chitragupt_url:
        add("Chitragupt", "URL set", False, "CHITRAGUPT_URL missing in .env")
    else:
        u = urlparse(s.chitragupt_url)
        ok, d = _tcp(u.hostname, u.port or (443 if u.scheme == "https" else 80))
        add("Chitragupt", f"Network to {u.hostname}", ok, d)
        if ok:
            if chitragupt_client is None and s.auth_mode == "service":
                add("Chitragupt", "Service account set", bool(s.chitragupt_user), "CHITRAGUPT_USER in .env")
            c = chitragupt_client or make_chit(s)
            if chitragupt_client is not None:
                add("Chitragupt", "OLM login + OTP", c.state == "logged_in", f"logged in as {c.user}")
            try:
                t = time.perf_counter()
                r = c.lookup(lsi or "0000000")
                add("Chitragupt", f"Login + search ({s.cfg['chitragupt']['strategy']})", r.status != "error",
                    f"{r.status} {r.ckt_ids or ''} {r.note} ({(time.perf_counter() - t) * 1000:.0f} ms)")
            except ConnectorError as e:
                add("Chitragupt", "Login + search", False, str(e))
            finally:
                if chitragupt_client is None:
                    c.close()

    # ---- SSH nodes
    f = SshCktFinder(s)
    try:
        add("SSH", "Command is read-only", True, f.build_command(lsi or "0000000"))
    except ConnectorError as e:
        add("SSH", "Command is read-only", False, str(e))
    if s.ssh_jump_host:
        h, _, p = s.ssh_jump_host.partition(":")
        ok, d = _tcp(h, int(p or 22))
        add("SSH", f"Jump server {h}", ok, d)
    for tier in s.cfg["ssh"]["tier_order"]:
        nodes = s.ssh_nodes.get(tier) or []
        if not nodes:
            add("SSH", f"{tier} nodes configured", False, f"SSH_{tier}_NODES missing in .env")
        for node in nodes[:3]:
            h, _, p = node.partition(":")
            if not s.ssh_jump_host:
                ok, d = _tcp(h, int(p or 22))
                add("SSH", f"{tier} {node} port open", ok, d)
                if not ok:
                    continue
            try:
                f._connect(node)
                add("SSH", f"{tier} {node} login", True, "logged in (read-only account)")
            except ConnectorError as e:
                add("SSH", f"{tier} {node} login", False, str(e))
    if lsi:
        try:
            r = f.lookup(lsi)
            add("SSH", f"Search LSI {lsi}", r.status != "error", f"{r.status} {r.ckt_ids or ''} {r.note}")
        except ConnectorError as e:
            add("SSH", f"Search LSI {lsi}", False, str(e))
    f.close()

    # ---- NMS export
    try:
        inv = Inventory(s.nms_export_dir)
        o = inv.overview()
        add("NMS", "Export files readable", True, f"{o['services']} services, {o['rings']} rings in {s.nms_export_dir}")
    except Exception as e:
        add("NMS", "Export files readable", False, str(e))
    return out


def main():
    ap = argparse.ArgumentParser(description="Check that Peyto Checker can reach every system (read-only)")
    ap.add_argument("--lsi", help="one real LSI to try end to end (optional)")
    a = ap.parse_args()
    s = settings_mod.load()
    client = None
    if s.auth_mode == "olm":
        # Same as the UI: OLM ID + password + OTP, typed here, kept only in memory
        import getpass
        from .chitragupt import make as make_chit
        olm = input("OLM ID: ").strip()
        pw = getpass.getpass("OLM password (not shown, not saved): ")
        client = make_chit(s)
        try:
            if client.start_login(olm, pw) == "otp_required":
                client.submit_otp(input("OTP: ").strip())
        except ConnectorError as e:
            print(f"FAIL  Chitragupt login: {e}")
        s = s.for_user(olm, pw)
    res = run(s, lsi=a.lsi, chitragupt_client=client)
    if client:
        client.close()
    w = max(len(r["system"] + r["check"]) for r in res) + 3
    for r in res:
        print(f"{'PASS' if r['ok'] else 'FAIL'}  {(r['system'] + ': ' + r['check']).ljust(w)} {r['detail']}")
    bad = sum(not r["ok"] for r in res)
    print(f"\n{len(res) - bad}/{len(res)} checks passed" + ("" if not bad else " - fix the FAIL lines above"))
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
