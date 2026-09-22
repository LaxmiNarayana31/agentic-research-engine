import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppException
from app.core.logging import logger
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_google_token,
    verify_password,
)
from app.dtos.auth_dto import (
    AuthResponse,
    LoginRequest,
    SignupRequest,
    TenantResponse,
    UserResponse,
)
from app.models.user import User
from app.services.tenant_service import TenantService, serialize_tenant

def serialize_user(user: User) -> UserResponse:
    """Service-level serialization for User entity to UserResponse DTO."""
    try:
        return UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            avatar_url=user.avatar_url,
            auth_provider=user.auth_provider,
            role=user.role,
            created_at=user.created_at.isoformat() if user.created_at else None
        )
    except Exception as e:
        logger.error(f"Error serializing user entity: {e}")
        return UserResponse(
            id=getattr(user, "id", ""),
            email=getattr(user, "email", ""),
            full_name=getattr(user, "full_name", ""),
            role="user"
        )

class AuthService:
    """Service handling authentication, password hashing, JWT tokens, and OAuth2."""

    def __init__(self):
        self.tenant_service = TenantService()

    async def register(self, db: AsyncSession, req: SignupRequest) -> AuthResponse:
        """Register a new user account with email & password, auto-provisioning a personal workspace."""
        try:
            email_clean = req.email.lower().strip()
            
            # Check if email exists
            stmt = select(User).where(User.email == email_clean)
            res = await db.execute(stmt)
            if res.scalar_one_or_none():
                raise AppException(code="EMAIL_EXISTS", message="An account with this email already exists.", status_code=400)

            # Hash password and create user
            hashed_pwd = hash_password(req.password)
            user = User(
                id=str(uuid.uuid4()),
                email=email_clean,
                hashed_password=hashed_pwd,
                full_name=req.full_name.strip(),
                auth_provider="local",
                role="user",
                is_active=True
            )
            db.add(user)
            await db.flush()

            # Provision personal workspace
            ws_name = req.workspace_name.strip() if req.workspace_name else f"{user.full_name.split()[0]}'s Workspace"
            tenant = await self.tenant_service.create_tenant(db, user.id, ws_name, tier="free")
            
            await db.commit()
            await db.refresh(user)

            # Generate tokens
            token_data = {"sub": user.id, "email": user.email, "role": user.role, "tenant_id": tenant.id}
            access_token = create_access_token(token_data)
            refresh_token = create_refresh_token(token_data)

            logger.info(f"User registered successfully: {user.email} (Tenant: {tenant.name})")

            return AuthResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                user=serialize_user(user),
                active_tenant=TenantResponse(id=tenant.id, name=tenant.name, slug=tenant.slug, tier=tenant.tier, role="owner"),
                workspaces=[TenantResponse(id=tenant.id, name=tenant.name, slug=tenant.slug, tier=tenant.tier, role="owner")]
            )
        except AppException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            logger.error(f"Registration exception: {e}")
            raise AppException(code="SIGNUP_ERROR", message=f"Registration failed: {e}", status_code=500)

    async def login(self, db: AsyncSession, req: LoginRequest) -> AuthResponse:
        """Authenticate user with email & password."""
        try:
            email_clean = req.email.lower().strip()
            stmt = select(User).where(User.email == email_clean)
            res = await db.execute(stmt)
            user = res.scalar_one_or_none()

            if not user:
                raise AppException(
                    code="ACCOUNT_NOT_FOUND",
                    message="Account not found. Please create an account.",
                    status_code=404
                )

            if not user.hashed_password:
                if user.auth_provider == "google":
                    raise AppException(
                        code="USE_GOOGLE_LOGIN",
                        message="This account was registered with Google. Please click 'Sign in with Google' above.",
                        status_code=400
                    )
                raise AppException(
                    code="INVALID_CREDENTIALS",
                    message="Invalid password. Please check your credentials.",
                    status_code=401
                )

            if not verify_password(req.password, user.hashed_password):
                raise AppException(
                    code="INVALID_CREDENTIALS",
                    message="Incorrect password. Please check your password and try again.",
                    status_code=401
                )

            if not user.is_active:
                raise AppException(
                    code="ACCOUNT_DISABLED",
                    message="Your account is currently deactivated.",
                    status_code=403
                )

            # Get workspaces
            workspaces_data = await self.tenant_service.get_user_tenants(db, user.id)
            if not workspaces_data:
                tenant = await self.tenant_service.get_or_create_personal_tenant(db, user)
                workspaces_data = [serialize_tenant(tenant, role="owner")]

            active_ws = workspaces_data[0]
            token_data = {"sub": user.id, "email": user.email, "role": user.role, "tenant_id": active_ws["id"]}
            access_token = create_access_token(token_data)
            refresh_token = create_refresh_token(token_data)

            return AuthResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                user=serialize_user(user),
                active_tenant=TenantResponse(**active_ws),
                workspaces=[TenantResponse(**ws) for ws in workspaces_data]
            )
        except AppException:
            raise
        except Exception as e:
            logger.error(f"Login exception: {e}")
            raise AppException(code="LOGIN_ERROR", message=f"Login failed: {e}", status_code=500)

    async def login_with_google(self, db: AsyncSession, id_token_str: str) -> AuthResponse:
        """Authenticate or register user via verified Google OAuth ID Token."""
        try:
            try:
                google_info = await verify_google_token(id_token_str)
            except Exception as e:
                raise AppException(code="INVALID_OAUTH_TOKEN", message=str(e), status_code=401)

            email_clean = google_info["email"].lower().strip()
            stmt = select(User).where(User.email == email_clean)
            res = await db.execute(stmt)
            user = res.scalar_one_or_none()

            if not user:
                # Create user on first Google login
                user = User(
                    id=str(uuid.uuid4()),
                    email=email_clean,
                    hashed_password=None,
                    full_name=google_info.get("name") or email_clean.split("@")[0],
                    avatar_url=google_info.get("picture"),
                    auth_provider="google",
                    role="user",
                    is_active=True
                )
                db.add(user)
                await db.flush()

                # Provision personal workspace
                ws_name = f"{user.full_name.split()[0]}'s Workspace"
                tenant = await self.tenant_service.create_tenant(db, user.id, ws_name, tier="free")
                await db.commit()
                await db.refresh(user)
                workspaces_data = [{"id": tenant.id, "name": tenant.name, "slug": tenant.slug, "tier": tenant.tier, "role": "owner"}]
            else:
                # Existing user - update avatar if available
                if google_info.get("picture") and not user.avatar_url:
                    user.avatar_url = google_info.get("picture")
                    await db.commit()
                workspaces_data = await self.tenant_service.get_user_tenants(db, user.id)
                if not workspaces_data:
                    tenant = await self.tenant_service.get_or_create_personal_tenant(db, user)
                    workspaces_data = [{"id": tenant.id, "name": tenant.name, "slug": tenant.slug, "tier": tenant.tier, "role": "owner"}]

            active_ws = workspaces_data[0]
            token_data = {"sub": user.id, "email": user.email, "role": user.role, "tenant_id": active_ws["id"]}
            access_token = create_access_token(token_data)
            refresh_token = create_refresh_token(token_data)

            logger.info(f"Google OAuth login success: {user.email}")

            return AuthResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                user=serialize_user(user),
                active_tenant=TenantResponse(**active_ws),
                workspaces=[TenantResponse(**ws) for ws in workspaces_data]
            )
        except AppException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            logger.error(f"Google login exception: {e}")
            raise AppException(code="GOOGLE_AUTH_ERROR", message=f"Google authentication failed: {e}", status_code=500)

    async def refresh_access_token(self, db: AsyncSession, refresh_token_str: str) -> dict:
        """Issue a new access token from a valid refresh token."""
        try:
            payload = decode_token(refresh_token_str)
            if payload.get("type") != "refresh":
                raise AppException(code="INVALID_TOKEN_TYPE", message="Not a refresh token", status_code=401)
            
            user_id = payload.get("sub")
            stmt = select(User).where(User.id == user_id)
            res = await db.execute(stmt)
            user = res.scalar_one_or_none()
            if not user or not user.is_active:
                raise AppException(code="USER_NOT_FOUND", message="User inactive or not found", status_code=401)

            token_data = {
                "sub": user.id,
                "email": user.email,
                "role": user.role,
                "tenant_id": payload.get("tenant_id")
            }
            new_access_token = create_access_token(token_data)
            return {"access_token": new_access_token, "token_type": "bearer"}
        except AppException:
            raise
        except Exception as e:
            raise AppException(code="INVALID_TOKEN", message=f"Refresh token invalid or expired: {e}", status_code=401)

    async def get_user_profile(self, db: AsyncSession, user: User) -> AuthResponse:
        """Retrieve current user profile and workspaces DTO."""
        try:
            workspaces = await self.tenant_service.get_user_tenants(db, user.id)
            if not workspaces:
                tenant = await self.tenant_service.get_or_create_personal_tenant(db, user)
                workspaces = [serialize_tenant(tenant, role="owner")]

            active_ws = workspaces[0]
            return AuthResponse(
                access_token="",
                refresh_token="",
                token_type="bearer",
                user=serialize_user(user),
                active_tenant=TenantResponse(**active_ws),
                workspaces=[TenantResponse(**ws) for ws in workspaces]
            )
        except AppException:
            raise
        except Exception as e:
            logger.error(f"Error in get_user_profile: {e}")
            raise AppException(code="PROFILE_ERROR", message="Failed to retrieve user profile.", status_code=500)
