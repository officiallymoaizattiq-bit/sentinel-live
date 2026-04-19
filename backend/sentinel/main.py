from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from sentinel import webhooks as webhooks_mod
from sentinel.api import router
from sentinel.config import get_settings
from sentinel.db import close_db, ensure_indexes, get_db
from sentinel.scheduler import start as scheduler_start
from sentinel.scheduler import stop as scheduler_stop
from sentinel.vitals import ensure_demo_clinician_vitals
from sentinel.web_auth import router as auth_router

_log = logging.getLogger("sentinel.main")
_access_log = logging.getLogger("sentinel.access")


def _configure_logging() -> None:
    """Idempotent root-logger config so our module loggers emit to stderr
    with a structured-ish prefix. Uvicorn owns its own access log; this is
    for our own middleware + app logs (never ``print``).
    """
    root = logging.getLogger()
    if any(getattr(h, "_sentinel_configured", False) for h in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    handler._sentinel_configured = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)


_STARTED_AT = time.monotonic()


def create_app(*, start_scheduler: bool = True) -> FastAPI:
    _configure_logging()
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await get_db().command("ping")
        except PyMongoError as e:
            _log.error(
                "MongoDB is not reachable - API routes that use the DB will return errors. "
                "Start MongoDB (e.g. `docker run -d -p 27017:27017 --name sentinel-mongo mongo:7`) "
                "and set MONGO_URI / MONGO_DB in backend/.env if needed. Underlying error: %s",
                e,
            )
        try:
            await ensure_indexes()
        except PyMongoError as e:
            _log.error("Could not ensure MongoDB indexes: %s", e)
        except Exception:
            _log.exception("Unexpected error while ensuring MongoDB indexes")
        try:
            await ensure_demo_clinician_vitals()
        except Exception:
            _log.exception("Failed to seed demo clinician vitals (non-fatal)")
        if start_scheduler:
            scheduler_start()
        yield
        if start_scheduler:
            scheduler_stop()
        await close_db()

    app = FastAPI(title="Sentinel", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def _structured_access_log(request: Request, call_next):
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        except Exception:
            _access_log.exception(
                "method=%s path=%s status=500 duration_ms=%.1f error=unhandled",
                request.method,
                request.url.path,
                (time.perf_counter() - start) * 1000.0,
            )
            raise
        finally:
            dur_ms = (time.perf_counter() - start) * 1000.0
            # Suppress SSE stream access-log spam (long-lived connections).
            if request.url.path != "/api/stream":
                _access_log.info(
                    "method=%s path=%s status=%d duration_ms=%.1f",
                    request.method,
                    request.url.path,
                    status,
                    dur_ms,
                )

    @app.get("/api/health")
    async def _health():
        s = get_settings()
        mongo_ok = True
        try:
            await get_db().command("ping")
        except Exception:
            mongo_ok = False
        llm_ready = bool(s.openrouter_api_key) or bool(s.gemini_api_key)
        return {
            "ok": mongo_ok and llm_ready,
            "mongo_ok": mongo_ok,
            "llm_ready": llm_ready,
            "uptime_s": round(time.monotonic() - _STARTED_AT, 1),
        }

    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(webhooks_mod.router)
    return app


app = create_app()
