from typing import List, Optional
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppException
from app.core.logging import logger
from app.db.database import get_db
from app.dtos.auth_dto import (
    AuthResponse,
    CreateWorkspaceRequest,
    GoogleAuthRequest,
    LoginRequest,
    RefreshTokenRequest,
    SignupRequest,
    TenantResponse,
    UsageResponse,
)
from app.helpers.auth_helper import get_current_user, get_optional_user
from app.models.user import User
from app.services.auth_service import AuthService
from app.services.rate_limiter import rate_limiter
from app.services.tenant_service import TenantService

router = APIRouter(prefix="/api/auth", tags=["Authentication & Tenancy"])
auth_service = AuthService()
tenant_service = TenantService()

@router.get("/config", tags=["Authentication & Tenancy"])
async def get_auth_config():
    """Return public client configurations like Google Client ID."""
    try:
        return {
            "google_client_id": settings.google_client_id or ""
        }
    except Exception as e:
        logger.error(f"Error fetching auth config: {e}")
        return {"google_client_id": ""}

@router.post("/signup", response_model=AuthResponse, status_code=201)
async def signup(req: SignupRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user account and provision a personal workspace."""
    try:
        return await auth_service.register(db, req)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error during user signup ({req.email}): {e}")
        raise AppException(code="SIGNUP_ERROR", message=f"Registration failed: {str(e)}", status_code=500)

@router.post("/login", response_model=AuthResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Sign in with email and password."""
    try:
        return await auth_service.login(db, req)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error during user login ({req.email}): {e}")
        raise AppException(code="LOGIN_ERROR", message=f"Login failed: {str(e)}", status_code=500)

@router.post("/google", response_model=AuthResponse)
async def google_login(req: GoogleAuthRequest, db: AsyncSession = Depends(get_db)):
    """Sign in or register with verified Google OAuth2 ID Token."""
    try:
        return await auth_service.login_with_google(db, req.id_token)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error during Google OAuth login: {e}")
        raise AppException(code="GOOGLE_AUTH_ERROR", message=f"Google authentication failed: {str(e)}", status_code=500)

@router.post("/refresh")
async def refresh_token(req: RefreshTokenRequest, db: AsyncSession = Depends(get_db)):
    """Obtain a new access token using a refresh token."""
    try:
        return await auth_service.refresh_access_token(db, req.refresh_token)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error during token refresh: {e}")
        raise AppException(code="REFRESH_ERROR", message=f"Token refresh failed: {str(e)}", status_code=500)

@router.get("/me", response_model=AuthResponse)
async def get_current_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve profile and workspaces for currently authenticated user."""
    try:
        return await auth_service.get_user_profile(db, user)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error fetching user profile ({user.id}): {e}")
        raise AppException(code="PROFILE_ERROR", message="Unable to fetch profile.", status_code=500)

@router.get("/workspaces", response_model=List[TenantResponse])
async def list_user_workspaces(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """List all workspaces the authenticated user has access to."""
    try:
        return await tenant_service.list_user_workspaces(db, user.id)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error listing workspaces for user ({user.id}): {e}")
        raise AppException(code="WORKSPACE_LIST_ERROR", message="Unable to list workspaces.", status_code=500)

@router.post("/workspaces", response_model=TenantResponse, status_code=201)
async def create_new_workspace(
    req: CreateWorkspaceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new multi-tenant workspace."""
    try:
        return await tenant_service.create_workspace(db, user.id, req.name)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error creating workspace '{req.name}' for user ({user.id}): {e}")
        raise AppException(code="WORKSPACE_CREATE_ERROR", message="Unable to create workspace.", status_code=500)

@router.get("/usage", response_model=UsageResponse)
async def get_rate_limit_usage(
    request: Request,
    user: Optional[User] = Depends(get_optional_user)
):
    """Inspect current rate limit quota and remaining requests."""
    try:
        return rate_limiter.get_usage_summary(request, user)
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error querying rate limit quota: {e}")
        raise AppException(code="USAGE_ERROR", message="Unable to query rate limit quota.", status_code=500)
