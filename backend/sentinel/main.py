from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from sentinel.api import router
from sentinel.db import close_db, ensure_indexes
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
        if start_scheduler:
            scheduler_start()
        yield
        if start_scheduler:
            scheduler_stop()
        await close_db()

    app = FastAPI(title="Sentinel", lifespan=lifespan)
    app.include_router(router)
    app.include_router(auth_router)
    return app


app = create_app()
