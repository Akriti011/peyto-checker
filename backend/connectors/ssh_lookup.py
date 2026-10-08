"""SSH fallback = the PuTTY step, automated.

When Chitragupt has no CKT ID, a person logs into a T3 (202.123.x.x) or
T4 (116.119.x.x) MPLS node with PuTTY and runs a show command. This does the
same with Netmiko:

  1. pick the tier (hint from Chitragupt if any, else tier_order: T3 then T4)
  2. SSH to each node of that tier (optionally through a jump server)
  3. run the configured READ-ONLY command with the LSI filled in
  4. pull the CKT ID out of the output with the same regex

Safety: only commands starting with an allowed prefix ("show"/"display") are
ever sent, nothing with ';' or new lines, and never config mode.
"""
import time

from .base import ConfigError, ConnectorError, Lookup, extract_ckts


class SshCktFinder:
    def __init__(self, s):
        self.s = s
        self.c = s.cfg["ssh"]
        self.regex = s.cfg["ckt_id_regex"]
        self._conns = {}            # node -> open netmiko connection (reused within a batch)

    # ---- safety -----------------------------------------------------------------
    def build_command(self, lsi: str) -> str:
        if not lsi.replace("-", "").replace("_", "").isalnum():
            raise ConfigError(f"Refusing unsafe LSI value for SSH: {lsi!r}")
        cmd = self.c["command"].format(lsi=lsi).strip()
        prefixes = tuple(self.c.get("allowed_command_prefixes") or ["show"])
        if not cmd.startswith(prefixes) or any(x in cmd for x in (";", "\n", "\r", "&&")) \
                or cmd.split()[0].lower().startswith("conf"):
            raise ConfigError(f"Blocked non read-only command: {cmd!r}")
        return cmd

    # ---- connection ----------------------------------------------------------------
    def _jump_sock(self, host, port):
        import paramiko
        j = paramiko.SSHClient()
        j.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        jh, _, jp = self.s.ssh_jump_host.partition(":")
        j.connect(jh, port=int(jp or 22), username=self.s.ssh_jump_user, password=self.s.ssh_jump_pass,
                  timeout=self.c["timeout_seconds"], look_for_keys=False, allow_agent=False)
        return j.get_transport().open_channel("direct-tcpip", (host, port), ("127.0.0.1", 0))

    def _connect(self, node: str):
        if node in self._conns:
            return self._conns[node]
        try:
            from netmiko import ConnectHandler
        except ImportError:
            raise ConfigError("netmiko is not installed (pip install netmiko)")
        if not self.s.ssh_user:
            raise ConfigError("SSH_USER is not set in .env")
        host, _, port = node.partition(":")
        params = dict(device_type=self.c["device_type"], host=host, port=int(port or 22),
                      username=self.s.ssh_user, password=self.s.ssh_pass,
                      conn_timeout=self.c["timeout_seconds"], auth_timeout=self.c["timeout_seconds"],
                      banner_timeout=self.c["timeout_seconds"], fast_cli=False)
        try:
            if self.s.ssh_jump_host:
                params["sock"] = self._jump_sock(host, int(port or 22))
            conn = ConnectHandler(**params)
        except Exception as e:
            raise ConnectorError(f"SSH to {node} failed: {type(e).__name__}")
        self._conns[node] = conn
        return conn

    # ---- lookup ----------------------------------------------------------------
    def tiers_to_try(self, hint: str | None = None):
        order = list(self.c["tier_order"])
        if hint and hint in order:
            order.remove(hint)
            order.insert(0, hint)
        return order

    def lookup(self, lsi: str, tier_hint: str | None = None) -> Lookup:
        t0 = time.perf_counter()
        cmd = self.build_command(lsi)
        tried, errors = [], []
        for tier in self.tiers_to_try(tier_hint):
            for node in self.s.ssh_nodes.get(tier) or []:
                tried.append(f"{tier} {node}")
                try:
                    out = self._connect(node).send_command(cmd, read_timeout=self.c["timeout_seconds"])
                except ConfigError:
                    raise
                except ConnectorError as e:
                    errors.append(str(e))
                    continue
                except Exception as e:
                    self._drop(node)
                    errors.append(f"{node}: {type(e).__name__}")
                    continue
                ckts = extract_ckts(out, self.regex)
                if ckts:
                    return Lookup("ssh", "found", ckts, note=f"Found on {tier} node {node}",
                                  detail={"tier": tier, "node": node, "command": cmd}, ms=_ms(t0))
        if not tried:
            raise ConfigError("No T3/T4 nodes configured (SSH_T3_NODES / SSH_T4_NODES in .env)")
        if errors and len(errors) == len(tried):
            raise ConnectorError("; ".join(errors[:3]))
        return Lookup("ssh", "not_found", note=f"Not on {len(tried)} node(s): " + ", ".join(tried[:4]),
                      detail={"tried": tried, "errors": errors}, ms=_ms(t0))

    def _drop(self, node):
        c = self._conns.pop(node, None)
        if c:
            try:
                c.disconnect()
            except Exception:
                pass

    def close(self):
        for n in list(self._conns):
            self._drop(n)


def _ms(t0):
    return round((time.perf_counter() - t0) * 1000, 1)
