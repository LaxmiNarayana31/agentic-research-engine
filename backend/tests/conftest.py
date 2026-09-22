import os

import pytest
from app.db.database import init_db, engine

# Provide a strong test-only JWT secret so token tests pass without requiring
# a production .env file.  This value is never used outside the test suite.
os.environ.setdefault(
    "JWT_SECRET_KEY",
    "test-only-secret-key-not-for-production-use-at-all-32x"
)


@pytest.fixture(autouse=True, scope="session")
async def setup_test_suite():
    """Ensure PostgreSQL database is initialized for test execution."""
    await init_db()
    await engine.dispose()
    yield

@pytest.fixture(autouse=True)
async def dispose_engine_per_test():
    """Dispose connection pool between tests so asyncpg connections are never shared across closed event loops."""
    yield
    await engine.dispose()
