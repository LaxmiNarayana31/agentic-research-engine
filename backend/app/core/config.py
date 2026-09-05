from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv(override=True)

class Settings(BaseSettings):
    tavily_api_key: str = Field(default="dev_key", description="Tavily API Key")
    llm_api_key: str = Field(default="dev_key", description="Legacy LLM Key")
    groq_api_key: str = Field(default="dev_key", description="Groq API Key")
    gemini_api_key: str = Field(default="dev_key", description="Gemini API Key")
    redis_url: str = Field(default="redis://localhost:6379", description="Redis Connection URL")
    upstash_redis_rest_url: str = Field(default="", description="Upstash Redis REST URL")
    upstash_redis_rest_token: str = Field(default="", description="Upstash Redis REST Token")

    # Authentication & JWT Configuration
    jwt_secret_key: str = Field(default="deep-research-secret-key-change-in-production-2026", description="JWT Secret Key")
    jwt_algorithm: str = Field(default="HS256", description="JWT Algorithm")
    access_token_expire_minutes: int = Field(default=60 * 24, description="Access Token Lifetime in Minutes")
    refresh_token_expire_days: int = Field(default=30, description="Refresh Token Lifetime in Days")
    google_client_id: str = Field(default="", description="Google OAuth Client ID")

    # Rate Limiting Configuration
    rate_limit_guest: int = Field(default=5, description="Guest requests per minute (burst)")
    rate_limit_free: int = Field(default=20, description="Free user requests per minute (burst)")
    rate_limit_pro: int = Field(default=60, description="Pro user requests per minute (burst)")
    rate_limit_admin: int = Field(default=120, description="Admin requests per minute (burst)")
    rate_limit_guest_daily: int = Field(default=5, description="Max guest requests allowed per day")
    rate_limit_user_daily: int = Field(default=50, description="Max authenticated user requests allowed per day")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def validate_keys(self) -> None:
        placeholder_values = {"dev_key", "your_llm_api_key_here", "your_tavily_api_key_here", ""}
        missing = []
        if self.tavily_api_key in placeholder_values:
            missing.append("TAVILY_API_KEY")
        if self.llm_api_key in placeholder_values:
            missing.append("LLM_API_KEY")
        if missing:
            raise ValueError(f"CRITICAL CONFIG ERROR: Project-1 missing valid API keys for: {', '.join(missing)}. Please set them in Project-1/backend/.env")

settings = Settings()
