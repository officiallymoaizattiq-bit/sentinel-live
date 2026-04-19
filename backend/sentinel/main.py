from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from sentinel.api import router
from sentinel.db import close_db, ensure_indexes, get_db
from sentinel.vitals import ensure_demo_clinician_vitals
from sentinel.scheduler import start as scheduler_start
from sentinel.scheduler import stop as scheduler_stop
from sentinel.web_auth import router as auth_router

_log = logging.getLogger("sentinel.main")


def create_app(*, start_scheduler: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await get_db().command("ping")
        except PyMongoError as e:
            _log.error(
                "MongoDB is not reachable — API routes that use the DB will return errors. "
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
            pass
        if start_scheduler:
            scheduler_start()
        yield
        if start_scheduler:
            scheduler_stop()
        await close_db()

    app = FastAPI(title="Sentinel", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000",
                       "http://localhost:3001", "http://127.0.0.1:3001"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(auth_router)
    from sentinel import webhooks as webhooks_mod
    app.include_router(webhooks_mod.router)
    return app


app = create_app()
