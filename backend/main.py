from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from app.api.auth_routes import router as auth_router
from app.api.research_routes import router as research_router
from app.clients.llm_client import _mem
from app.core.errors import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)
from app.core.logging import logger, setup_logging
from app.db.database import init_db

load_dotenv(override=True)
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
