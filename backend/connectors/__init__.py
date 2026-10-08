"""Connectors to the outside systems. Same interface in demo and live mode:

    chitragupt.lookup(lsi)          -> Lookup  (LSI -> CKT IDs)
    ssh.lookup(lsi, tier_hint)      -> Lookup  (PuTTY fallback on T3/T4 nodes)
    nms                              -> Inventory (services, tunnels, rings from NMS export)
"""
from .settings import Settings, load as load_settings
from .base import Lookup, ConnectorError
