"""
Peyto feasibility as a graph problem.

Ring = graph (NEs are nodes, fibres/links are edges). Each Peyto router hangs off a
gateway NE through a B2B NNI link. A service is:
  * Feasible - Protected   : customer mux reaches Peyto over 2 node-disjoint healthy paths
  * Feasible - Unprotected : only 1 healthy path (single homed, or a path is broken)
  * Not Feasible           : no healthy path
Links with an active alarm are removed before the check, so the answer reflects current health.
"""
import networkx as nx

SINK = "__PEYTO__"


def build_graph(ring, healthy_only=True):
    g = nx.Graph()
    for n in ring.nodes:
        g.add_node(n["node"], role=n["role"])
        if n["peyto_router"]:
            g.add_node(n["peyto_router"], role="PEYTO")
    for l in ring.links:
        if healthy_only and l["status"] != "OK":
            continue
        g.add_edge(l["a"], l["b"])
    return g


def check(ring, customer_mux, labels):
    if ring is None or customer_mux not in {n["node"] for n in ring.nodes}:
        return {"status": "not_feasible", "label": labels["not_feasible"], "paths": [],
                "reason": "Customer mux is not on the ring"}

    g = build_graph(ring)
    for p in ring.peyto_routers:
        if p in g:
            g.add_edge(p, SINK)
    if SINK not in g or not nx.has_path(g, customer_mux, SINK):
        broken = [l for l in ring.links if l["status"] != "OK"]
        why = "No healthy path from customer mux to any Peyto router"
        if broken:
            why += " (alarm on " + ", ".join(f'{_short(l["a"])}-{_short(l["b"])}' for l in broken) + ")"
        return {"status": "not_feasible", "label": labels["not_feasible"], "paths": [], "reason": why}

    paths = [p[:-1] for p in nx.node_disjoint_paths(g, customer_mux, SINK)]
    paths.sort(key=lambda p: (0 if "#1" in p[-1] else 1, len(p)))      # Peyto#1 side = primary
    out = [{"role": "primary" if i == 0 else "secondary", "peyto": p[-1], "hops": p} for i, p in enumerate(paths[:2])]

    if len(paths) >= 2:
        return {"status": "protected", "label": labels["protected"], "paths": out,
                "reason": f"Primary via {out[0]['peyto']} and secondary via {out[1]['peyto']}, both healthy"}

    single = len(ring.peyto_routers) < 2
    alarms = [l for l in ring.links if l["status"] != "OK"]
    if single:
        why = "Single homed: ring has only one Peyto router, no secondary path"
    elif alarms:
        why = "Secondary path broken by alarm on " + ", ".join(
            f'{_short(l["a"])}-{_short(l["b"])} ({l["alarm"]})' for l in alarms)
    else:
        why = "Second path shares a node with the first, not truly diverse"
    return {"status": "unprotected", "label": labels["unprotected"], "paths": out, "reason": why}


def _short(node):
    """PUN_TNGMH_SGT_P_E51025 -> E51025"""
    return node.split("_")[-1] if "_" in node else node
