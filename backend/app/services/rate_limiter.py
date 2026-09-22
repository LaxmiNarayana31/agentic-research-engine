import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import time
from typing import Dict, List, Optional, Tuple
from fastapi import Request, Response

try:
    from upstash_redis import Redis as UpstashRedis
except ImportError:
    UpstashRedis = None

try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None

from app.core.config import settings
from app.core.errors import AppException
from app.core.logging import logger
from app.models.user import User

class InMemorySlidingWindow:
    """Thread-safe in-memory sliding window rate limiter fallback."""

    def __init__(self):
        self._requests: Dict[str, List[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def hit(self, key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int]:
        try:
            async with self._lock:
                now = time.time()
                cutoff = now - window_seconds
                
                # Filter timestamps older than window
                valid_timestamps = [t for t in self._requests[key] if t > cutoff]
                current_count = len(valid_timestamps)

                if current_count >= limit:
                    oldest = valid_timestamps[0] if valid_timestamps else now
                    reset_in = max(1, int(oldest + window_seconds - now))
                    self._requests[key] = valid_timestamps
                    return False, 0, reset_in

                valid_timestamps.append(now)
                self._requests[key] = valid_timestamps
                remaining = max(0, limit - len(valid_timestamps))
                reset_in = window_seconds
                return True, remaining, reset_in
        except Exception as e:
            logger.error(f"Error in sliding window hit evaluation: {e}")
            return True, limit, window_seconds


class RateLimiter:
    """Production-grade rate limiting engine with multi-worker Redis sliding window and memory fallback."""

    def __init__(self):
        self._memory = InMemorySlidingWindow()
        self._redis = None
        self._redis_type: Optional[str] = None
        self._init_redis()

    def _init_redis(self):
        try:
            if UpstashRedis and settings.upstash_redis_rest_url and settings.upstash_redis_rest_token:
                self._redis = UpstashRedis(url=settings.upstash_redis_rest_url, token=settings.upstash_redis_rest_token)
                self._redis_type = "upstash"
                logger.info("RateLimiter: Initialized with Upstash Redis.")
            elif aioredis and settings.redis_url:
                self._redis = aioredis.from_url(
                    settings.redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=2.0,
                    socket_timeout=2.0
                )
                self._redis_type = "standard"
                logger.info(f"RateLimiter: Initialized with Redis ({settings.redis_url}).")
            else:
                self._redis = None
                self._redis_type = None
        except Exception as e:
            logger.warning(f"RateLimiter: Redis init fallback ({e}). Using memory limiter.")
            self._redis = None
            self._redis_type = None

    def get_tier_limit(self, user: Optional[User] = None, user_tier: str = "free") -> Tuple[str, int, int]:
        """Determine (tier_name, minute_limit, daily_limit) based on authentication and tier."""
        try:
            if not user:
                return "guest", settings.rate_limit_guest, settings.rate_limit_guest_daily
            if user.role == "admin":
                return "admin", settings.rate_limit_admin, 1000
            if user_tier == "pro" or user_tier == "enterprise":
                return user_tier, settings.rate_limit_pro, 200
            return "free", settings.rate_limit_free, settings.rate_limit_user_daily
        except Exception:
            return "guest", 5, 5

    async def get_usage_summary(self, request: Request, user: Optional[User] = None) -> dict:
        """Calculate and return rate limit usage metadata for a user or guest IP."""
        try:
            tier, min_limit, daily_limit = self.get_tier_limit(user)
            today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            
            if user:
                client_key_min = f"user:{user.id}:min"
                client_key_daily = f"user:{user.id}:daily:{today_utc}"
            else:
                forwarded = request.headers.get("X-Forwarded-For")
                ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
                client_key_min = f"guest:{ip}:min"
                client_key_daily = f"guest:{ip}:daily:{today_utc}"

            now = time.time()

            # Attempt querying Redis sliding window if available
            if self._redis and self._redis_type == "standard":
                try:
                    pipe = self._redis.pipeline(transaction=True)
                    pipe.zremrangebyscore(f"ratelimit:{client_key_min}", 0, now - 60)
                    pipe.zcard(f"ratelimit:{client_key_min}")
                    pipe.zrange(f"ratelimit:{client_key_min}", 0, 0, withscores=True)
                    pipe.zremrangebyscore(f"ratelimit:{client_key_daily}", 0, now - 86400)
                    pipe.zcard(f"ratelimit:{client_key_daily}")
                    res = await pipe.execute()

                    min_count = res[1]
                    oldest_min = res[2]
                    daily_count = res[4]

                    remaining_today = max(0, daily_limit - daily_count)
                    remaining_min = max(0, min_limit - min_count)
                    reset_seconds = max(1, int(oldest_min[0][1] + 60 - now)) if oldest_min else 60

                    return {
                        "tier": tier,
                        "rate_limit_per_minute": min_limit,
                        "daily_limit": daily_limit,
                        "requests_today": daily_count,
                        "remaining_today": remaining_today,
                        "remaining_per_minute": remaining_min,
                        "remaining": remaining_min,
                        "reset_seconds": reset_seconds,
                        "is_authenticated": bool(user),
                        "user_email": getattr(user, "email", None)
                    }
                except Exception as e:
                    logger.debug(f"Redis get_usage_summary fallback to memory: {e}")

            # In-memory window calculation fallback
            cutoff_min = now - 60
            cutoff_day = now - 86400
            
            min_timestamps = [t for t in self._memory._requests.get(client_key_min, []) if t > cutoff_min]
            daily_timestamps = [t for t in self._memory._requests.get(client_key_daily, []) if t > cutoff_day]
            
            requests_today = len(daily_timestamps)
            remaining_today = max(0, daily_limit - requests_today)
            remaining_min = max(0, min_limit - len(min_timestamps))
            reset_seconds = max(1, int(min_timestamps[0] + 60 - now)) if min_timestamps else 60

            return {
                "tier": tier,
                "rate_limit_per_minute": min_limit,
                "daily_limit": daily_limit,
                "requests_today": requests_today,
                "remaining_today": remaining_today,
                "remaining_per_minute": remaining_min,
                "remaining": remaining_min,
                "reset_seconds": reset_seconds,
                "is_authenticated": bool(user),
                "user_email": getattr(user, "email", None)
            }
        except Exception as e:
            logger.error(f"Error calculating rate limit usage summary: {e}")
            return {
                "tier": "free",
                "rate_limit_per_minute": 20,
                "daily_limit": 50,
                "requests_today": 0,
                "remaining_today": 50,
                "remaining_per_minute": 20,
                "remaining": 20,
                "reset_seconds": 60,
                "is_authenticated": bool(user),
                "user_email": getattr(user, "email", None)
            }

    async def check(self, key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int]:
        """Evaluate rate limit for a given client key using Redis multi-worker sliding window or memory fallback."""
        if self._redis and self._redis_type == "standard":
            try:
                now = time.time()
                cutoff = now - window_seconds
                redis_key = f"ratelimit:{key}"

                pipe = self._redis.pipeline(transaction=True)
                pipe.zremrangebyscore(redis_key, 0, cutoff)
                pipe.zcard(redis_key)
                pipe.zrange(redis_key, 0, 0, withscores=True)
                results = await pipe.execute()

                current_count = results[1]
                oldest_entries = results[2]

                if current_count >= limit:
                    oldest_ts = oldest_entries[0][1] if oldest_entries else now
                    reset_in = max(1, int(oldest_ts + window_seconds - now))
                    return False, 0, reset_in

                member = f"{now}:{time.time_ns()}"
                pipe = self._redis.pipeline(transaction=True)
                pipe.zadd(redis_key, {member: now})
                pipe.expire(redis_key, window_seconds + 5)
                await pipe.execute()

                remaining = max(0, limit - (current_count + 1))
                return True, remaining, window_seconds
            except Exception as e:
                logger.warning(f"RateLimiter: Redis check failed ({e}), falling back to in-memory window.")

        # In-memory fallback
        try:
            return await self._memory.hit(key, limit, window_seconds)
        except Exception as e:
            logger.error(f"RateLimiter check error: {e}")
            return True, limit, window_seconds


# Singleton rate limiter instance
rate_limiter = RateLimiter()

async def rate_limit_guard(
    request: Request,
    response: Response,
    user: Optional[User] = None
):
    """
    FastAPI dependency that enforces strict Daily and Per-Minute rate limits.
    - Unauthenticated Guests: 5 requests / day (strictly prompts login on limit)
    - Authenticated Users: 20 req / min (burst) and 50 requests / day
    """
    try:
        today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        tier, min_limit, daily_limit = rate_limiter.get_tier_limit(user)

        if user:
            client_key_min = f"user:{user.id}:min"
            client_key_daily = f"user:{user.id}:daily:{today_utc}"
        else:
            forwarded = request.headers.get("X-Forwarded-For")
            ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "127.0.0.1")
            client_key_min = f"guest:{ip}:min"
            client_key_daily = f"guest:{ip}:daily:{today_utc}"

        # 1. Enforce Daily Limit (5 for Guest, 50 for Authenticated User)
        daily_allowed, daily_remaining, daily_reset = await rate_limiter.check(
            client_key_daily, daily_limit, window_seconds=86400
        )

        # 2. Enforce Minute Limit (Burst protection)
        min_allowed, min_remaining, min_reset = await rate_limiter.check(
            client_key_min, min_limit, window_seconds=60
        )

        # Attach standard RFC & custom rate limit headers
        response.headers["X-RateLimit-Limit"] = str(min_limit)
        response.headers["X-RateLimit-Remaining"] = str(min_remaining)
        response.headers["X-RateLimit-Daily-Limit"] = str(daily_limit)
        response.headers["X-RateLimit-Daily-Remaining"] = str(daily_remaining)
        response.headers["X-RateLimit-Tier"] = tier

        # Check daily limit violation first
        if not daily_allowed:
            if not user:
                logger.warning(f"Guest daily limit reached (5 requests) for {client_key_daily}")
                raise AppException(
                    code="GUEST_LIMIT_REACHED",
                    message="Guest research limit reached (5 requests maximum).",
                    status_code=429
                )
            else:
                logger.warning(f"User daily limit reached (50 requests) for {client_key_daily}")
                raise AppException(
                    code="DAILY_LIMIT_REACHED",
                    message=f"Daily research limit reached ({daily_limit}/{daily_limit} requests today). Please try again tomorrow.",
                    status_code=429
                )

        # Check minute burst limit violation
        if not min_allowed:
            logger.warning(f"Minute rate limit exceeded for {client_key_min} (Limit: {min_limit}/min)")
            raise AppException(
                code="RATE_LIMIT_EXCEEDED",
                message=f"Rate limit exceeded ({min_limit} req/min). Please wait {min_reset} seconds before trying again.",
                status_code=429
            )
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error in rate_limit_guard: {e}")
