import json
import logging
from typing import AsyncGenerator, Optional

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# Reusable shared connection pool for the process lifetime
_pool: Optional[redis.ConnectionPool] = None

def get_redis_pool() -> redis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.redis_url,
            max_connections=20,
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=5.0
        )
    return _pool

def get_redis_client() -> redis.Redis:
    pool = get_redis_pool()
    return redis.Redis(connection_pool=pool)

async def publish_event(session_id: str, event: dict) -> bool:
    """Publish an event to the session channel using the shared connection pool."""
    try:
        client = get_redis_client()
        channel = f"session:{session_id}:events"
        await client.publish(channel, json.dumps(event))
        return True
    except Exception as e:
        logger.debug(f"Redis publish notice for session {session_id} (non-fatal): {e}")
        return False

async def subscribe_events(session_id: str) -> AsyncGenerator[dict, None]:
    """Subscribe to events on the session channel using the shared connection pool."""
    client = get_redis_client()
    pubsub = client.pubsub()
    channel = f"session:{session_id}:events"
    try:
        await pubsub.subscribe(channel)
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = message["data"]
                    if isinstance(data, str):
                        yield json.loads(data)
                    elif isinstance(data, (bytes, bytearray)):
                        yield json.loads(data.decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
    except Exception as e:
        logger.debug(f"Redis subscribe notice for session {session_id}: {e}")
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()
        except Exception:
            pass

