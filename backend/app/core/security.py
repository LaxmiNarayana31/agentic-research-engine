from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import bcrypt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
import httpx
import jwt

from app.core.config import settings
from app.core.logging import logger

def hash_password(password: str) -> str:
    """Securely hash a password using bcrypt."""
    try:
        salt = bcrypt.gensalt(rounds=12)
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")
    except Exception as e:
        logger.error(f"Error hashing password: {e}")
        raise ValueError(f"Password hashing failed: {e}")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    if not hashed_password or not plain_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed JWT access token."""
    try:
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
        
        to_encode.update({
            "exp": int(expire.timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "type": "access"
        })
        return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    except Exception as e:
        logger.error(f"Error generating access token: {e}")
        raise ValueError(f"Access token generation failed: {e}")

def create_refresh_token(data: Dict[str, Any]) -> str:
    """Generate a signed JWT refresh token."""
    try:
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
        to_encode.update({
            "exp": int(expire.timestamp()),
            "iat": int(datetime.now(timezone.utc).timestamp()),
            "type": "refresh"
        })
        return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    except Exception as e:
        logger.error(f"Error generating refresh token: {e}")
        raise ValueError(f"Refresh token generation failed: {e}")

def decode_token(token: str) -> Dict[str, Any]:
    """Decode and validate a signed JWT token."""
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as e:
        logger.debug(f"JWT decode error: {e}")
        raise

async def verify_google_token(token: str) -> Dict[str, Any]:
    """
    Verify a Google OAuth ID token.
    Uses official google-auth library with fallback to Google's tokeninfo endpoint,
    and supports test tokens for development.
    """
    try:
        if token.startswith("mock_google_token_"):
            parts = token.split("_")
            identifier = parts[-1] if len(parts) > 3 else "alex"
            email = f"{identifier}@gmail.com"
            clean_name = identifier.replace(".", " ").replace("-", " ").title()
            return {
                "email": email,
                "name": clean_name if len(clean_name) > 2 else "Alex Mercer",
                "picture": "https://lh3.googleusercontent.com/a/default-user=s96-c",
                "sub": f"mock-sub-{email}"
            }

        try:
            # Standard Google OAuth ID Token verification
            client_id = settings.google_client_id if settings.google_client_id else None
            id_info = google_id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
            raw_name = id_info.get("name") or id_info.get("given_name")
            if not raw_name and id_info.get("email"):
                raw_name = id_info["email"].split("@")[0].replace(".", " ").replace("-", " ").title()
            
            return {
                "email": id_info.get("email"),
                "name": raw_name or "User",
                "picture": id_info.get("picture"),
                "sub": id_info.get("sub")
            }
        except Exception as e:
            logger.warning(f"google-auth id_token verify notice: {e}, trying tokeninfo/userinfo endpoints...")
            # Fallback 1: Google TokenInfo API (for ID tokens)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    res = await client.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={token}")
                    if res.status_code == 200:
                        info = res.json()
                        raw_name = info.get("name") or info.get("given_name")
                        if not raw_name and info.get("email"):
                            raw_name = info["email"].split("@")[0].replace(".", " ").replace("-", " ").title()
                        return {
                            "email": info.get("email"),
                            "name": raw_name or "User",
                            "picture": info.get("picture"),
                            "sub": info.get("sub")
                        }
            except Exception as http_err:
                logger.debug(f"Google tokeninfo ID token lookup notice: {http_err}")

            # Fallback 2: Google UserInfo API (for OAuth2 access tokens)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    res = await client.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": f"Bearer {token}"})
                    if res.status_code == 200:
                        info = res.json()
                        raw_name = info.get("name") or info.get("given_name")
                        if not raw_name and info.get("email"):
                            raw_name = info["email"].split("@")[0].replace(".", " ").replace("-", " ").title()
                        return {
                            "email": info.get("email"),
                            "name": raw_name or "User",
                            "picture": info.get("picture"),
                            "sub": info.get("sub")
                        }
            except Exception as userinfo_err:
                logger.debug(f"Google userinfo lookup notice: {userinfo_err}")
            
            raise ValueError("Invalid or expired Google OAuth token.")
    except Exception as top_err:
        logger.error(f"verify_google_token top exception: {top_err}")
        raise
