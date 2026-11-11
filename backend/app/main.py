"""FastAPI entrypoint — local-only PDF editor backend."""

from __future__ import annotations

import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import documents
from .config import settings
from .db import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pdf-editor")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    logger.info("PDF Editor API ready on %s:%s", settings.host, settings.port)
    yield


app = FastAPI(
    title="Local PDF Editor",
    version="0.1.0",
    description="Local-only Canva-style PDF text editor API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    logger.error(
        "Unhandled error on %s %s\n%s",
        request.method,
        request.url.path,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Something went wrong on the server. Check the terminal for details."
        },
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "pdf-editor"}
