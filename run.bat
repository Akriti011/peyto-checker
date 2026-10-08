@echo off
REM Starts Peyto Checker at http://localhost:8000  (mode from .env -> PEYTO_MODE)
cd /d %~dp0
if not exist .env copy .env.example .env
cd backend
python -m pip install -q -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
