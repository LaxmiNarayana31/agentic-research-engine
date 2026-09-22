import uuid
import pytest
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_google_token,
    verify_password,
)
from app.dtos.auth_dto import LoginRequest, SignupRequest
from app.services.auth_service import AuthService
from app.db.database import AsyncSessionLocal, init_db

def test_password_hashing_and_verification():
    plain = "SuperSecretPassword123!"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed) is True
    assert verify_password("WrongPassword", hashed) is False

def test_jwt_token_generation_and_decoding():
    data = {"sub": "user_12345", "email": "test@domain.com", "role": "user"}
    access_token = create_access_token(data)
    decoded = decode_token(access_token)
    assert decoded["sub"] == "user_12345"
    assert decoded["email"] == "test@domain.com"
    assert decoded["type"] == "access"

    refresh_token = create_refresh_token(data)
    decoded_refresh = decode_token(refresh_token)
    assert decoded_refresh["sub"] == "user_12345"
    assert decoded_refresh["type"] == "refresh"

@pytest.mark.asyncio
async def test_user_registration_and_login():
    await init_db()
    auth_service = AuthService()
    unique_email = f"analyst_{uuid.uuid4().hex[:6]}@quantumcorp.com"
    
    async with AsyncSessionLocal() as db:
        signup_req = SignupRequest(
            email=unique_email,
            password="SecurePassword999!",
            full_name="Dr. Eleanor Vance",
            workspace_name="Quantum Intelligence Lab"
        )
        auth_resp = await auth_service.register(db, signup_req)
        assert auth_resp.access_token is not None
        assert auth_resp.user.email == unique_email.lower()
        assert auth_resp.active_tenant.name == "Quantum Intelligence Lab"
        assert auth_resp.active_tenant.role == "owner"

        # Verify login
        login_req = LoginRequest(email=unique_email, password="SecurePassword999!")
        login_resp = await auth_service.login(db, login_req)
        assert login_resp.user.id == auth_resp.user.id
        assert login_resp.access_token is not None

@pytest.mark.asyncio
async def test_google_oauth_mock_login():
    await init_db()
    auth_service = AuthService()
    mock_token = f"mock_google_token_{uuid.uuid4().hex[:6]}"
    
    async with AsyncSessionLocal() as db:
        resp = await auth_service.login_with_google(db, mock_token)
        assert resp.user.auth_provider == "google"
        assert resp.access_token is not None
        assert resp.active_tenant is not None
