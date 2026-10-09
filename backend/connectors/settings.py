"""One place that decides demo vs live and where every setting comes from.

Non-secret settings: backend/config/connectors.yaml
Secrets + mode:      .env in the project root (copy .env.example), or real env vars
"""
import os
from dataclasses import dataclass, replace
from pathlib import Path

import yaml

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
CFG_PATH = BACKEND / "config" / "connectors.yaml"

try:                                   # .env is optional; real env vars always win
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)
except ImportError:
    pass


def _nodes_from_env(name):
    v = os.getenv(name, "").strip()
    return [x.strip() for x in v.split(",") if x.strip()]


@dataclass
class Settings:
    mode: str
    cfg: dict
    chitragupt_url: str
    chitragupt_user: str
    chitragupt_pass: str
    ssh_user: str
    ssh_pass: str
    ssh_jump_host: str
    ssh_jump_user: str
    ssh_jump_pass: str
    ssh_nodes: dict
    nms_export_dir: Path

    @property
    def is_demo(self):
        return self.mode == "demo"

    @property
    def auth_mode(self):
        return (self.cfg.get("auth") or {}).get("mode", "service")

    def for_user(self, olm_id: str, password: str) -> "Settings":
        """Copy used for one logged-in user's jobs: SSH logs in with their OLM ID.
        The password only ever lives in memory."""
        if not (self.cfg.get("auth") or {}).get("ssh_uses_olm", True):
            return self
        return replace(self, ssh_user=olm_id, ssh_pass=password,
                       ssh_jump_user=olm_id if not os.getenv("SSH_JUMP_USER") else self.ssh_jump_user,
                       ssh_jump_pass=password if not os.getenv("SSH_JUMP_PASS") else self.ssh_jump_pass)

    def public(self):
        """Safe to show in the UI: no secrets."""
        return {
            "mode": self.mode,
            "auth": self.auth_mode,
            "chitragupt": {"strategy": self.cfg["chitragupt"]["strategy"], "url_set": bool(self.chitragupt_url),
                           "login_set": bool(self.chitragupt_user)},
            "ssh": {"tiers": {k: len(v) for k, v in self.ssh_nodes.items()}, "jump_host": bool(self.ssh_jump_host),
                    "device_type": self.cfg["ssh"]["device_type"]},
            "nms": {"source": self.cfg["nms"]["source"], "export_dir": str(self.nms_export_dir)},
        }


def load() -> Settings:
    cfg = yaml.safe_load(CFG_PATH.read_text())
    if os.getenv("PEYTO_AUTH"):                       # olm | service, overrides connectors.yaml
        cfg.setdefault("auth", {})["mode"] = os.getenv("PEYTO_AUTH").strip().lower()
    mode = os.getenv("PEYTO_MODE", "demo").strip().lower()
    if mode not in ("demo", "live"):
        raise ValueError(f"PEYTO_MODE must be demo or live, got '{mode}'")
    side = mode

    if mode == "demo":
        url = cfg["chitragupt"]["demo"]["base_url"]
        cu, cp = "svc_demo", os.getenv("MOCK_CHITRAGUPT_PASSWORD", "demo")   # svc_* = no OTP in the fake portal
        su, sp = "demo-user", os.getenv("MOCK_SSH_PASSWORD", "demo")
        nodes = cfg["ssh"]["demo"]["nodes"]
        export = BACKEND / cfg["nms"]["demo"]["export_dir"]
        jump = juser = jpass = ""
    else:
        url = os.getenv("CHITRAGUPT_URL", cfg["chitragupt"]["live"]["base_url"] or "")
        cu, cp = os.getenv("CHITRAGUPT_USER", ""), os.getenv("CHITRAGUPT_PASS", "")
        su, sp = os.getenv("SSH_USER", ""), os.getenv("SSH_PASS", "")
        nodes = {t: _nodes_from_env(f"SSH_{t}_NODES") or list(cfg["ssh"][side]["nodes"].get(t) or [])
                 for t in cfg["ssh"]["tier_order"]}
        d = os.getenv("NMS_EXPORT_DIR", cfg["nms"]["live"]["export_dir"] or "")
        export = Path(d) if d else BACKEND / "nms_exports"
        jump, juser, jpass = os.getenv("SSH_JUMP_HOST", ""), os.getenv("SSH_JUMP_USER", ""), os.getenv("SSH_JUMP_PASS", "")

    return Settings(mode, cfg, url.rstrip("/"), cu, cp, su, sp, jump, juser or su, jpass or sp, nodes, Path(export))
