import asyncio
from datetime import datetime, timezone
import json
import random
import textwrap
import time
from typing import AsyncGenerator, Dict, List, Optional, Set
import uuid

import httpx
from sqlalchemy.future import select
from app.core.config import settings

from app.agents.critic import CriticAgent
from app.agents.planner import PlannerAgent
from app.agents.report_writer import ReportWriterAgent
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent
from app.clients.llm_client import set_memory_context, token_usage_callback, calculate_cost
from app.core.logging import logger
from app.db.database import AsyncSessionLocal
from app.dtos.api_dto import ResearchPipelineResponse
from app.dtos.planner_dto import PlannerSubTask
from app.dtos.researcher_dto import ResearchFinding
from app.models.job_event import JobEvent
from app.models.research_session import ResearchSession
from app.services.semantic_cache import semantic_cache


async def _persist_event(session_id: str, event: dict) -> None:
    """Fire-and-forget DB write for a single SSE event.

    Silently swallowed on error so a DB hiccup never blocks the broadcast path.
    Uses INSERT ... ON CONFLICT DO NOTHING so replaying cached events is safe.
    """
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
            # ON CONFLICT DO NOTHING via exception swallow — duplicate event_ids are ignored
            try:
                await db.commit()
            except Exception:
                await db.rollback()
    except Exception as e:
        logger.debug(f"Job event persistence notice (non-fatal): {e}")


async def _load_events_from_db(session_id: str, after_event_id: Optional[int] = None) -> List[dict]:
    """Load persisted SSE events for a session from PostgreSQL, ordered by event_id.

    Used by reconnect / subscribe paths when the ActiveJob is no longer in memory.
    """
    try:
        async with AsyncSessionLocal() as db:
            stmt = (
                select(JobEvent)
                .where(JobEvent.session_id == session_id)
                .order_by(JobEvent.event_id.asc())
            )
            if after_event_id is not None:
                stmt = stmt.where(JobEvent.event_id > after_event_id)
            result = await db.execute(stmt)
            rows = result.scalars().all()
            return [row.payload for row in rows]
    except Exception as e:
        logger.warning(f"Failed to load events from DB for session {session_id}: {e}")
        return []

class ActiveJob:
    """
    Thread-safe Pub-Sub Job for decoupled background research execution.
    Allows independent background execution and seamless re-connection from multiple clients.
    """
    def __init__(self, session_id: str, query: str, effort_level: str, is_follow_up: bool = False, existing_turns: Optional[List[dict]] = None):
        self.session_id = session_id
        self.query = query
        self.effort_level = effort_level
        self.is_follow_up = is_follow_up
        self.existing_turns = existing_turns or []
        self.subscribers: Set[asyncio.Queue] = set()
        self.history_events: List[dict] = []
        self.next_event_id: int = 1
        self.status = "running"
        self.completed = False
        self.task: Optional[asyncio.Task] = None
        self.created_at = datetime.now(timezone.utc)
        self.current_plan = None
        self.current_findings = []
        self.current_verifications = []
        self.current_report = None
        self.prompt_tokens: int = 0
        self.completion_tokens: int = 0
        self.total_tokens: int = 0
        self.estimated_cost_usd: float = 0.0
        self.groundedness_score: float = 0.0

    def add_token_usage(self, prompt_tokens: int = 0, completion_tokens: int = 0, total_tokens: int = 0, model: str = "default"):
        """Accumulates exact provider-reported token counts and calculates cost using official model pricing."""
        self.prompt_tokens += prompt_tokens
        self.completion_tokens += completion_tokens
        self.total_tokens = self.prompt_tokens + self.completion_tokens
        self.estimated_cost_usd = round(calculate_cost(self.prompt_tokens, self.completion_tokens, model), 6)

    def broadcast(self, event: dict):
        try:
            if "event_id" not in event:
                event["event_id"] = self.next_event_id
                self.next_event_id += 1

            self.history_events.append(event)

            # Persist to PostgreSQL for durability across restarts/replicas
            asyncio.ensure_future(_persist_event(self.session_id, event))

            # Track live in-progress state for instant mid-stream snapshot retrieval
            etype = event.get("type")
            if etype == "plan":
                self.current_plan = event.get("data")
            elif etype == "finding":
                fdata = event.get("data")
                if fdata:
                    exists = any(f.get("task_id") == fdata.get("task_id") for f in self.current_findings if isinstance(f, dict))
                    if exists:
                        self.current_findings = [fdata if (isinstance(f, dict) and f.get("task_id") == fdata.get("task_id")) else f for f in self.current_findings]
                    else:
                        self.current_findings.append(fdata)
            elif etype == "verifications":
                self.current_verifications = event.get("data")
            elif etype == "groundedness_score":
                self.groundedness_score = event.get("score", 0.0)
            elif etype == "metrics":
                mdata = event.get("data", {})
                self.total_tokens = mdata.get("total_tokens", self.total_tokens)
                self.estimated_cost_usd = mdata.get("estimated_cost_usd", self.estimated_cost_usd)
            elif etype == "report":
                self.current_report = event.get("data")
            elif etype == "report_token":
                if not self.current_report:
                    self.current_report = {"markdown_content": "", "title": "Synthesizing Report..."}
                self.current_report["markdown_content"] = (self.current_report.get("markdown_content") or "") + event.get("token", "")
            elif etype == "clear_report":
                self.current_report = None

            for q in list(self.subscribers):
                try:
                    q.put_nowait(event)
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"Broadcast event notification notice: {e}")

    def add_subscriber(self) -> asyncio.Queue:
        q = asyncio.Queue()
        self.subscribers.add(q)
        return q

    def remove_subscriber(self, q: asyncio.Queue):
        self.subscribers.discard(q)

    def cancel(self):
        """Cancels background execution and notifies all active subscribers."""
        self.status = "cancelled"
        self.completed = True
        if self.task and not self.task.done():
            self.task.cancel()
        self.broadcast({
            "type": "cancelled",
            "session_id": self.session_id,
            "message": "Research job was cancelled by user."
        })

    def close(self):
        for q in list(self.subscribers):
            try:
                q.put_nowait(None)
            except Exception:
                pass


def serialize_research_session(session: ResearchSession) -> dict:
    """Service-level serialization for ResearchSession entity with multi-turn conversational history."""
    try:
        turns = []
        if session.report_data and isinstance(session.report_data, dict) and "turns" in session.report_data and isinstance(session.report_data["turns"], list):
            turns = session.report_data["turns"]
        else:
            turns = [{
                "query": session.query,
                "effort_level": session.effort_level,
                "plan": session.plan_data,
                "findings": session.findings_data,
                "verifications": session.verifications_data,
                "report": session.report_data
            }]

        return {
            "id": session.id,
            "user_id": session.user_id,
            "tenant_id": session.tenant_id,
            "query": session.query,
            "effort_level": session.effort_level,
            "status": session.status,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "updated_at": session.updated_at.isoformat() if session.updated_at else None,
            "plan": session.plan_data,
            "findings": session.findings_data,
            "verifications": session.verifications_data,
            "report": session.report_data,
            "turns": turns
        }
    except Exception as e:
        logger.error(f"Error serializing research session: {e}")
        return {
            "id": getattr(session, "id", str(uuid.uuid4())),
            "query": getattr(session, "query", ""),
            "status": "error",
            "turns": []
        }


class ResearchService:
    def __init__(self):
        self.planner_agent = PlannerAgent()
        self.research_agent = ResearchAgent()
        self.verifier_agent = VerificationAgent()
        self.writer_agent = ReportWriterAgent()
        self.critic_agent = CriticAgent()
        
        # We will initialize the arq pool lazily
        self._arq_pool = None

    async def get_arq_pool(self):
        from arq import create_pool
        from arq.connections import RedisSettings
        from urllib.parse import urlparse
        if not self._arq_pool:
            from app.core.config import settings
            u = urlparse(settings.redis_url)
            redis_settings = RedisSettings(host=u.hostname, port=u.port or 6379)
            self._arq_pool = await create_pool(redis_settings)
        return self._arq_pool

    def _extract_existing_turns(self, session_record: ResearchSession) -> List[dict]:
        """Safely extracts, sanitizes and preserves all previous completed turns from database entity."""
        try:
            existing_turns = []
            if session_record and session_record.report_data and isinstance(session_record.report_data, dict):
                raw_existing = session_record.report_data.get("turns", [])
                for t in raw_existing:
                    if isinstance(t, dict):
                        t_rep = {k: v for k, v in (t.get("report") or {}).items() if k != "turns"}
                        existing_turns.append({
                            "query": t.get("query"),
                            "effort_level": t.get("effort_level", "medium"),
                            "plan": t.get("plan"),
                            "findings": t.get("findings", []),
                            "verifications": t.get("verifications", []),
                            "report": t_rep,
                            "duration_seconds": t.get("duration_seconds")
                        })

            elif session_record and session_record.report_data:
                t_rep = {k: v for k, v in session_record.report_data.items() if k != "turns"}
                existing_turns.append({
                    "query": session_record.query,
                    "effort_level": session_record.effort_level,
                    "plan": session_record.plan_data,
                    "findings": session_record.findings_data or [],
                    "verifications": session_record.verifications_data or [],
                    "report": t_rep
                })
            return existing_turns
        except Exception as e:
            logger.error(f"Error extracting turns from session: {e}")
            return []

    async def get_history(self, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> dict:
        try:
            # Guests do not have persistent history
            if not user_id:
                return {"history": []}

            async with AsyncSessionLocal() as db:
                stmt = select(ResearchSession).order_by(ResearchSession.created_at.desc()).limit(30)
                if tenant_id:
                    stmt = stmt.where((ResearchSession.user_id == user_id) | (ResearchSession.tenant_id == tenant_id))
                else:
                    stmt = stmt.where(ResearchSession.user_id == user_id)

                result = await db.execute(stmt)
                sessions = result.scalars().all()
                history_list = []
                for s in sessions:
                    s_dict = serialize_research_session(s)
                    if s.id in self.active_jobs and not self.active_jobs[s.id].completed:
                        s_dict["status"] = "running"
                    history_list.append(s_dict)
                return {"history": history_list}
        except Exception as e:
            logger.error(f"Error fetching history from database: {e}")
            return {"history": []}

    async def get_session_by_id(self, session_id: str, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> dict:
        try:
            async with AsyncSessionLocal() as db:
                stmt = select(ResearchSession).where(ResearchSession.id == session_id)
                result = await db.execute(stmt)
                session = result.scalars().first()
                if session:
                    # Multi-tenant & User Isolation Check:
                    if session.user_id:
                        # Private session: require matching user_id or tenant_id
                        if not user_id or (session.user_id != user_id and session.tenant_id != tenant_id):
                            logger.warning(f"Unauthorized session access attempt: Guest/User '{user_id}' on session {session_id}")
                            return {"session": None}
                    elif session.tenant_id:
                        if not tenant_id or session.tenant_id != tenant_id:
                            logger.warning(f"Unauthorized tenant access on session {session_id}")
                            return {"session": None}

                    session_dict = serialize_research_session(session)
                    # If job is currently actively running in background memory, inject live status and state
                    if session_id in self.active_jobs and not self.active_jobs[session_id].completed:
                        job = self.active_jobs[session_id]
                        session_dict["status"] = "running"
                        session_dict["query"] = job.query
                        session_dict["effort_level"] = job.effort_level
                        if job.existing_turns:
                            session_dict["turns"] = job.existing_turns
                        if job.current_plan:
                            session_dict["plan"] = job.current_plan
                        if job.current_findings:
                            session_dict["findings"] = job.current_findings
                        if job.current_verifications:
                            session_dict["verifications"] = job.current_verifications
                        if job.current_report:
                            session_dict["report"] = job.current_report
                    return {"session": session_dict}
                return {"session": None}
        except Exception as e:
            logger.error(f"Error fetching session {session_id}: {e}")
            return {"session": None}

    async def cancel_job(self, session_id: str, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> dict:
        """Cancels an active or queued research job and marks status cancelled in DB."""
        try:
            job = self.active_jobs.get(session_id)
            if job and not job.completed:
                job.cancel()
                logger.info(f"Research job {session_id} cancelled in memory by user {user_id}")
                return {"success": True, "message": "Research job cancellation signal sent."}

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchSession).where(ResearchSession.id == session_id))
                s = result.scalars().first()
                if s:
                    if s.user_id and user_id and s.user_id != user_id:
                        return {"success": False, "message": "Unauthorized to cancel this session."}
                    s.status = "cancelled"
                    await db.commit()
                    return {"success": True, "message": "Research session marked as cancelled."}
            return {"success": False, "message": "No active research session found to cancel."}
        except Exception as e:
            logger.error(f"Error cancelling research job {session_id}: {e}")
            return {"success": False, "message": str(e)}

    async def get_suggestions(self) -> dict:
        """Fast dynamic suggestion generation via single fast LLM call (zero search overhead)."""
        try:
            count = random.randint(3, 5)
            prompt = textwrap.dedent(f"""\
                Generate {count} diverse, thought-provoking, cutting-edge research topics across frontier science, engineering, global industry, and technology.
                Return a JSON object:
                {{
                    "suggestions": [
                        {{
                            "label": "Short punchy label (3-6 words)",
                            "q": "The complete, detailed research question...",
                            "effort": "medium"
                        }}
                    ]
                }}
                Do not include any emojis in labels. Keep labels elegant and professional.
            """)
            data, _ = await self.planner_agent.llm_client.complete_json(prompt, effort_level="low")
            if data and isinstance(data.get("suggestions"), list) and len(data["suggestions"]) >= 1:
                return {"suggestions": data["suggestions"][:count]}
        except Exception as e:
            logger.warning(f"Failed to generate dynamic suggestions via LLM: {e}")

        return {
            "suggestions": [
                {
                    "label": "LLM Reasoning Architectures",
                    "q": "Compare test-time compute scaling vs post-training RL in frontier reasoning models like DeepSeek R1 and OpenAI o3",
                    "effort": "high"
                },
                {
                    "label": "Fusion Energy Commercialization",
                    "q": "Assess net energy gain milestones and magnet breakthroughs in commercial tokamak fusion startups",
                    "effort": "medium"
                },
                {
                    "label": "Quantum Error Correction",
                    "q": "Analyze recent neutral-atom and superconducting qubit error correction thresholds for fault-tolerant quantum computing",
                    "effort": "high"
                },
                {
                    "label": "Solid-State Battery Economics",
                    "q": "Evaluate silicon-anode and sulfide solid-state battery energy density, manufacturing yield, and EV cost parity",
                    "effort": "medium"
                }
            ]
        }

    async def create_plan(self, query: str, effort_level: str = "medium", previous_session_id: str = None, conversation_history: Optional[List[dict]] = None):
        try:
            session_pid = previous_session_id or f"session_{uuid.uuid4()}"
            set_memory_context(entity_id="research_user", process_id=session_pid)
            return await self.planner_agent.generate_plan(query, effort_level, conversation_history=conversation_history)
        except Exception as e:
            logger.error(f"Error in create_plan for '{query}': {e}")
            return await self.planner_agent.generate_plan(query, "medium", conversation_history=conversation_history)

    async def run_pipeline_sync(self, query: str, effort_level: str = "medium", previous_session_id: str = None, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> ResearchPipelineResponse:
        try:
            logger.info(f"Starting SYNC pipeline for query: '{query}', effort: {effort_level}, user: {user_id}")
            
            plan = await self.create_plan(query, effort_level, previous_session_id)
            if not plan.is_valid:
                raise ValueError(plan.validation_notes)

            findings = []
            for subtask in plan.sub_tasks:
                try:
                    finding = await self.research_agent.execute_subtask(subtask)
                    findings.append(finding)
                except Exception as e:
                    logger.warning(f"Subtask {subtask.task_id} failed: {e}")
                    raise e

            verifications = await self.verifier_agent.verify_findings(findings)
            
            max_rewrites = 1
            critic_feedback_str = None
            final_report = None
            
            for attempt in range(max_rewrites + 1):
                final_report = await self.writer_agent.write_report(
                    query,
                    findings,
                    verifications,
                    feedback=critic_feedback_str,
                    effort_level=effort_level,
                    outline=getattr(plan, "report_outline", None)
                )
                critic_result = await self.critic_agent.evaluate_report(
                    query,
                    final_report,
                    outline=getattr(plan, "report_outline", None)
                )
                if critic_result.get("approved"):
                    break
                else:
                    critic_feedback_str = critic_result.get("feedback")

            async with AsyncSessionLocal() as db:
                session_record = ResearchSession(
                    query=query,
                    effort_level=effort_level,
                    status="completed",
                    plan_data=plan.model_dump(),
                    findings_data=[f.model_dump() for f in findings],
                    verifications_data=[v.model_dump() for v in verifications],
                    report_data=final_report.model_dump()
                )
                db.add(session_record)
                await db.commit()
                await db.refresh(session_record)

            return ResearchPipelineResponse(
                id=session_record.id,
                status="success",
                query=query,
                plan=plan,
                findings=findings,
                verifications=verifications,
                report=final_report
            )
        except Exception as e:
            logger.error(f"Error in run_pipeline_sync: {e}")
            raise

    async def _execute_background_research(self, job: ActiveJob, query: str, effort_level: str, previous_session_id: Optional[str] = None, user_id: Optional[str] = None, tenant_id: Optional[str] = None):
        """
        Background autonomous research task that runs independently of client connections.
        Saves state progressively into DB and broadcasts events to all active subscribers.
        """
        session_id = job.session_id
        start_time = time.time()
        logger.info(f"Background Research Job started: [{session_id}] for '{query}' (Effort: {effort_level}, User: {user_id}, Tenant: {tenant_id})")

        # Register exact token usage accumulator using provider-reported usage_metadata/usage
        def _accumulate_tokens(p: int, c: int, t: int, model: str):
            job.add_token_usage(prompt_tokens=p, completion_tokens=c, total_tokens=t, model=model)
        token_usage_callback.set(_accumulate_tokens)

        try:
            # Immediate Database Session Creation & Real-Time Initial Checkpoint
            existing_turns = []
            async with AsyncSessionLocal() as db:
                if previous_session_id:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == previous_session_id))
                    session_record = result.scalars().first()
                    if session_record:
                        session_record.status = "running"
                        if user_id and not session_record.user_id:
                            session_record.user_id = user_id
                        if tenant_id and not session_record.tenant_id:
                            session_record.tenant_id = tenant_id
                        session_record.updated_at = datetime.now(timezone.utc)
                        existing_turns = self._extract_existing_turns(session_record)
                        job.existing_turns = existing_turns
                else:
                    # When a guest starts a new session, clean up previous guest sessions from DB
                    if not user_id:
                        old_guest_res = await db.execute(select(ResearchSession).where(ResearchSession.user_id == None))
                        for old_s in old_guest_res.scalars().all():
                            await db.delete(old_s)

                    session_record = ResearchSession(
                        id=session_id,
                        user_id=user_id,
                        tenant_id=tenant_id,
                        query=query,
                        effort_level=effort_level,
                        status="running",
                        report_data={"turns": []}
                    )
                    db.add(session_record)
                await db.commit()

            # Broadcast instant creation event with previous turns so frontend preserves conversation history
            job.broadcast({
                "type": "session_created",
                "id": session_id,
                "query": query,
                "effort_level": effort_level,
                "status": "running",
                "turns": existing_turns
            })

            query_vector = None
            try:
                query_vector = (await self.planner_agent.llm_client.get_embeddings([query]))[0]
                cached_match = await semantic_cache.search_similar_query(query, query_vector, similarity_threshold=0.88)
                
                if cached_match and cached_match.get("data"):
                    job.broadcast({
                        "type": "status", 
                        "message": "Found verified research results for this topic..."
                    })
                    
                    cached_data = cached_match["data"]
                    cached_plan = cached_data.get("plan")
                    cached_findings = cached_data.get("findings", [])
                    cached_verifications = cached_data.get("verifications", [])
                    cached_report = cached_data.get("report", {})
                    
                    if cached_plan:
                        job.broadcast({"type": "plan", "data": cached_plan})
                    for f in cached_findings:
                        job.broadcast({"type": "finding", "data": f})
                    if cached_verifications:
                        job.broadcast({"type": "verifications", "data": cached_verifications})
                    if cached_report:
                        job.broadcast({"type": "report", "data": cached_report})
                        if "related_questions" in cached_report:
                            job.broadcast({"type": "related_questions", "questions": cached_report["related_questions"]})
                    
                    # Persist turn in database without circular references
                    async with AsyncSessionLocal() as db:
                        result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                        session_record = result.scalars().first()
                        
                        clean_cached_report = {k: v for k, v in (cached_report or {}).items() if k != "turns"}
                        new_turn = {
                            "query": query,
                            "effort_level": effort_level,
                            "plan": cached_plan,
                            "findings": cached_findings,
                            "verifications": cached_verifications,
                            "report": clean_cached_report
                        }
                        
                        all_turns = existing_turns + [new_turn] if previous_session_id else [new_turn]
                        persisted_report_data = {
                            **clean_cached_report,
                            "turns": all_turns
                        }

                        if session_record:
                            session_record.status = "completed"
                            session_record.plan_data = cached_plan
                            session_record.findings_data = cached_findings
                            session_record.verifications_data = cached_verifications
                            session_record.report_data = persisted_report_data
                            session_record.updated_at = datetime.now(timezone.utc)
                        else:
                            session_record = ResearchSession(
                                id=session_id,
                                query=query,
                                effort_level=effort_level,
                                status="completed",
                                plan_data=cached_plan,
                                findings_data=cached_findings,
                                verifications_data=cached_verifications,
                                report_data=persisted_report_data
                            )
                            db.add(session_record)
                        await db.commit()
                        await db.refresh(session_record)
                    
                    job.broadcast({
                        "type": "done",
                        "id": session_record.id,
                        "turns": all_turns
                    })
                    job.status = "completed"
                    job.completed = True
                    return
            except Exception as e:
                logger.warning(f"Semantic vector cache check note: {e}")

            # Plan Generation
            job.broadcast({"type": "status", "message": "Formulating research topics..."})
            plan = await self.create_plan(query, effort_level, previous_session_id, conversation_history=existing_turns)
            
            if not plan.is_valid:
                job.broadcast({"type": "error", "message": plan.validation_notes})
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                    s = result.scalars().first()
                    if s:
                        s.status = "failed"
                        s.report_data = {
                            "error": plan.validation_notes,
                            "turns": existing_turns
                        }
                        await db.commit()
                return

            # Checkpoint Plan
            job.broadcast({"type": "plan", "data": plan.model_dump()})
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                s = result.scalars().first()
                if s:
                    s.plan_data = plan.model_dump()
                    await db.commit()

            # Concurrent Subtask Execution
            findings = []
            queue = asyncio.Queue()
            
            async def worker(subtask):
                try:
                    async for chunk in self.research_agent.execute_subtask_stream(subtask):
                        await queue.put(chunk)
                    await queue.put({"type": "worker_done", "task_id": subtask.task_id})
                except Exception as e:
                    logger.error(f"Worker for {subtask.task_id} failed: {e}")
                    # Create a finding that honestly marks the failure — no fabricated URLs.
                    try:
                        fallback_finding = ResearchFinding(
                            task_id=subtask.task_id,
                            summary=f"Research worker failed for '{subtask.description}'. No evidence collected.",
                            sources=[],
                            rich_sources=[],
                            raw_data={"worker_error": str(e)},
                            used_model="worker-failed"
                        )
                        await queue.put({"type": "finding", "content": fallback_finding})
                    except Exception as synth_err:
                        logger.warning(f"Worker fallback finding error: {synth_err}")
                    await queue.put({"type": "worker_done", "task_id": subtask.task_id})

            job.broadcast({"type": "status", "message": f"Searching web sources across {len(plan.sub_tasks)} topics..."})
            
            # Start all tasks concurrently
            for st in plan.sub_tasks:
                asyncio.create_task(worker(st))
            
            completed = 0
            while completed < len(plan.sub_tasks):
                chunk = await queue.get()
                if chunk["type"] == "worker_done":
                    completed += 1
                elif chunk["type"] == "worker_error":
                    completed += 1
                    logger.warning(f"Subtask worker error recovered gracefully: {chunk.get('error')}")
                elif chunk["type"] == "finding":
                    finding = chunk["content"]
                    findings.append(finding)
                    job.broadcast({"type": "finding", "data": finding.model_dump()})
                    
                    # Periodic findings checkpoint in DB
                    try:
                        async with AsyncSessionLocal() as db:
                            result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                            s = result.scalars().first()
                            if s:
                                s.findings_data = [f.model_dump() for f in findings]
                                await db.commit()
                    except Exception as e:
                        logger.warning(f"Findings checkpoint error: {e}")
                elif chunk["type"] == "search_progress":
                    job.broadcast(chunk)

            # Recursive Gap Analysis for High Effort queries
            if effort_level == "high" and findings:
                job.broadcast({"type": "status", "message": "Auditing findings for missing details..."})
                gap_prompt = textwrap.dedent(f"""\
                    You are a Lead Research Auditor conducting a Recursive Gap Analysis.
                    Primary Research Goal: "{query}"
                    
                    Collected Findings so far:
                    {chr(10).join([f'- Task {f.task_id}: {f.summary[:300]}' for f in findings])}
                    
                    Identify up to 2 critical, unanswered nuances, specific metrics, regulations, or counter-arguments that must be investigated in Depth-2.
                    Return a JSON object:
                    {{
                        "has_gaps": true,
                        "follow_up_subtasks": [
                            {{"task_id": "depth2_1", "description": "Specific query to investigate...", "required_tools": ["tavily_search"], "search_depth": "deep"}}
                        ]
                    }}
                    If the current findings are already exhaustive, return {{"has_gaps": false, "follow_up_subtasks": []}}.
                """)
                try:
                    gap_data, _ = await self.planner_agent.llm_client.complete_json(gap_prompt, effort_level="low")
                    if gap_data.get("has_gaps") and gap_data.get("follow_up_subtasks"):
                        depth2_tasks = [PlannerSubTask(**st) for st in gap_data["follow_up_subtasks"][:2]]
                        job.broadcast({"type": "status", "message": f"Searching {len(depth2_tasks)} follow-up angles..."})
                        for d2_task in depth2_tasks:
                            plan.sub_tasks.append(d2_task)
                        job.broadcast({"type": "plan", "data": plan.model_dump()})
                        
                        d2_queue = asyncio.Queue()
                        for d2_st in depth2_tasks:
                            async def d2_worker(st):
                                try:
                                    async for c in self.research_agent.execute_subtask_stream(st):
                                        await d2_queue.put(c)
                                    await d2_queue.put({"type": "worker_done", "task_id": st.task_id})
                                except Exception as e:
                                    logger.error(f"Depth-2 worker {st.task_id} failed: {e}")
                                    await d2_queue.put({"type": "worker_done", "task_id": st.task_id})
                            asyncio.create_task(d2_worker(d2_st))
                            
                        d2_completed = 0
                        while d2_completed < len(depth2_tasks):
                            d2_chunk = await d2_queue.get()
                            if d2_chunk["type"] == "worker_done":
                                d2_completed += 1
                            elif d2_chunk["type"] == "finding":
                                f_item = d2_chunk["content"]
                                findings.append(f_item)
                                job.broadcast({"type": "finding", "data": f_item.model_dump()})
                            elif d2_chunk["type"] == "search_progress":
                                job.broadcast(d2_chunk)
                except Exception as e:
                    logger.warning(f"Recursive gap analysis skipped: {e}")

            # Claim Verification & Groundedness Score Calculation
            job.broadcast({"type": "status", "message": "Cross-checking citations and facts..."})
            verifications = await self.verifier_agent.verify_findings(findings)

            if verifications:
                supported_count = sum(1 for v in verifications if getattr(v, "is_supported", False))
                avg_entailment = sum(getattr(v, "entailment_score", 0.0) for v in verifications) / len(verifications)
                groundedness_score = round(avg_entailment * 100.0, 1)
            else:
                # No verifications means we have no evidence to score — report 0.0, not a phantom 95.
                groundedness_score = 0.0
                supported_count = 0

            job.groundedness_score = groundedness_score
            job.broadcast({
                "type": "groundedness_score",
                "score": groundedness_score,
                "supported_claims": supported_count,
                "total_claims": len(verifications)
            })
            job.broadcast({"type": "verifications", "data": [v.model_dump() for v in verifications]})
            
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                s = result.scalars().first()
                if s:
                    s.verifications_data = [v.model_dump() for v in verifications]
                    await db.commit()

            # Report Synthesis
            max_rewrites = 1
            critic_feedback_str = None
            final_report = None
            
            for attempt in range(max_rewrites + 1):
                job.broadcast({"type": "status", "message": "Writing research summary..."})
                if attempt > 0:
                    job.broadcast({"type": "clear_report"})
                
                async for chunk in self.writer_agent.generate_report_stream(
                    query,
                    findings,
                    verifications,
                    feedback=critic_feedback_str,
                    effort_level=effort_level,
                    outline=getattr(plan, "report_outline", None)
                ):
                    if chunk["type"] == "token":
                        job.broadcast({"type": "report_token", "token": chunk["content"]})
                    elif chunk["type"] == "report":
                        final_report = chunk["content"]
                        job.broadcast({"type": "report", "data": final_report.model_dump()})
                
                job.broadcast({"type": "status", "message": "Critic Agent evaluating report quality..."})
                critic_result = await self.critic_agent.evaluate_report(
                    query,
                    final_report,
                    outline=getattr(plan, "report_outline", None)
                )
                
                if critic_result.get("approved"):
                    job.broadcast({"type": "status", "message": "Critic approved report!"})
                    break
                else:
                    critic_feedback_str = critic_result.get("feedback")
                    job.broadcast({"type": "status", "message": f"Critic requested revisions: {critic_feedback_str}"})

            # Suggested Follow-Up Research Topics
            related_questions = []
            try:
                related_prompt = textwrap.dedent(f"""\
                    Based on this completed research query and findings:
                    Query: "{query}"
                    Key Findings: {chr(10).join([f'- {f.summary[:200]}' for f in findings[:4]])}
                    
                    Generate exactly 3 or 4 compelling, forward-looking related follow-up research questions that a user would want to explore next (similar to Perplexity AI related questions).
                    Return a JSON object:
                    {{
                        "related_questions": [
                            "Specific follow-up question 1",
                            "Specific follow-up question 2",
                            "Specific follow-up question 3"
                        ]
                    }}
                """)
                rel_data, _ = await self.planner_agent.llm_client.complete_json(related_prompt, effort_level="low")
                if rel_data and isinstance(rel_data.get("related_questions"), list):
                    related_questions = [q for q in rel_data["related_questions"] if isinstance(q, str)][:4]
            except Exception as e:
                logger.warning(f"Error generating related questions: {e}")

            if not related_questions and final_report and getattr(final_report, "related_questions", None):
                related_questions = final_report.related_questions

            job.broadcast({"type": "related_questions", "questions": related_questions})

            # Broadcast exact provider-reported token usage metrics (accumulated via token_usage_callback)
            job.broadcast({
                "type": "metrics",
                "data": {
                    "prompt_tokens": job.prompt_tokens,
                    "completion_tokens": job.completion_tokens,
                    "total_tokens": job.total_tokens,
                    "estimated_cost_usd": job.estimated_cost_usd,
                    "groundedness_score": job.groundedness_score
                }
            })

            final_report_dict = final_report.model_dump() if final_report else {}
            final_report_dict["related_questions"] = related_questions
            final_report_dict["groundedness_score"] = job.groundedness_score
            final_report_dict["total_tokens"] = job.total_tokens
            final_report_dict["prompt_tokens"] = job.prompt_tokens
            final_report_dict["completion_tokens"] = job.completion_tokens
            final_report_dict["estimated_cost_usd"] = job.estimated_cost_usd

            # Complete Database Persistence with Full Historical Turns
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                session_record = result.scalars().first()

                duration = round(time.time() - start_time, 1)
                clean_final_report = {k: v for k, v in final_report_dict.items() if k != "turns"}
                clean_final_report["duration_seconds"] = duration
                new_turn = {
                    "query": query,
                    "effort_level": effort_level,
                    "plan": plan.model_dump(),
                    "findings": [f.model_dump() for f in findings],
                    "verifications": [v.model_dump() for v in verifications],
                    "report": clean_final_report,
                    "groundedness_score": job.groundedness_score,
                    "total_tokens": job.total_tokens,
                    "estimated_cost_usd": job.estimated_cost_usd,
                    "duration_seconds": duration
                }

                all_turns = existing_turns + [new_turn] if previous_session_id else [new_turn]
                persisted_report_data = {
                    **clean_final_report,
                    "turns": all_turns
                }

                if session_record:
                    session_record.status = "completed"
                    session_record.plan_data = plan.model_dump()
                    session_record.findings_data = [f.model_dump() for f in findings]
                    session_record.verifications_data = [v.model_dump() for v in verifications]
                    session_record.report_data = persisted_report_data
                    session_record.updated_at = datetime.now(timezone.utc)
                else:
                    session_record = ResearchSession(
                        id=session_id,
                        query=query,
                        effort_level=effort_level,
                        status="completed",
                        plan_data=plan.model_dump(),
                        findings_data=[f.model_dump() for f in findings],
                        verifications_data=[v.model_dump() for v in verifications],
                        report_data=persisted_report_data
                    )
                    db.add(session_record)

                await db.commit()
                await db.refresh(session_record)

            # Save to Redis Semantic Vector Store Cache
            try:
                if query_vector is not None:
                    await semantic_cache.save_query_dossier(
                        query=query,
                        query_vector=query_vector,
                        payload={
                            "query": query,
                            "plan": plan.model_dump(),
                            "findings": [f.model_dump() for f in findings],
                            "verifications": [v.model_dump() for v in verifications],
                            "report": final_report_dict
                        },
                        ttl_seconds=86400
                    )
            except Exception as se:
                logger.warning(f"Error saving to semantic cache: {se}")

            duration = round(time.time() - start_time, 1)
            logger.info(f"Background Research Job [{session_id}] COMPLETED successfully in {duration}s")
            job.broadcast({
                "type": "done",
                "id": session_record.id,
                "turns": all_turns
            })
            job.status = "completed"
            job.completed = True

        except asyncio.CancelledError:
            logger.info(f"Background Research Job [{session_id}] was CANCELLED by user.")
            job.status = "cancelled"
            job.completed = True
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                    s = result.scalars().first()
                    if s:
                        s.status = "cancelled"
                        if job.current_plan:
                            s.plan_data = job.current_plan
                        if job.current_findings:
                            s.findings_data = job.current_findings
                        if job.current_report:
                            s.report_data = {
                                "title": "Cancelled Research",
                                "markdown_content": job.current_report.get("markdown_content", ""),
                                "turns": existing_turns
                            }
                        await db.commit()
            except Exception as dbe:
                logger.error(f"Failed to record cancelled status in DB: {dbe}")

        except Exception as e:
            logger.error(f"Background Research Job [{session_id}] FAILED: {e}")
            job.broadcast({"type": "error", "message": str(e)})
            job.status = "failed"
            job.completed = True
            
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == (previous_session_id or session_id)))
                    s = result.scalars().first()
                    if s:
                        s.status = "failed"
                        s.report_data = {
                            "error": str(e),
                            "turns": existing_turns
                        }
                        await db.commit()
            except Exception as dbe:
                logger.error(f"Failed to record failed status in DB: {dbe}")
        finally:
            job.close()
            # Retain in active_jobs cache for 120 seconds to allow late reconnects, then clean up
            await asyncio.sleep(120)
            self.active_jobs.pop(session_id, None)

    async def stream_pipeline(
        self, 
        query: str, 
        effort_level: str = "medium", 
        previous_session_id: Optional[str] = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        SSE stream endpoint. Connects client to Redis PubSub and streams events live.
        """
        from app.core.redis_pubsub import subscribe_events
        try:
            target_id = session_id or previous_session_id or str(uuid.uuid4())
            
            existing_turns = []
            if previous_session_id:
                try:
                    async with AsyncSessionLocal() as db:
                        res = await db.execute(select(ResearchSession).where(ResearchSession.id == previous_session_id))
                        rec = res.scalars().first()
                        if rec:
                            existing_turns = self._extract_existing_turns(rec)
                except Exception as e:
                    logger.warning(f"Error pre-extracting existing turns {previous_session_id}: {e}")

            # Enqueue the background task via ARQ
            pool = await self.get_arq_pool()
            await pool.enqueue_job(
                "research_job",
                session_id=target_id,
                query=query,
                effort_level=effort_level,
                previous_session_id=previous_session_id,
                user_id=user_id,
                tenant_id=tenant_id,
                existing_turns=existing_turns
            )

            # Replay past accumulated events from DB if needed
            in_memory_events = await _load_events_from_db(target_id)
            for event in in_memory_events:
                eid = event.get("event_id")
                id_part = f"id: {eid}\n" if eid is not None else ""
                yield f"{id_part}data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error", "cancelled"):
                    return

            # Subscribe to real-time events from Redis
            async for event in subscribe_events(target_id):
                eid = event.get("event_id")
                id_part = f"id: {eid}\n" if eid is not None else ""
                yield f"{id_part}data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error", "cancelled"):
                    break
        except Exception as e:
            logger.error(f"Error in stream_pipeline: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    async def subscribe_session_stream(
        self,
        session_id: str,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        last_event_id: Optional[int] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Reconnect / resubscribe to an active research job or return completed session state.
        Uses last_event_id to replay only events the client missed during a network blip.
        """
        from app.core.redis_pubsub import subscribe_events
        try:
            # 1. Replay missed events from DB
            db_events = await _load_events_from_db(session_id, after_event_id=last_event_id)
            for event in db_events:
                eid = event.get("event_id")
                id_part = f"id: {eid}\n" if eid is not None else ""
                yield f"{id_part}data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error", "cancelled"):
                    return

            # 2. Subscribe to real-time events from Redis
            async for event in subscribe_events(session_id):
                eid = event.get("event_id")
                id_part = f"id: {eid}\n" if eid is not None else ""
                yield f"{id_part}data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error", "cancelled"):
                    break
                    
            # 3. If no live events and no db events, check if already done
            data = await self.get_session_by_id(session_id, user_id=user_id, tenant_id=tenant_id)
            session = data.get("session")
            if session:
                turns = session.get("turns") or []
                done_event = {
                    "type": "done",
                    "id": session_id,
                    "turns": turns,
                    "status": "completed",
                    "message": "Session completed"
                }
                yield f"data: {json.dumps(done_event)}\n\n"
            else:
                err_event = {
                    "type": "error",
                    "message": "Session not found."
                }
                yield f"data: {json.dumps(err_event)}\n\n"
        except Exception as e:
            logger.error(f"Error in subscribe_session_stream: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    async def stream_chat_pipeline(
        self, 
        query: str, 
        previous_session_id: Optional[str] = None, 
        session_id: Optional[str] = None,
        user_id: Optional[str] = None, 
        tenant_id: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """
        Fast, lightweight streaming chat mode (/chat) that converses directly with existing research dossiers
        and session context without triggering the heavy multi-agent execution cycle.
        """
        clean_query = query.strip()
        if clean_query.lower().startswith("/chat"):
            clean_query = clean_query[5:].strip()
        if not clean_query:
            clean_query = "Hello! What did you discover in the research dossier?"

        effective_session_id = previous_session_id or session_id or f"sess_{uuid.uuid4().hex[:12]}"
        session_pid = effective_session_id
        set_memory_context(entity_id="research_user", process_id=session_pid)

        existing_turns = []
        latest_dossier_text = ""

        try:
            async with AsyncSessionLocal() as db:
                session_record = None
                if previous_session_id:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == previous_session_id))
                    session_record = result.scalars().first()
                    if session_record:
                        existing_turns = self._extract_existing_turns(session_record)
                        if session_record.report_data and isinstance(session_record.report_data, dict):
                            latest_dossier_text = session_record.report_data.get("markdown_content") or ""
                        session_record.status = "running"
                        if user_id and not session_record.user_id:
                            session_record.user_id = user_id
                        session_record.updated_at = datetime.now(timezone.utc)
                        await db.commit()

                if not session_record:
                    # Check if session already exists by effective_session_id
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == effective_session_id))
                    session_record = result.scalars().first()
                    if session_record:
                        existing_turns = self._extract_existing_turns(session_record)
                        session_record.status = "running"
                        session_record.updated_at = datetime.now(timezone.utc)
                        await db.commit()
                    else:
                        # When a guest starts a new chat session, clean up previous guest sessions
                        if not user_id:
                            old_guest_res = await db.execute(select(ResearchSession).where(ResearchSession.user_id == None))
                            for old_s in old_guest_res.scalars().all():
                                await db.delete(old_s)

                        session_record = ResearchSession(
                            id=effective_session_id,
                            user_id=user_id,
                            tenant_id=tenant_id,
                            query=clean_query,
                            effort_level="chat",
                            status="running",
                            report_data={"turns": []}
                        )
                        db.add(session_record)
                        await db.commit()

            # Emit session_created with is_chat flag
            yield f"data: {json.dumps({'type': 'session_created', 'id': effective_session_id, 'query': clean_query, 'effort_level': 'chat', 'status': 'running', 'turns': existing_turns, 'is_chat': True})}\n\n"
            yield f"data: {json.dumps({'type': 'status', 'message': 'Engaging conversational response with research context...'})}\n\n"

            # Fast greeting check
            q_clean = clean_query.strip().lower().rstrip("!?.")
            is_simple_greeting = q_clean in [
                "hi", "hello", "hey", "hola", "greetings", "good morning", 
                "good afternoon", "good evening", "howdy", "sup", "what's up",
                "how are you", "who are you"
            ]

            web_search_context = ""
            chat_sources: List[dict] = []

            # If not a greeting, do a fast basic web search if query might need real-time info
            if not is_simple_greeting and len(clean_query) >= 3:
                tavily_key = settings.tavily_api_key
                if tavily_key and tavily_key != "dev_key":
                    try:
                        yield f"data: {json.dumps({'type': 'status', 'message': 'Searching the web...'})}\n\n"
                        async with httpx.AsyncClient() as client:
                            resp = await client.post(
                                "https://api.tavily.com/search",
                                json={
                                    "api_key": tavily_key,
                                    "query": clean_query,
                                    "search_depth": "basic",
                                    "max_results": 3,
                                },
                                timeout=6.0
                            )
                            if resp.status_code == 200:
                                res_data = resp.json()
                                results = res_data.get("results", [])
                                if results:
                                    snippets = []
                                    for r in results[:3]:
                                        url = r.get("url")
                                        title = r.get("title") or url
                                        snippet = r.get("content") or ""
                                        snippets.append(f"- [{title}]({url}): {snippet[:350]}")
                                        chat_sources.append({"url": url, "title": title})
                                    web_search_context = "RECENT WEB SEARCH RESULTS:\n" + "\n".join(snippets) + "\n"
                    except Exception as se:
                        logger.debug(f"Chat web search note: {se}")

            # Recent conversation context (last 2 turns only)
            conv_context = ""
            if existing_turns:
                lines = []
                for idx, t in enumerate(existing_turns[-2:]):
                    t_q = t.get("query", "")
                    t_ans = (t.get("report") or {}).get("summary") or ((t.get("report") or {}).get("markdown_content", ""))[:200]
                    if t_q:
                        lines.append(f"User: {t_q}\nAssistant: {t_ans}")
                if lines:
                    conv_context = "RECENT CONVERSATION:\n" + "\n".join(lines) + "\n"

            if is_simple_greeting:
                prompt = textwrap.dedent(f"""\
                    The user said: "{clean_query}"
                    Reply with a friendly, natural, and concise greeting (1-2 sentences). 
                    Ask how you can help them today. Do NOT write a long speech or lecture.
                """)
            else:
                prompt = textwrap.dedent(f"""\
                    You are a helpful, smart, and direct AI assistant in conversational chat mode.
                    
                    {web_search_context}
                    {conv_context}
                    
                    USER QUERY:
                    "{clean_query}"
                    
                    INSTRUCTIONS:
                    - Provide a simple, clear, and direct answer.
                    - If web search results are provided above, use them to provide an accurate, up-to-date answer.
                    - Keep your response easy to understand, concise, and helpful.
                    - Avoid unnecessary corporate jargon, heavy research lectures, or filler words.
                """)

            accumulated_text = ""
            start_time = time.time()

            try:
                async for token in self.planner_agent.llm_client.stream_text(prompt, effort_level="low"):
                    accumulated_text += token
                    yield f"data: {json.dumps({'type': 'chat_token', 'token': token})}\n\n"
            except Exception as e:
                logger.error(f"Chat streaming error: {e}")
                fallback_ans = f"I encountered a temporary issue while generating the response. Please try again.\n\n> {str(e)[:200]}"
                accumulated_text = fallback_ans
                yield f"data: {json.dumps({'type': 'chat_token', 'token': fallback_ans})}\n\n"

            if not accumulated_text.strip():
                accumulated_text = "Hello! How can I help you today?"
                yield f"data: {json.dumps({'type': 'chat_token', 'token': accumulated_text})}\n\n"

            duration = round(time.time() - start_time, 1)

            # Create Chat Turn Record
            chat_turn = {
                "query": clean_query,
                "effort_level": "chat",
                "is_chat": True,
                "plan": None,
                "findings": [{
                    "subtask_id": "chat_search",
                    "sources": [s["url"] for s in chat_sources],
                    "rich_sources": chat_sources
                }] if chat_sources else [],
                "verifications": [],
                "report": {
                    "title": clean_query,
                    "summary": accumulated_text[:250],
                    "markdown_content": accumulated_text,
                    "duration_seconds": duration,
                    "sources": chat_sources,
                    "is_chat": True
                },
                "duration_seconds": duration
            }

            all_turns = existing_turns + [chat_turn]

            # Persist Chat Turn in DB (non-blocking, errors are logged but don't break the response)
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ResearchSession).where(ResearchSession.id == effective_session_id))
                    s = result.scalars().first()
                    if s:
                        s.status = "completed"
                        s.report_data = {
                            "markdown_content": accumulated_text,
                            "summary": accumulated_text[:250],
                            "turns": all_turns,
                            "is_chat": True
                        }
                        s.updated_at = datetime.now(timezone.utc)
                    else:
                        s = ResearchSession(
                            id=effective_session_id,
                            user_id=user_id,
                            tenant_id=tenant_id,
                            query=clean_query,
                            effort_level="chat",
                            status="completed",
                            report_data={
                                "markdown_content": accumulated_text,
                                "summary": accumulated_text[:250],
                                "turns": all_turns,
                                "is_chat": True
                            }
                        )
                        db.add(s)
                    await db.commit()
            except Exception as e:
                logger.error(f"Failed to persist chat turn in DB: {e}")

            yield f"data: {json.dumps({'type': 'chat_done', 'turn': chat_turn, 'turns': all_turns, 'id': effective_session_id})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'id': effective_session_id, 'turns': all_turns})}\n\n"

        except Exception as top_err:
            logger.error(f"Top-level chat pipeline error: {top_err}")
            # Even on top-level errors, try to emit a meaningful response
            fallback_text = f"I apologize, but something went wrong while processing your request.\n\n> **Error:** {str(top_err)[:300]}\n\nPlease try again."
            yield f"data: {json.dumps({'type': 'chat_token', 'token': fallback_text})}\n\n"
            fallback_turn = {
                "query": clean_query,
                "effort_level": "chat",
                "is_chat": True,
                "plan": None, "findings": [], "verifications": [],
                "report": {"title": clean_query, "summary": fallback_text[:250], "markdown_content": fallback_text, "is_chat": True},
            }
            fallback_turns = existing_turns + [fallback_turn]
            yield f"data: {json.dumps({'type': 'chat_done', 'turn': fallback_turn, 'turns': fallback_turns, 'id': effective_session_id})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'id': effective_session_id, 'turns': fallback_turns})}\n\n"

    async def delete_history(self, session_id: str, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> dict:
        try:
            # Cancel active background job if running
            if session_id in self.active_jobs:
                job = self.active_jobs.pop(session_id)
                if job.task and not job.task.done():
                    job.task.cancel()

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ResearchSession).where(ResearchSession.id == session_id))
                session = result.scalars().first()
                if session:
                    # Authorization check: allow if unowned or belongs to user/tenant
                    if user_id and session.user_id and session.user_id != user_id and session.tenant_id != tenant_id:
                        return {"success": False, "message": "Unauthorized to delete this session."}
                    await db.delete(session)
                    await db.commit()
                    return {"success": True, "message": "Research session successfully deleted."}
                return {"success": False, "message": "Session not found", "not_found": True}
        except Exception as e:
            logger.error(f"Error deleting session {session_id} from database: {e}")
            return {"success": False, "message": str(e)}

# Canonical singleton instance
research_service = ResearchService()

