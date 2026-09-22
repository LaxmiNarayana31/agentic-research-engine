from typing import Optional
from fastapi import Depends, Header, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppException
from app.core.logging import logger
from app.core.security import decode_token
from app.db.database import get_db
from app.models.user import User

async def get_token_from_request(
    authorization: Optional[str] = Header(None),
    token_query: Optional[str] = Query(None, alias="token")
) -> Optional[str]:
    """Extract Bearer token from Authorization header or URL query param.

    The query-param fallback exists solely for browser EventSource (SSE) clients,
    which cannot set custom headers. Tokens in URLs are visible in server access
    logs, browser history, and HTTP referrer headers — use the Authorization header
    wherever possible. The query-param path is intentionally logged at WARNING level
    so that it is visible in audit logs.
    """
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ")[1]
    if token_query:
        # Log at WARNING so this shows in audit trails. Do NOT log the token value.
        from app.core.logging import logger as _logger
        _logger.warning(
            "Auth token received via URL query parameter (SSE fallback). "
            "This is acceptable for EventSource connections but exposes the token "
            "in server access logs. Use Authorization header for all other requests."
        )
        return token_query
    return None

async def get_optional_user(
    token: Optional[str] = Depends(get_token_from_request),
    db: AsyncSession = Depends(get_db)
) -> Optional[User]:
    """
    Returns the authenticated User if valid token is provided, or None for guest/demo access.
    Guarantees backwards compatibility for unauthenticated users.
    """
    if not token:
        return None
    
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        
        stmt = select(User).where(User.id == user_id)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()
        if user and user.is_active:
            return user
        return None
    except Exception as e:
        logger.debug(f"Optional user token decode failed: {e}")
        return None

async def get_current_user(
    token: Optional[str] = Depends(get_token_from_request),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Enforces authentication. Raises 401 if missing or invalid token."""
    if not token:
        raise AppException(code="UNAUTHORIZED", message="Authentication token required.", status_code=401)
    
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise AppException(code="INVALID_TOKEN", message="Token missing subject identifier.", status_code=401)
        
        stmt = select(User).where(User.id == user_id)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()

        if not user:
            raise AppException(code="USER_NOT_FOUND", message="User account not found.", status_code=401)
        if not user.is_active:
            raise AppException(code="USER_INACTIVE", message="User account is deactivated.", status_code=403)
        
        return user
    except AppException:
        raise
    except Exception as e:
        raise AppException(code="INVALID_TOKEN", message=f"Authentication failed: {e}", status_code=401)

async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Enforces admin role."""
    if user.role != "admin":
        raise AppException(code="FORBIDDEN", message="Admin privilege required.", status_code=403)
    return user


async def get_user_tenant_id(
    user: Optional[User],
    db: AsyncSession,
) -> Optional[str]:
    """Return the primary tenant ID for an authenticated user, or None for guests.

    Looks up the first TenantMember row for this user.  Returns None rather than
    raising so that code paths that accept both authenticated and guest users
    keep working unchanged.
    """
    if not user:
        return None
    try:
        from app.models.tenant import TenantMember
        stmt = select(TenantMember).where(TenantMember.user_id == user.id).limit(1)
        result = await db.execute(stmt)
        membership = result.scalar_one_or_none()
        return membership.tenant_id if membership else None
    except Exception as e:
        logger.debug(f"Could not resolve tenant_id for user {user.id}: {e}")
        return None
