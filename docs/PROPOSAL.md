# Proposal: Peyto Checker – automated Peyto feasibility for NPT circuits

**Prepared by:** Akriti Kumari, Network Engineer, TAC2_OPTICS
**Status:** Working, deployable POC (demo mode). Requesting access to run it live.

## The problem

Peyto feasibility for a batch of LSIs is done by hand, one LSI at a time:

1. search the LSI in Chitragupt to get the CKT ID
2. if Chitragupt has nothing, log in to a T3 / T4 MPLS node with PuTTY to find it
3. open the circuit in LightSoft and check the primary and secondary path to B2B Peyto
4. type the result back into the Excel

This is slow, repetitive and easy to get wrong when the list is long.

## What the POC does

Upload the LSI Excel, get the same Excel back with:

- CKT ID and where it was found (Chitragupt or T3/T4 node)
- Peyto feasibility: Protected / Unprotected / Not Feasible / CKT Not Found / Manual Check
- primary and secondary path, ECI design-rule check, remarks
- a lookup log for every LSI, so every answer can be traced and verified

Anything the tool is unsure about is marked **Manual Check Needed**, never guessed.

## What is already built

| Part | Status |
|---|---|
| Web UI (Airtel themed), Excel in / Excel out | Done |
| Chitragupt connector (API or headless browser) | Done, tested on a simulator |
| T3/T4 SSH fallback (PuTTY step, read-only commands only) | Done, tested on simulated nodes |
| LightSoft NMS export reader (configurable column mapping) | Done |
| Feasibility engine (primary/secondary to Peyto) + ECI design rules | Done |
| Retries, per-LSI error handling, live progress | Done |
| Docker package, `.env` secrets, runbook, preflight check | Done |
| Demo mode with simulated Chitragupt / nodes / NMS (no Airtel data) | Done |

Switching from demo to live is a configuration change (`PEYTO_MODE=live`), not a code change.

## Safety by design

- Read-only service accounts only. No personal IDs, no shared passwords in code.
- SSH can only send `show` / `display` commands; everything else is blocked in code.
- Never writes to Chitragupt, network elements or the NMS.
- One batch at a time with a delay between searches, so no load on Chitragupt.
- Runs only inside the Airtel network.

## What I need

1. **Read-only Chitragupt service account**
2. **Read-only SSH account** for the T3 / T4 MPLS nodes (and jump server details if used)
3. **LightSoft export access** (L2VPN service list / topology export); later NBI if possible
4. **One internal Linux VM** with Docker (2 vCPU, 4 GB RAM is enough)
5. **1–2 weeks** to validate on 20–30 already-checked LSIs before team use

## Plan

| Week | Work |
|---|---|
| 1 | Accounts + VM, run preflight, adjust connectors to the real formats |
| 2 | Validation: tool vs manual results on known LSIs, fix rules |
| 3 | Pilot with the team, feedback, handover runbook |

## Expected benefit

- Batch of LSIs checked in minutes instead of hours
- Same rules applied every time, with a traceable log
- Engineers spend time only on the LSIs marked for manual check
