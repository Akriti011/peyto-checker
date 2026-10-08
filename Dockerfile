# Peyto Checker: one image with the built Angular UI + FastAPI backend.
#   docker compose up -d          (reads .env for PEYTO_MODE and secrets)

# ---- 1) build the UI ----
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx ng build --configuration production

# ---- 2) runtime ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
# Optional headless Chrome for chitragupt.strategy=browser:  docker build --build-arg WITH_BROWSER=1 .
ARG WITH_BROWSER=0
RUN if [ "$WITH_BROWSER" = "1" ]; then pip install --no-cache-dir playwright && python -m playwright install --with-deps chromium; fi
COPY backend/ backend/
COPY mock_systems/ mock_systems/
COPY --from=ui /ui/dist/peyto-ui/browser frontend/dist/peyto-ui/browser
RUN useradd -m peyto && mkdir -p /data/nms_exports && chown -R peyto /data /app
USER peyto
WORKDIR /app/backend
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
