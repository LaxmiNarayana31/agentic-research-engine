import json
import logging
from typing import AsyncGenerator
import redis.asyncio as redis
from app.core.config import settings

logger = logging.getLogger(__name__)

async def get_redis_client():
    return redis.from_url(settings.redis_url)

async def publish_event(session_id: str, event: dict):
    client = await get_redis_client()
    try:
        channel = f"session:{session_id}:events"
        await client.publish(channel, json.dumps(event))
    except Exception as e:
        logger.error(f"Failed to publish event to redis: {e}")
    finally:
        await client.aclose()

async def subscribe_events(session_id: str) -> AsyncGenerator[dict, None]:
    client = await get_redis_client()
    pubsub = client.pubsub()
    channel = f"session:{session_id}:events"
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    yield json.loads(message["data"])
                except json.JSONDecodeError:
                    continue
    finally:
        await pubsub.unsubscribe(channel)
        await client.aclose()
