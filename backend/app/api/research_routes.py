import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppException
from app.core.logging import logger
from app.db.database import get_db
from app.dtos.api_dto import ErrorResponse, ResearchPipelineRequest, ResearchPipelineResponse
from app.helpers.auth_helper import get_optional_user, get_user_tenant_id
from app.helpers.rate_limiter_helper import rate_limit_guard
from app.models.user import User
from app.services.research_service import research_service

router = APIRouter()


# Route 1: GET /api/research/history
@router.get("/history", tags=["Orchestration"])
async def get_research_history(
    user: Optional[User] = Depends(get_optional_user)
):
    """Retrieve past research sessions scoped to authenticated user/workspace or guest sessions."""
    try:
        user_id = user.id if user else None
        return await research_service.get_history(user_id=user_id)
    except Exception as e:
        logger.error(f"Error fetching research history: {e}")
        return {"history": []}


# Route 2: POST /api/research/history/claim
@router.post("/history/claim", tags=["Orchestration"])
async def claim_research_history(
    payload: dict,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Claim and migrate guest sessions into the authenticated user's workspace."""
    if not user:
        return {"success": False, "message": "Authentication required to claim sessions.", "claimed_count": 0}
    session_ids = payload.get("session_ids", [])
    tenant_id = await get_user_tenant_id(user, db)
    return await research_service.claim_sessions(session_ids, user.id, tenant_id=tenant_id)


# Route 3: GET /api/research/evals/benchmark
@router.get("/evals/benchmark", tags=["Evaluation"])
async def trigger_eval_benchmark(limit: int = 5):
    """Execute quantitative Ragas benchmark evaluation suite across golden test dataset."""
    try:
        return await research_service.trigger_eval_benchmark(limit=limit)
    except Exception as e:
        logger.error(f"Error running benchmark evals: {e}")
        raise AppException(code="EVAL_ERROR", message=f"Failed to execute evaluation suite: {e}", status_code=500)


# Route 4: GET /api/research/evals/latest
@router.get("/evals/latest", tags=["Evaluation"])
async def get_latest_eval_report():
    """Retrieve the latest cached Ragas evaluation scorecard."""
    return await research_service.get_latest_eval_report()


# Route 5: GET /api/research/evals/report
@router.get("/evals/report", tags=["Evaluation"], response_class=HTMLResponse)
async def get_eval_html_report():
    """Serve the standalone visual Ragas quality scorecard dashboard in HTML."""
    content = await research_service.get_eval_html_report()
    return HTMLResponse(content=content)


# Route 6: GET /api/research/suggestions
@router.get("/suggestions", tags=["Orchestration"])
async def get_research_suggestions():
    """Fast dynamic suggestion generation via single LLM call."""
    try:
        return await research_service.get_suggestions()
    except Exception as e:
        logger.error(f"Error generating suggestions: {e}")
        return {"suggestions": []}


# Route 7: GET /api/research/history/{session_id}
@router.get("/history/{session_id}", tags=["Orchestration"])
async def get_single_research_session(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user)
):
    """Retrieve a single past research session by UUID with multi-tenant access verification."""
    try:
        user_id = user.id if user else None
        data = await research_service.get_session_by_id(session_id, user_id=user_id)
        if not data.get("session"):
            raise AppException(code="NOT_FOUND", message="Session not found or access denied.", status_code=404)
        return data
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error fetching session {session_id}: {e}")
        raise AppException(code="FETCH_ERROR", message=str(e), status_code=500)


# Route 8: DELETE /api/research/history/{session_id}
@router.delete("/history/{session_id}", tags=["Orchestration"])
async def delete_research_history(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user)
):
    """Delete a past research session with owner authorization check."""
    try:
        user_id = user.id if user else None
        res = await research_service.delete_history(session_id, user_id=user_id)
        if not res.get("success"):
            if res.get("not_found"):
                raise AppException(code="NOT_FOUND", message="Research session not found.", status_code=404)
            if "unauthorized" in res.get("message", "").lower():
                raise AppException(code="FORBIDDEN", message="You do not have permission to delete this session.", status_code=403)
            raise AppException(code="DELETE_FAILED", message=res.get("message", "Unable to delete session."), status_code=400)
        return {"success": True, "message": res.get("message", "Research session successfully deleted.")}
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error deleting session {session_id}: {e}")
        raise AppException(code="DELETE_ERROR", message=str(e), status_code=500)


# Route 9: POST /api/research/planner
@router.post("/planner", tags=["Planner"], responses={400: {"model": ErrorResponse}})
async def create_research_plan(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user)
):
    """Decompose research query into validated sub-tasks with rate limiting."""
    await rate_limit_guard(request, response, user)
    try:
        plan = await research_service.create_plan(req.query, req.effort_level, req.previous_session_id)
        if not plan.is_valid:
            raise AppException(code="INVALID_QUERY", message=plan.validation_notes, status_code=400)
        return plan
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error creating research plan: {e}")
        raise AppException(code="PLANNER_ERROR", message=f"Failed to generate plan: {e}", status_code=500)


# Route 10: POST /api/research
@router.post("", response_model=ResearchPipelineResponse, tags=["Orchestration"], responses={400: {"model": ErrorResponse}})
async def run_research_pipeline(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Execute end-to-end multi-agent pipeline with user scoping and rate limit protection."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        tenant_id = await get_user_tenant_id(user, db)
        return await research_service.run_pipeline_sync(req.query, req.effort_level, req.previous_session_id, user_id=user_id, tenant_id=tenant_id)
    except ValueError as e:
        raise AppException(code="INVALID_QUERY", message=str(e), status_code=400)
    except Exception as e:
        logger.error(f"Sync pipeline failed: {e}")
        raise AppException(code="INTERNAL_ERROR", message=f"Pipeline failed: {e}", status_code=500)


# Route 11: POST /api/research/stream
@router.post("/stream", tags=["Orchestration"])
async def stream_research_pipeline(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Execute multi-agent pipeline or fast conversational chat in background and stream results live using SSE."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        tenant_id = await get_user_tenant_id(user, db)

        q_clean = req.query.strip().lower()
        is_greeting = q_clean in [
            "hi", "hello", "hey", "hello!", "hi!", "hey!", "hola",
            "greetings", "good morning", "good afternoon", "good evening",
            "how are you", "how are you?", "who are you", "who are you?"
        ]
        is_chat_mode = (
            req.mode == "chat" or
            req.effort_level == "chat" or
            q_clean.startswith("/chat") or
            is_greeting
        )

        if is_chat_mode:
            return StreamingResponse(
                research_service.stream_chat_pipeline(
                    req.query,
                    previous_session_id=req.previous_session_id,
                    session_id=req.session_id,
                    user_id=user_id,
                    tenant_id=tenant_id
                ),
                media_type="text/event-stream"
            )

        return StreamingResponse(
            research_service.stream_pipeline(
                req.query,
                req.effort_level,
                req.previous_session_id,
                req.session_id,
                user_id=user_id,
                tenant_id=tenant_id
            ),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to start SSE stream: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)


# Route 12: POST /api/research/chat/stream
@router.post("/chat/stream", tags=["Orchestration"])
async def stream_chat_endpoint(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Direct fast streaming chat endpoint against research dossiers."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        tenant_id = await get_user_tenant_id(user, db)
        return StreamingResponse(
            research_service.stream_chat_pipeline(
                req.query,
                previous_session_id=req.previous_session_id,
                session_id=req.session_id,
                user_id=user_id,
                tenant_id=tenant_id
            ),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to start chat stream: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)


# Route 13: POST /api/research/queue
@router.post("/queue", tags=["Orchestration"])
async def enqueue_research_job(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Enqueue a research job to the distributed ARQ background worker queue and return subscription stream metadata."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        tenant_id = await get_user_tenant_id(user, db)
        return await research_service.enqueue_job(
            req.query,
            effort_level=req.effort_level,
            previous_session_id=req.previous_session_id,
            session_id=req.session_id,
            user_id=user_id,
            tenant_id=tenant_id
        )
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Failed to enqueue research job: {e}")
        raise AppException(code="QUEUE_ERROR", message=str(e), status_code=500)


# Route 14: GET /api/research/stream/{session_id}/subscribe
@router.get("/stream/{session_id}/subscribe", tags=["Orchestration"])
async def subscribe_research_stream(
    session_id: str,
    request: Request,
    last_event_id: Optional[int] = None,
    user: Optional[User] = Depends(get_optional_user)
):
    """Subscribe or reconnect to an active or past research session stream with Last-Event-ID resumption."""
    try:
        user_id = user.id if user else None
        header_eid = request.headers.get("Last-Event-ID")
        effective_eid = last_event_id
        if effective_eid is None and header_eid:
            try:
                effective_eid = int(header_eid.strip())
            except ValueError:
                pass

        return StreamingResponse(
            research_service.subscribe_session_stream(
                session_id,
                user_id=user_id,
                last_event_id=effective_eid
            ),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to subscribe to stream for {session_id}: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)


# Route 15: POST /api/research/{session_id}/cancel
@router.post("/{session_id}/cancel", tags=["Orchestration"])
async def cancel_research_session(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db)
):
    """Cancel an active or pending background research job."""
    try:
        user_id = user.id if user else None
        tenant_id = await get_user_tenant_id(user, db)
        res = await research_service.cancel_job(session_id, user_id=user_id, tenant_id=tenant_id)
        if not res.get("success"):
            if "unauthorized" in res.get("message", "").lower():
                raise AppException(code="FORBIDDEN", message=res.get("message"), status_code=403)
        return res
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling session {session_id}: {e}")
        raise AppException(code="CANCEL_ERROR", message=str(e), status_code=500)


# Route 16: GET /api/research/{session_id}/export/pdf and /api/research/history/{session_id}/export/pdf
@router.get("/{session_id}/export/pdf", tags=["Export"])
@router.get("/history/{session_id}/export/pdf", tags=["Export"])
async def export_research_session_pdf(
    session_id: str,
    turn_idx: Optional[int] = None,
    user: Optional[User] = Depends(get_optional_user)
):
    """Generate and stream a professional vector PDF representation of a research dossier."""
    try:
        user_id = user.id if user else None
        pdf_bytes = await research_service.export_session_to_pdf(session_id, turn_idx=turn_idx, user_id=user_id)
        safe_filename = re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id[:30]).strip("_") or "research_dossier"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}.pdf"',
                "Content-Type": "application/pdf"
            }
        )
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error generating PDF for session {session_id}: {e}")
        raise AppException(code="PDF_EXPORT_ERROR", message=f"Failed to generate PDF: {e}", status_code=500)
