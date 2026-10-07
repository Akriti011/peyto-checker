@echo off
REM Starts the POC at http://localhost:8000 (UI already built in frontend\dist)
cd /d "%~dp0backend"
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
