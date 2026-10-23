import contextvars
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import phoenix as px

logger = logging.getLogger(__name__)

# Track active Phoenix session URL
_phoenix_url: Optional[str] = None
_phoenix_initialized: bool = False

def init_phoenix_tracing() -> Optional[str]:
    """Initializes Arize Phoenix tracing locally if enabled or requested."""
    global _phoenix_url, _phoenix_initialized
    if _phoenix_initialized:
        return _phoenix_url

    enable_phoenix = os.getenv("ENABLE_PHOENIX_TRACING", "true").lower() in ("true", "1", "yes")
    if not enable_phoenix:
        _phoenix_initialized = True
        return None

    try:
        # Check if already running or launch non-blocking
        session = px.launch_app()
        _phoenix_url = session.url if session else "http://localhost:6006"
        _phoenix_initialized = True
        logger.info(f"Arize Phoenix Observability active at: {_phoenix_url}")
        return _phoenix_url
    except Exception as e:
        logger.debug(f"Phoenix tracing initialization notice: {e}")
        _phoenix_initialized = True
        return None

def get_phoenix_url() -> Optional[str]:
    return _phoenix_url or "http://localhost:6006"

# Current active span metadata context
active_trace_context: contextvars.ContextVar[Dict[str, Any]] = contextvars.ContextVar(
    "active_trace_context", default={}
)

@asynccontextmanager
async def trace_agent_span(agent_name: str, session_id: Optional[str] = None, **attributes):
    """Context manager recording duration, tokens, and status for an agent hop."""
    start_time = time.perf_counter()
    span_id = f"{agent_name}_{int(time.time() * 1000)}"
    trace_data = {
        "span_id": span_id,
        "agent": agent_name,
        "session_id": session_id,
        "start_time": start_time,
        **attributes
    }
    prev_ctx = active_trace_context.get()
    token = active_trace_context.set({**prev_ctx, **trace_data})
    
    logger.info(f"[TRACE START] Agent: {agent_name} | Session: {session_id or 'none'}")
    try:
        yield trace_data
    except Exception as e:
        duration = round((time.perf_counter() - start_time) * 1000, 2)
        logger.error(f"[TRACE ERROR] Agent: {agent_name} failed after {duration}ms: {e}")
        raise
    finally:
        duration = round((time.perf_counter() - start_time) * 1000, 2)
        trace_data["duration_ms"] = duration
        logger.info(f"[TRACE COMPLETE] Agent: {agent_name} finished in {duration}ms")
        active_trace_context.reset(token)

