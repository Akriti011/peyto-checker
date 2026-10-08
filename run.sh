#!/usr/bin/env bash
# Starts Peyto Checker at http://localhost:8000 (UI already built in frontend/dist)
# Mode (demo / live) comes from .env -> PEYTO_MODE
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "[i] Created .env from .env.example (demo mode)"; }
cd backend
python3 -m pip install -q -r requirements.txt
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
