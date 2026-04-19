from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sentinel.api import router
from sentinel.db import close_db, ensure_indexes
from sentinel.vitals import ensure_demo_clinician_vitals
from sentinel.scheduler import start as scheduler_start
from sentinel.scheduler import stop as scheduler_stop
from sentinel.web_auth import router as auth_router


def create_app(*, start_scheduler: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            await ensure_indexes()
        except Exception:
            pass
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
