import asyncio
import os

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool

from app.core.logging import logger

load_dotenv(override=True)

Base = declarative_base()

# PostgreSQL configuration from environment
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "defaultdb")
SSL_MODE = os.getenv("SSL_MODE", "")

ssl_param = f"?ssl={SSL_MODE}" if SSL_MODE else ""
POSTGRES_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}{ssl_param}"

# Pure PostgreSQL Engine & Sessionmaker
engine = create_async_engine(
    POSTGRES_URL,
    echo=False,
    poolclass=NullPool
)
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)
active_db_type = "postgresql"

async def init_db() -> str:
    """Initializes primary PostgreSQL database schemas and verifies connectivity."""
    global engine, AsyncSessionLocal, active_db_type
    try:
        logger.info(f"Connecting to PostgreSQL database at {DB_HOST}:{DB_PORT}/{DB_NAME}...")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info(f"PostgreSQL database connected & tables verified ({DB_NAME})!")
        return "postgresql"
    except Exception as e:
        logger.critical(f"FATAL: Unable to connect to PostgreSQL database ({DB_HOST}:{DB_PORT}/{DB_NAME}): {e}")
        raise RuntimeError(f"PostgreSQL connection failed: {e}") from e

async def get_db():
    """Yield an async database session with guaranteed resource cleanup."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()
