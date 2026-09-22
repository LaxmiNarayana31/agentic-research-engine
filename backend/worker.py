import asyncio
import os
import json
import uuid
import time
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as redis
from arq import worker

# App imports
from app.core.config import settings
from app.core.logging import logger
from app.core.redis_pubsub import publish_event
from app.db.database import AsyncSessionLocal
from app.models import ResearchSession, JobEvent
from sqlalchemy.future import select
from app.agents.graph import build_research_graph

async def _persist_event_worker(session_id: str, event: dict):
    try:
        async with AsyncSessionLocal() as db:
            row = JobEvent(
                id=str(uuid.uuid4()),
                session_id=session_id,
                event_id=event.get("event_id", 0),
                event_type=event.get("type", "unknown"),
                payload=event,
            )
            db.add(row)
            try:
                await db.commit()
            except Exception:
                await db.rollback()
    except Exception as e:
        logger.debug(f"Job event persistence notice: {e}")

async def publish_and_persist(session_id: str, event: dict, event_id_counter: dict):
    eid = event_id_counter["next"]
    event["event_id"] = eid
    event_id_counter["next"] += 1
    
    await _persist_event_worker(session_id, event)
    await publish_event(session_id, event)

async def research_job(ctx, session_id: str, query: str, effort_level: str, previous_session_id: Optional[str] = None, user_id: Optional[str] = None, tenant_id: Optional[str] = None, existing_turns: list = None):
    logger.info(f"Worker processing job {session_id} for query '{query}'")
    
    event_id_counter = {"next": 1}
    
    # Send init event
    await publish_and_persist(session_id, {
        "type": "session_created",
        "id": session_id,
        "query": query,
        "effort_level": effort_level,
        "status": "running",
        "turns": existing_turns or []
    }, event_id_counter)
    
    # Initialize graph
    workflow = build_research_graph()
    
    initial_state = {
        "query": query,
        "effort_level": effort_level,
        "conversation_history": existing_turns,
        "plan": None,
        "findings": [],
        "verifications": [],
        "report": None,
        "critic_feedback": None,
        "rewrite_count": 0,
        "max_rewrites": 1
    }
    
    try:
        # Astream events
        async for output in workflow.astream(initial_state):
            logger.info(f"Workflow output step: {output.keys()}")
            
            for node_name, node_state in output.items():
                if "plan" in node_state and node_state["plan"]:
                    await publish_and_persist(session_id, {"type": "plan", "data": node_state["plan"].model_dump()}, event_id_counter)
                
                if "findings" in node_state and node_state["findings"]:
                    for f in node_state["findings"]:
                        await publish_and_persist(session_id, {"type": "finding", "data": f.model_dump()}, event_id_counter)
                        
                if "verifications" in node_state and node_state["verifications"]:
                    # publish verifications
                    await publish_and_persist(session_id, {"type": "verifications", "data": [v.model_dump() for v in node_state["verifications"]]}, event_id_counter)
                    
                if "report" in node_state and node_state["report"]:
                    await publish_and_persist(session_id, {"type": "report", "data": node_state["report"].model_dump()}, event_id_counter)
                    
        # Done
        await publish_and_persist(session_id, {
            "type": "done",
            "id": session_id,
            "message": "Research job completed successfully."
        }, event_id_counter)
        
    except Exception as e:
        logger.error(f"Worker graph failed: {e}")
        await publish_and_persist(session_id, {
            "type": "error",
            "message": str(e)
        }, event_id_counter)

async def startup(ctx):
    logger.info("Worker starting up...")
    ctx['redis'] = redis.from_url(settings.redis_url)

async def shutdown(ctx):
    logger.info("Worker shutting down...")
    if 'redis' in ctx:
        await ctx['redis'].aclose()

class WorkerSettings:
    functions = [research_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = settings.redis_url
