"""Data access layer. Today it reads CSV exports; later swap these functions for NBI/OSS calls."""
from dataclasses import dataclass, field
from pathlib import Path
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "sample_data"


@dataclass
class Ring:
    name: str
    kind: str                                   # "ring" (closed) or "linear"
    nodes: list = field(default_factory=list)   # [{node, role, order, peyto_router}]
    links: list = field(default_factory=list)   # [{a, b, type, status, alarm}]

    @property
    def peyto_routers(self):
        return [n["peyto_router"] for n in self.nodes if n["peyto_router"]]


class Inventory:
    def __init__(self, data_dir: Path = DATA_DIR):
        rd = lambda f: pd.read_csv(data_dir / f, dtype=str).fillna("")
        self.services = rd("services.csv")
        self.tunnels = rd("tunnels.csv")
        nodes, links = rd("ring_nodes.csv"), rd("ring_links.csv")
        self.rings = {}
        for name, g in nodes.groupby("ring", sort=False):
            r = Ring(name, g["kind"].iloc[0])
            r.nodes = [{"node": x.node, "role": x.role, "order": int(x.order), "peyto_router": x.peyto_router}
                       for x in g.sort_values("order", key=lambda s: s.astype(int)).itertuples()]
            r.links = [{"a": x.node_a, "b": x.node_b, "type": x.link_type, "status": x.status, "alarm": x.alarm}
                       for x in links[links.ring == name].itertuples()]
            self.rings[name] = r

    # ---- LSI -> CKT lookup -------------------------------------------------
    # Assumption to verify: the LSI is stored in the service's Customer field in LightSoft.
    def ckts_for_lsi(self, lsi: str):
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
            "lsis": int(self.services.lsi.nunique()),
            "alarmed_links": sum(1 for r in self.rings.values() for l in r.links if l["status"] != "OK"),
        }
