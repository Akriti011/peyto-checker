#!/usr/bin/env bash
# Starts the POC at http://localhost:8000 (UI already built in frontend/dist)
cd "$(dirname "$0")/backend"
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --port 8000
