"""Data access layer for NMS (LightSoft) data.

Today it reads CSV/Excel exports from a folder. In demo mode that folder is
sample_data/; in live mode it is NMS_EXPORT_DIR (files exported from LightSoft).
Real export column names are mapped in config/nms_export.yaml, so a new export
format needs a config change, not a code change. Later this class can be
swapped for an NBI/API client with the same methods.
"""
from dataclasses import dataclass, field
from pathlib import Path
import pandas as pd
import yaml

DATA_DIR = Path(__file__).resolve().parent.parent / "sample_data"
MAP_PATH = Path(__file__).resolve().parent.parent / "config" / "nms_export.yaml"

# internal column names the engine expects, per table
REQUIRED = {
    "services": ["ckt_id", "service_type", "ring", "customer_mux", "bsc_leaf", "bsc_root", "root_ports", "signaling_enabled"],
    "tunnels": ["ckt_id", "tunnel", "mspw_role", "protection", "cc_cos", "bfd_ms"],
    "ring_nodes": ["ring", "kind", "order", "node", "role", "peyto_router"],
    "ring_links": ["ring", "node_a", "node_b", "link_type", "status", "alarm"],
}


@dataclass
class Ring:
    name: str
    kind: str                                   # "ring" (closed) or "linear"
    nodes: list = field(default_factory=list)   # [{node, role, order, peyto_router}]
    links: list = field(default_factory=list)   # [{a, b, type, status, alarm}]

    @property
    def peyto_routers(self):
        return [n["peyto_router"] for n in self.nodes if n["peyto_router"]]


def _load_mapping():
    if MAP_PATH.exists():
        return yaml.safe_load(MAP_PATH.read_text()) or {}
    return {}


def _read_table(data_dir: Path, table: str, mapping: dict) -> pd.DataFrame:
    spec = (mapping.get("tables") or {}).get(table) or {}
    fname = spec.get("file", f"{table}.csv")
    path = data_dir / fname
    if not path.exists():
        raise FileNotFoundError(f"NMS export file missing: {path.name} (table '{table}')")
    df = pd.read_csv(path, dtype=str) if path.suffix.lower() == ".csv" else pd.read_excel(path, dtype=str)
    df = df.fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    rename = {v: k for k, v in (spec.get("columns") or {}).items() if v in df.columns}
    df = df.rename(columns=rename)
    for col, default in (spec.get("defaults") or {}).items():
        if col not in df.columns:
            df[col] = str(default)
    missing = [c for c in REQUIRED[table] if c not in df.columns]
    if missing:
        raise ValueError(f"{path.name}: columns not found {missing}. Map them in config/nms_export.yaml")
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
    return df


class Inventory:
    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = Path(data_dir)
        m = _load_mapping()
        self.services = _read_table(self.data_dir, "services", m)
        self.tunnels = _read_table(self.data_dir, "tunnels", m)
        nodes, links = _read_table(self.data_dir, "ring_nodes", m), _read_table(self.data_dir, "ring_links", m)
        self.rings = {}
        for name, g in nodes.groupby("ring", sort=False):
            r = Ring(name, g["kind"].iloc[0] or "ring")
            r.nodes = [{"node": x.node, "role": x.role, "order": int(x.order or 0), "peyto_router": x.peyto_router}
                       for x in g.sort_values("order", key=lambda s: pd.to_numeric(s, errors="coerce")).itertuples()]
            r.links = [{"a": x.node_a, "b": x.node_b, "type": x.link_type, "status": x.status or "OK", "alarm": x.alarm}
                       for x in links[links.ring == name].itertuples()]
            self.rings[name] = r

    # ---- lookups -------------------------------------------------------------
    def services_for_ckt(self, ckt_id: str):
        """Exact match first, then case-insensitive."""
        ckt_id = str(ckt_id).strip()
        hit = self.services[self.services.ckt_id == ckt_id]
        if hit.empty:
            hit = self.services[self.services.ckt_id.str.upper() == ckt_id.upper()]
        return hit.to_dict("records")

    def ckts_for_lsi(self, lsi: str):
        """Only used when the export itself carries an LSI column (old demo path)."""
        if "lsi" not in self.services.columns:
            return []
        lsi = str(lsi).strip().split(".")[0]
        return self.services[self.services.lsi == lsi].to_dict("records")

    def tunnels_for(self, ckt_id: str):
        return self.tunnels[self.tunnels.ckt_id == ckt_id].to_dict("records")

    def overview(self):
        return {
            "rings": len(self.rings),
            "nodes": sum(len(r.nodes) for r in self.rings.values()),
            "peyto_routers": sum(len(r.peyto_routers) for r in self.rings.values()),
            "services": int(self.services.ckt_id.nunique()),
            "lsis": int(self.services.lsi.nunique()) if "lsi" in self.services.columns else 0,
            "alarmed_links": sum(1 for r in self.rings.values() for l in r.links if l["status"] != "OK"),
        }
