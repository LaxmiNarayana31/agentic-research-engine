import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

import uuid
from starlette.requests import Request
from starlette.responses import Response

from app.api.auth_routes import router as auth_router
from app.api.research_routes import router as research_router
from app.clients.llm_client import _mem
from app.core.config import settings
from app.core.errors import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.core.logging import logger, request_id_cv, setup_logging
from app.db.database import init_db

load_dotenv(override=True)
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enforce JWT secret strength before accepting any traffic
    try:
        settings.validate_jwt_secret()
        logger.info("JWT secret key validation passed.")
    except ValueError as e:
        logger.critical(str(e))
        raise SystemExit(1)

    # Initialize application relational tables on PostgreSQL
    try:
        db_type = await init_db()
        logger.info(f"Application relational database initialized ({db_type.upper()} Mode).")
    except Exception as e:
        logger.critical(f"PostgreSQL database initialization failed during startup: {e}")

    # Initialize and verify Memori agent memory tables
    try:
        if _mem and hasattr(_mem, "config") and hasattr(_mem.config, "storage"):
            _mem.config.storage.build()
            logger.info("Memori knowledge graph & memory tables verified.")
    except Exception as e:
        logger.warning(f"Memori table startup verification: {e}")

    yield

app = FastAPI(
    title="Deep Research AI Engine API",
    version="1.0.0",
    description="Autonomous multi-agent deep research and intelligence synthesis engine with auth, multi-tenancy, and rate limiting.",
    lifespan=lifespan
)

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:10]}"
    token = request_id_cv.set(req_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
    finally:
        request_id_cv.reset(token)


# CORS: read allowed origins from ALLOWED_ORIGINS env var (comma-separated).
# Falls back to localhost dev origins only — never wildcard with credentials.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins.strip()
    else ["http://localhost:3000", "http://127.0.0.1:3000"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Last-Event-ID"],
)

app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

@app.get("/", tags=["Health"])
async def root():
    """Root status endpoint."""
    try:
        return {"message": "Enterprise Multi-Agent Research System Backend Running"}
    except Exception as e:
        logger.error(f"Error in root endpoint: {e}")
        return {"status": "error"}

@app.get("/health", tags=["Health"])
async def health():
    """Service health status."""
    try:
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"Error in health endpoint: {e}")
        return {"status": "error"}

# Include routers
app.include_router(auth_router)
app.include_router(research_router, prefix="/api/research")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
