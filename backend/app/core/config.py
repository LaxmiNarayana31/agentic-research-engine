from dotenv import load_dotenv
load_dotenv(verbose=True)

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    port: int = Field(default=8001, description="Multi-Agent System API Port")
    database_url: str = Field(default="sqlite+aiosqlite:///./dev.db", description="Database connection URL")
    qdrant_url: str = Field(default=":memory:", description="Qdrant Vector Database URL or :memory:")
    tavily_api_key: str = Field(default="dev_key", description="Tavily API Key")
    llm_api_key: str = Field(default="dev_key", description="LLM Provider API Key (Groq / Gemini / OpenAI)")

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
