import asyncio
import json
import os
import re
from typing import Any, Dict, List, Tuple
import uuid

from google import genai
from openai import AsyncOpenAI
import psycopg

try:
    from memori import Memori
except ImportError:
    Memori = None

from app.core.config import settings
from app.core.errors import EmbeddingRateLimitError
from app.core.logging import logger

def init_memori_engine():
    """Initializes Memori strictly with PostgreSQL database."""
    if Memori is None:
        logger.warning("Memori package not installed. Skipping memory engine initialization.")
        return None

    DB_HOST = os.getenv("DB_HOST")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_USER = os.getenv("DB_USER")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_NAME = os.getenv("DB_NAME")
    SSL_MODE = os.getenv("SSL_MODE", "")
    
    has_pg = bool(DB_HOST and DB_USER and DB_NAME)
    
    if has_pg:
        ssl_arg = f"?sslmode={SSL_MODE}" if SSL_MODE else ""
        pg_conn_str = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}{ssl_arg}"
        try:
            test_conn = psycopg.connect(pg_conn_str, connect_timeout=4)
            test_conn.close()
            mem = Memori(conn=lambda: psycopg.connect(pg_conn_str))
            logger.info("Memori SDK initialized with PostgreSQL database.")
            return mem
        except Exception as e:
            logger.error(f"Memori PostgreSQL connection error: {e}")
            return None
    return None

_mem = init_memori_engine()

def set_memory_context(entity_id: str = "research_user", process_id: str = None):
    """Sets unique entity_id and process/conversation UUID in local Memori."""
    if _mem:
        try:
            pid = process_id or f"session_{uuid.uuid4()}"
            _mem.attribution(entity_id=entity_id, process_id=pid)
        except Exception as e:
            logger.warning(f"Failed to set local Memori context: {e}")


class MultiModelLLMClient:
    """Client that attempts to query LLMs in order of preference."""
    
    def __init__(self, agent_role: str = "general"):
        self.agent_role = agent_role
        
        # Gemini client (initialized once, registered with Memori once)
        gemini_key = settings.gemini_api_key if settings.gemini_api_key != "dev_key" else settings.llm_api_key
        if gemini_key and gemini_key != "dev_key":
            self._raw_gemini_client = genai.Client(api_key=gemini_key)
            self._gemini_client = genai.Client(api_key=gemini_key)
            if _mem:
                try:
                    _mem.llm.register(self._gemini_client)
                    _mem.attribution(entity_id="research_user", process_id=f"deep_research_{agent_role}")
                except Exception as e:
                    logger.warning(f"Memori registration failed for Gemini client: {e}")
        else:
            self._raw_gemini_client = None
            self._gemini_client = None
            
        # Groq client via AsyncOpenAI (initialized once, registered with Memori once)
        groq_key = settings.groq_api_key if settings.groq_api_key != "dev_key" else settings.llm_api_key
        if groq_key and groq_key != "dev_key":
            self._groq_client = AsyncOpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1")
            if _mem:
                try:
                    _mem.llm.register(self._groq_client)
                except Exception as e:
                    logger.warning(f"Memori registration failed for Groq client: {e}")
        else:
            self._groq_client = None

    def _get_fallback_chain(self, effort_level: str = "medium") -> List[Dict[str, str]]:
        try:
            if self.agent_role == "planner":
                return [
                    {"provider": "gemini", "model": "gemma-4-31b-it"},
                    {"provider": "gemini", "model": "gemma-4-26b-a4b-it"},
                    {"provider": "groq", "model": "openai/gpt-oss-120b"},
                    {"provider": "gemini", "model": "gemini-3.7-flash"}
                ]
            if effort_level == "low":
                return [
                    {"provider": "gemini", "model": "gemma-4-31b-it"},
                    {"provider": "gemini", "model": "gemma-4-26b-a4b-it"},
                    {"provider": "gemini", "model": "gemini-3.5-flash-lite"},
                    {"provider": "gemini", "model": "gemini-3.1-flash-lite"}
                ]
            elif effort_level == "medium":
                return [
                    {"provider": "gemini", "model": "gemma-4-31b-it"},
                    {"provider": "gemini", "model": "gemma-4-26b-a4b-it"},
                    {"provider": "gemini", "model": "gemini-3.5-flash"},
                    {"provider": "gemini", "model": "gemini-3.1-pro-preview"}
                ]
            elif effort_level == "high":
                return [
                    {"provider": "gemini", "model": "gemma-4-31b-it"},
                    {"provider": "gemini", "model": "gemma-4-26b-a4b-it"},
                    {"provider": "gemini", "model": "gemini-3.7-flash"},
                    {"provider": "groq", "model": "openai/gpt-oss-120b"}
                ]
            return [
                {"provider": "gemini", "model": "gemma-4-31b-it"},
                {"provider": "gemini", "model": "gemma-4-26b-a4b-it"},
                {"provider": "gemini", "model": "gemini-3.7-flash"},
                {"provider": "groq", "model": "openai/gpt-oss-120b"}
            ]
        except Exception:
            return [{"provider": "gemini", "model": "gemma-4-31b-it"}]
        
    async def complete_json(self, prompt: str, effort_level: str = "medium") -> Tuple[Dict[Any, Any], str]:
        """Tries to get a JSON response from the models in the fallback chain with full exception safety."""
        last_error = None
        models_to_try = self._get_fallback_chain(effort_level)
        
        for config in models_to_try:
            provider = config["provider"]
            model = config["model"]
            
            try:
                if provider == "groq":
                    res = await self._call_groq(prompt, model)
                elif provider == "gemini":
                    res = await self._call_gemini(prompt, model)
                else:
                    continue
                
                # Attempt to parse JSON from response
                match = re.search(r'\{.*\}', res, re.DOTALL)
                if match:
                    return json.loads(match.group(0)), model
                else:
                    logger.warning(f"Model {model} did not return valid JSON.")
                    continue
            except Exception as e:
                logger.warning(f"LLM call failed for {provider}/{model}: {e}")
                last_error = e
                continue
                
        raise RuntimeError(f"All LLM fallbacks failed. Last error: {last_error}")

    async def complete_text(self, prompt: str, effort_level: str = "medium") -> Tuple[str, str]:
        """Tries to get a raw text response from the models in the fallback chain."""
        last_error = None
        models_to_try = self._get_fallback_chain(effort_level)
        
        for config in models_to_try:
            provider = config["provider"]
            model = config["model"]
            
            try:
                if provider == "groq":
                    res = await self._call_groq(prompt, model)
                elif provider == "gemini":
                    res = await self._call_gemini(prompt, model)
                else:
                    continue
                return res, model
            except Exception as e:
                logger.warning(f"LLM call failed for {provider}/{model}: {e}")
                last_error = e
                continue
                
        raise RuntimeError(f"All LLM fallbacks failed. Last error: {last_error}")

    async def _call_groq(self, prompt: str, model: str) -> str:
        try:
            if not self._groq_client:
                raise ValueError("Groq API key not set")

            response = await self._groq_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.warning(f"Groq API call exception on {model}: {e}")
            raise
            
    async def _call_gemini(self, prompt: str, model: str) -> str:
        try:
            client = self._raw_gemini_client or self._gemini_client
            if not client:
                raise ValueError("Gemini API key not set")

            last_err = None
            for attempt in range(3):
                try:
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=prompt
                    )
                    return response.text
                except Exception as e:
                    last_err = e
                    if "getaddrinfo failed" in str(e) or "503" in str(e):
                        logger.warning(f"Gemini {model} attempt {attempt+1}/3 failed (transient): {e}")
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    raise
            if last_err:
                raise last_err
            raise RuntimeError(f"Gemini {model} failed after retries.")
        except Exception as top_e:
            logger.warning(f"Gemini call exception on {model}: {top_e}")
            raise

    async def stream_text(self, prompt: str, effort_level: str = "medium"):
        """Yields raw text tokens from the models in the fallback chain."""
        last_error = None
        models_to_try = self._get_fallback_chain(effort_level)
        
        for config in models_to_try:
            provider = config["provider"]
            model = config["model"]
            
            try:
                if provider == "groq":
                    async for chunk in self._stream_groq(prompt, model):
                        yield chunk
                elif provider == "gemini":
                    async for chunk in self._stream_gemini(prompt, model):
                        yield chunk
                return
            except Exception as e:
                logger.warning(f"LLM streaming failed for {provider}/{model}: {e}")
                last_error = e
                continue
                
        raise RuntimeError(f"All LLM fallbacks failed for streaming. Last error: {last_error}")

    async def _stream_groq(self, prompt: str, model: str):
        try:
            if not self._groq_client:
                raise ValueError("Groq API key not set")

            response = await self._groq_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                stream=True
            )
            async for chunk in response:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
        except Exception as e:
            logger.warning(f"Groq streaming exception on {model}: {e}")
            raise

    async def _stream_gemini(self, prompt: str, model: str):
        try:
            client = self._raw_gemini_client or self._gemini_client
            if not client:
                raise ValueError("Gemini API key not set")

            last_err = None
            for attempt in range(3):
                try:
                    response = await client.aio.models.generate_content_stream(
                        model=model,
                        contents=prompt
                    )
                    async for chunk in response:
                        if chunk.text:
                            yield chunk.text
                    return
                except Exception as e:
                    last_err = e
                    if "getaddrinfo failed" in str(e) or "503" in str(e):
                        logger.warning(f"Gemini stream {model} attempt {attempt+1}/3 failed (transient): {e}")
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    raise
            if last_err:
                raise last_err
            raise RuntimeError(f"Gemini stream {model} failed after retries.")
        except Exception as top_e:
            logger.warning(f"Gemini stream exception on {model}: {top_e}")
            raise

    async def get_embeddings(self, texts: list[str]) -> list[list[float]]:
        try:
            client_to_use = self._raw_gemini_client or self._gemini_client
            if not client_to_use:
                raise ValueError("Gemini API key not set")

            models_to_try = ['models/gemini-embedding-001', 'gemini-embedding-001', 'gemini-embedding-2']
            BATCH_SIZE = 50
            all_embeddings = []

            for i in range(0, len(texts), BATCH_SIZE):
                batch_texts = texts[i:i + BATCH_SIZE]
                batch_result = None
                last_err = None
                for model in models_to_try:
                    try:
                        response = await client_to_use.aio.models.embed_content(
                            model=model,
                            contents=batch_texts
                        )
                        if not isinstance(response.embeddings, list):
                            batch_result = [response.embeddings.values]
                        else:
                            batch_result = [e.values for e in response.embeddings]
                        break
                    except Exception as e:
                        logger.warning(f"Embedding batch [{i}:{i+len(batch_texts)}] failed with {model}: {e}")
                        last_err = e
                
                if batch_result is None:
                    raise EmbeddingRateLimitError(f"All embedding models failed for batch. Last error: {last_err}")
                all_embeddings.extend(batch_result)

            return all_embeddings
        except EmbeddingRateLimitError:
            raise
        except Exception as top_err:
            logger.error(f"Error generating embeddings: {top_err}")
            raise
