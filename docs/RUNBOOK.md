# Peyto Checker – Runbook

How to install, run, switch to live mode and troubleshoot.

## 1. What it does

Upload an Excel of LSIs → for every LSI the tool:

1. searches **Chitragupt** for the CKT ID
2. if not found, logs in to the **T3 (202.123.x.x) / T4 (116.119.x.x) MPLS nodes** over SSH and runs a read-only `show` command (the PuTTY step)
3. looks the CKT up in the **LightSoft NMS export** (ring, customer mux, tunnels)
4. checks **primary + secondary path to B2B Peyto** and the ECI design rules
5. returns the same Excel with result columns, colours, remarks and a per-LSI lookup log

If any system does not answer, that LSI is marked **Manual Check Needed** and the batch continues.

## 2. Modes

| | demo | live |
|---|---|---|
| Where | any laptop | Airtel network / internal VM only |
| Chitragupt | fake portal on :8101 | real Chitragupt, read-only service account |
| T3/T4 nodes | fake SSH nodes on :2201 / :2202 | real nodes, read-only account |
| NMS | `backend/sample_data/` | LightSoft export files in `NMS_EXPORT_DIR` |
| Data | synthetic | real |

Switch with one line in `.env`: `PEYTO_MODE=demo` or `PEYTO_MODE=live`. No code change.

## 3. Run without Docker (laptop)

```bash
cp .env.example .env          # first time only
./run.sh                      # Windows: run.bat
```
Open http://localhost:8000 → Run Check → "Try demo sheet".

## 4. Run with Docker (internal VM)

```bash
cp .env.example .env          # fill it, PEYTO_MODE=live
mkdir -p nms_exports          # put LightSoft export files here
docker compose up -d --build
docker compose logs -f        # watch
```
Open http://<vm-ip>:8000. Update: `git pull && docker compose up -d --build`.
For the headless-browser Chitragupt strategy build with `--build-arg WITH_BROWSER=1`.

## 5. Going live – checklist

1. **Preflight** (read-only, safe to run any time):
   ```bash
   cd backend && python -m connectors.preflight --lsi <one real LSI>
   ```
   or open `http://<host>:8000/api/preflight`. Every line must say PASS.
2. **Chitragupt**: set `CHITRAGUPT_URL`, `CHITRAGUPT_USER/PASS` (service account).
   Find the search API once with F12 → Network and put it in
   `backend/config/connectors.yaml → chitragupt.api.search_path`.
   No clean API? set `strategy: browser` and fill the selectors.
3. **SSH**: set `SSH_USER/PASS`, `SSH_T3_NODES`, `SSH_T4_NODES`, jump server if any.
   In `connectors.yaml` set `ssh.device_type` (e.g. `cisco_xr`) and the exact `ssh.command`.
4. **NMS**: export the L2VPN service list / topology from LightSoft into `NMS_EXPORT_DIR`
   (or upload via `POST /api/nms-export`). Map the header names in
   `backend/config/nms_export.yaml`.
5. **Rules**: team's feasibility labels and thresholds in `backend/config/rules.yaml`.
6. **Validate**: run 20–30 LSIs that were already done by hand, compare, fix rules.

## 6. Login (OLM ID + OTP)

With `PEYTO_AUTH=olm` (default) every user logs in from the Check page with their
**OLM ID + password**, then the **OTP** Chitragupt sends. The same OLM login is used
for the T3/T4 SSH step (and later CFM / LightSoft NMS).

- The password stays only in the server's memory for that session; never on disk, never in logs, never sent back to the browser.
- Auto logout after 60 min idle or 8 h (`auth.idle_minutes`, `auth.max_hours` in `connectors.yaml`).
- Each user sees only their own results.
- If Chitragupt logs the bot out mid-batch, the rest of the LSIs become Manual Check and the UI asks to log in again.
- Demo: any OLM ID, password `demo`, OTP `123456`.
- If IT later gives a bot ID without OTP: `PEYTO_AUTH=service` and fill the service accounts in `.env`.
- Preflight on the command line asks for OLM ID, password and OTP the same way.

## 7. Security rules

- Either the user's own OLM login (typed in the UI, memory only) or read-only service accounts. Never a password in code or config.
- Secrets live only in `.env` (git-ignored) or the VM's environment.
- SSH sends only commands starting with `show` / `display`; anything else is blocked in code.
- One batch at a time, small delay between Chitragupt searches.
- The app never writes to Chitragupt, the nodes or the NMS.

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every row "Manual Check Needed" | a system is unreachable or `.env` incomplete | run preflight, read the FAIL line |
| Chitragupt step `error HTTP 401` | service account wrong / session expired | check `CHITRAGUPT_USER/PASS` |
| SSH `NetmikoTimeoutException` | node not reachable from this machine / needs jump server | set `SSH_JUMP_HOST` |
| SSH finds nothing but PuTTY does | wrong `device_type` or command | copy the exact PuTTY command into `ssh.command` |
| "CKT not in NMS export" | export is old or column mapping wrong | re-export, check `nms_export.yaml` |
| CKT IDs not picked up | different ID format | adjust `ckt_id_regex` in `connectors.yaml` |

Logs: terminal / `docker compose logs`. Each result Excel also has a **Lookup Log** sheet.

## 9. Tests

```bash
cd backend && python -m pytest -q
```
