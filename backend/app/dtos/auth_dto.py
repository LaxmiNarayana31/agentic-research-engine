from typing import List, Optional
from pydantic import BaseModel, Field

class SignupRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., min_length=6, description="Password (at least 6 characters)")
    full_name: str = Field(..., min_length=2, description="User full name")
    workspace_name: Optional[str] = Field(default=None, description="Optional custom workspace name")

class LoginRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., description="User password")

class GoogleAuthRequest(BaseModel):
    id_token: str = Field(..., description="Google OAuth2 ID Token")

class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., description="JWT Refresh Token")

class CreateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Workspace name")

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    avatar_url: Optional[str] = None
    role: str = "user"
    auth_provider: str = "local"
    created_at: Optional[str] = None

class TenantResponse(BaseModel):
    id: str
    name: str
    slug: str
    tier: str = "free"
    role: str = "member"

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse
    active_tenant: Optional[TenantResponse] = None
    workspaces: List[TenantResponse] = []

class UsageResponse(BaseModel):
    tier: str
    rate_limit_per_minute: int
    daily_limit: int = 50
    requests_today: int = 0
    remaining_today: int = 50
    remaining: int = 20
    reset_seconds: int = 60
    is_authenticated: bool = False
    user_email: Optional[str] = None
