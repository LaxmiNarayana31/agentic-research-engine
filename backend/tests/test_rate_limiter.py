import pytest
from app.models.user import User
from app.services.rate_limiter import InMemorySlidingWindow, RateLimiter

@pytest.mark.asyncio
async def test_sliding_window_rate_limiter():
    window = InMemorySlidingWindow()
    client_key = "test_ip_192_168_1_1"
    limit = 3
    window_seconds = 5

    # First 3 hits should succeed
    for i in range(3):
        allowed, remaining, reset_in = await window.hit(client_key, limit=limit, window_seconds=window_seconds)
        assert allowed is True
        assert remaining == (limit - 1 - i)
        assert reset_in > 0

    # 4th hit should be blocked
    allowed, remaining, reset_in = await window.hit(client_key, limit=limit, window_seconds=window_seconds)
    assert allowed is False
    assert remaining == 0
    assert reset_in > 0

def test_rate_limiter_tier_resolution():
    limiter = RateLimiter()

    # Guest tier (5 req/min, 5 req/day)
    tier, min_limit, daily_limit = limiter.get_tier_limit(None)
    assert tier == "guest"
    assert min_limit == 5
    assert daily_limit == 5

    # Free user tier (20 req/min, 50 req/day)
    free_user = User(id="u1", email="free@test.com", role="user")
    tier, min_limit, daily_limit = limiter.get_tier_limit(free_user, user_tier="free")
    assert tier == "free"
    assert min_limit == 20
    assert daily_limit == 50

    # Pro user tier (60 req/min, 200 req/day)
    tier, min_limit, daily_limit = limiter.get_tier_limit(free_user, user_tier="pro")
    assert tier == "pro"
    assert min_limit == 60
    assert daily_limit == 200

    # Admin tier (120 req/min, 1000 req/day)
    admin_user = User(id="u2", email="admin@test.com", role="admin")
    tier, min_limit, daily_limit = limiter.get_tier_limit(admin_user)
    assert tier == "admin"
    assert min_limit == 120
    assert daily_limit == 1000
