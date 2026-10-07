# Peyto Checker (POC)

**LSI sheet in → Peyto feasibility out.** An internal POC for the Airtel NOC team working on the ECI NPT network.

1. Reads the LSI sheet (Excel/CSV, any column whose header contains "LSI")
2. Finds the CKT ID(s) for every LSI
3. Traces primary and secondary paths on the NPT ring to the Peyto routers (graph check, alarmed links removed)
4. Checks the service against 7 points from *ECI Design Guidelines for NPT Network using MSPW v5.2*
5. Returns a filled Excel: original sheet + `Peyto Result` + `Summary`

> ⚠️ **Everything in `backend/sample_data/` is DEMO data.** Ring and node names for MAH4P01A04 and APM4P36C02 come from the training deck so the demo feels familiar. LSI numbers, customer codes, tunnels, alarms and ring MAH4P02B11 are invented. Do not use the demo results for real work.

---

## Quick start (only Python needed)

The UI is already built into `frontend/dist`, so Node.js is **not** needed just to run the demo.

```bash
# Windows
run.bat
# Linux / macOS
./run.sh
```

Open **http://localhost:8000** → **Run Check** → **Try Demo Sheet**.

Run the engine tests:
```bash
cd backend && python -m pytest -q
```

## UI development (Angular)

Needs Node.js 20.19+ / 22.12+.
```bash
cd backend && python -m uvicorn app.main:app --port 8000     # terminal 1
cd frontend && npm install && npx ng serve                    # terminal 2 → http://localhost:4200
cd frontend && npx ng build                                   # rebuild dist for the Python server
```

---

## Project structure

```
backend/
  app/main.py            FastAPI: /api/check, /api/download, /api/rings, /api/rules, serves the UI
  engine/data.py         Data access. TODAY: CSV files. LATER: swap for NBI / OSS calls
  engine/feasibility.py  Peyto feasibility = node-disjoint paths (NetworkX)
  engine/rules.py        ECI guideline checks
  engine/pipeline.py     LSI list → results (no web code, can run from a script/cron)
  engine/report.py       Styled Excel output
  config/rules.yaml      Thresholds + feasibility labels (edit here, not in code)
  sample_data/           DEMO data (see warning above)
  tools/make_sample_data.py
  tests/test_engine.py
frontend/                Angular 21 (standalone components, signals)
  src/app/pages/         landing, console (check), rings, rules
  src/app/components/    header, ring-bg (animated network background), ring-map (SVG topology)
```

## Plugging in real data

`engine/data.py` reads four CSV files. Produce them from LightSoft exports (or later from the NBI) and the rest of the app works unchanged.

| File | Columns |
|---|---|
| `services.csv` | lsi, ckt_id, service_type, ring, customer_mux, bsc_leaf, bsc_root, root_ports, signaling_enabled |
| `ring_nodes.csv` | ring, kind (`ring`/`linear`), order, node, role (`NE`/`PRI-GTW`/`SEC-GTW`), peyto_router |
| `ring_links.csv` | ring, node_a, node_b, link_type (`RING`/`B2B-NNI`), status (`OK`/`ALARM`), alarm |
| `tunnels.csv` | ckt_id, tunnel, mspw_role (`main`/`standby`), protection, cc_cos, bfd_ms |

Likely sources in LightSoft: L2VPN Service List (+ Endpoints tab), *Show Ring → Ring Links*, *Ring Affecting Alarms*, Tunnel List / OAM status.

## Assumptions to confirm with the team

1. **LSI → CKT ID:** the POC assumes the LSI is stored in the service's **Customer** field (the deck shows a 7-digit number there). If the mapping lives elsewhere, change `Inventory.ckts_for_lsi()`.
2. **Peyto feasibility rule:** POC definition is *two node-disjoint, alarm-free paths from the customer mux to the Peyto routers = Protected; one = Unprotected; none = Not Feasible*. Confirm the exact rule and the values your sheet uses, then edit `feasibility_labels` in `rules.yaml`.
3. **Peyto routers** are modelled as the Cisco E-VPN router pair (Peyto#1 / Peyto#2) hanging off the PRI/SEC gateways through B2B NNI links, based on Scenario 13 of the ECI guideline.

## Design notes

- Palette is limited to red, white and light pink (plus a dark maroon for body text).
- Layout and motion follow the reference landing-page spec (single viewport, pill nav, staggered reveal, dot-matrix headline, count-up stats, mobile sheet menu). Changes from that spec:
  - The stock background video is replaced by a code-drawn **animated NPT ring** (packets running primary/secondary paths). It works offline and fits the project.
  - Fonts: general text uses Times New Roman (system font); the hero and titles use the **Doto** dot-matrix font. Doto and Font Awesome are bundled via npm, so nothing loads from external CDNs inside the office network.
  - Third-party brand logos are replaced with network icons.
- `frontend/public/assets/logo.svg` is an original placeholder mark. If you have the official logo file from the brand kit, drop it in and update `header.html`.

## Safety

- The checker is **read-only**. It never changes anything in the network.
- Never put the shared NMS password or personal credentials in this code or in config files. A future NBI connector should use a dedicated read-only account approved by the NMS team.
