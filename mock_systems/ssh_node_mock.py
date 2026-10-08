"""Fake T3 / T4 MPLS nodes over SSH (demo only). This replaces the real
PuTTY login so the SSH fallback can be shown end to end.

  T3 node -> 127.0.0.1:2201  (stands in for a 202.123.x.x node)
  T4 node -> 127.0.0.1:2202  (stands in for a 116.119.x.x node)

Login: any username, password "demo". Only "show ..." commands work, just like
a read-only account. Output is a router-style table with the circuit ID.
Run:  python -m mock_systems.ssh_node_mock
"""
import os, re, socket, threading
import paramiko

from mock_systems.common import split

_, NODE_DATA = split()
PASSWORD = os.getenv("MOCK_SSH_PASSWORD", "demo")
HOST_KEY = paramiko.RSAKey.generate(2048)
NODES = {
    "T3": {"port": int(os.getenv("MOCK_T3_PORT", "2201")), "hostname": "T3-MPLS-202-DEMO"},
    "T4": {"port": int(os.getenv("MOCK_T4_PORT", "2202")), "hostname": "T4-MPLS-116-DEMO"},
}


class _Server(paramiko.ServerInterface):
    def __init__(self):
        self.shell = threading.Event()

    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL if password == PASSWORD else paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password"

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, *a):
        return True

    def check_channel_shell_request(self, channel):
        self.shell.set()
        return True


def answer(tier: str, cmd: str) -> str:
    cmd = cmd.strip()
    if not cmd:
        return ""
    if cmd.startswith("terminal") or cmd.startswith("screen-length"):
        return ""
    if not cmd.startswith("show"):
        return "% Permission denied: read-only demo account\r\n"
    data = NODE_DATA[tier]
    tokens = [w for w in re.findall(r"[A-Za-z0-9_-]+", cmd) if w in data]
    lines = ["Interface            State  Type    Description"]
    for lsi in tokens:
        for i, ckt in enumerate(data.get(lsi, [])):
            lines.append(f"Gi0/0/0/{i + 1}.{lsi[-4:]:<10} UP     L2VPN   LSI-{lsi} CKT:{ckt}")
    return ("\r\n".join(lines) if len(lines) > 1 else "") + "\r\n"


def _session(client, tier):
    t = paramiko.Transport(client)
    t.add_server_key(HOST_KEY)
    srv = _Server()
    try:
        t.start_server(server=srv)
        chan = t.accept(20)
        if chan is None or not srv.shell.wait(10):
            return
        prompt = f"{NODES[tier]['hostname']}#"
        chan.send(f"\r\nDEMO {tier} MPLS NODE (synthetic data)\r\n{prompt}")
        buf, last = "", ""
        while True:
            data = chan.recv(1024)
            if not data:
                break
            for ch in data.decode(errors="ignore"):
                if ch in "\r\n":
                    if ch == "\n" and last == "\r":      # CRLF = one Enter
                        last = ch
                        continue
                    last = ch
                    cmd, buf = buf, ""
                    if cmd.strip() in ("exit", "quit", "logout"):
                        chan.send("\r\n")
                        chan.close()
                        return
                    chan.send("\r\n" + answer(tier, cmd) + prompt)
                elif ch in "\x08\x7f":
                    last = ch
                    buf = buf[:-1]
                else:
                    last = ch
                    buf += ch
                    chan.send(ch)          # echo, like a real terminal
    except Exception:
        pass
    finally:
        t.close()


def _listen(tier):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((os.getenv("MOCK_HOST", "127.0.0.1"), NODES[tier]["port"]))
    s.listen(20)
    while True:
        c, _ = s.accept()
        threading.Thread(target=_session, args=(c, tier), daemon=True).start()


def start_background():
    for tier in NODES:
        threading.Thread(target=_listen, args=(tier,), daemon=True).start()


if __name__ == "__main__":
    start_background()
    print("Fake T3 node on :%d, fake T4 node on :%d (Ctrl+C to stop)" % (NODES["T3"]["port"], NODES["T4"]["port"]))
    threading.Event().wait()
