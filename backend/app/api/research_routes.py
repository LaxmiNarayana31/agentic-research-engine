from datetime import datetime
import re
from typing import Optional
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from app.helpers.auth_helper import get_optional_user
from app.core.errors import AppException
from app.core.logging import logger
from app.dtos.api_dto import ErrorResponse, ResearchPipelineRequest, ResearchPipelineResponse
from app.models.user import User
from app.services.pdf_export_service import pdf_export_service
from app.services.rate_limiter import rate_limit_guard
from app.services.research_service import research_service

router = APIRouter()

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

@router.get("/suggestions", tags=["Orchestration"])
async def get_research_suggestions():
    """Fast dynamic suggestion generation via single LLM call."""
    try:
        return await research_service.get_suggestions()
    except Exception as e:
        logger.error(f"Error generating suggestions: {e}")
        return {"suggestions": []}

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

@router.post("", response_model=ResearchPipelineResponse, tags=["Orchestration"], responses={400: {"model": ErrorResponse}})
async def run_research_pipeline(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user)
):
    """Execute end-to-end multi-agent pipeline with user scoping and rate limit protection."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        return await research_service.run_pipeline_sync(req.query, req.effort_level, req.previous_session_id, user_id=user_id)
    except ValueError as e:
        raise AppException(code="INVALID_QUERY", message=str(e), status_code=400)
    except Exception as e:
        logger.error(f"Sync pipeline failed: {e}")
        raise AppException(code="INTERNAL_ERROR", message=f"Pipeline failed: {e}", status_code=500)

@router.post("/stream", tags=["Orchestration"])
async def stream_research_pipeline(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user)
):
    """Execute multi-agent pipeline or fast conversational chat in background and stream results live using SSE."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        
        # Check if chat mode is requested or if query is a casual greeting
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
                    user_id=user_id
                ),
                media_type="text/event-stream"
            )

        return StreamingResponse(
            research_service.stream_pipeline(
                req.query, 
                req.effort_level, 
                req.previous_session_id, 
                req.session_id,
                user_id=user_id
            ), 
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to start SSE stream: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)

@router.post("/chat/stream", tags=["Orchestration"])
async def stream_chat_endpoint(
    req: ResearchPipelineRequest,
    request: Request,
    response: Response,
    user: Optional[User] = Depends(get_optional_user)
):
    """Direct fast streaming chat endpoint against research dossiers."""
    await rate_limit_guard(request, response, user)
    try:
        user_id = user.id if user else None
        return StreamingResponse(
            research_service.stream_chat_pipeline(
                req.query,
                previous_session_id=req.previous_session_id,
                session_id=req.session_id,
                user_id=user_id
            ),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to start chat stream: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)

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

@router.post("/{session_id}/cancel", tags=["Orchestration"])
async def cancel_research_session(
    session_id: str,
    user: Optional[User] = Depends(get_optional_user)
):
    """Cancel an active or pending background research job."""
    try:
        user_id = user.id if user else None
        res = await research_service.cancel_job(session_id, user_id=user_id)
        if not res.get("success"):
            if "unauthorized" in res.get("message", "").lower():
                raise AppException(code="FORBIDDEN", message=res.get("message"), status_code=403)
        return res
    except AppException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling session {session_id}: {e}")
        raise AppException(code="CANCEL_ERROR", message=str(e), status_code=500)

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
        data = await research_service.get_session_by_id(session_id, user_id=user_id)
        session = data.get("session")
        if not session:
            raise AppException(code="NOT_FOUND", message="Session not found or access denied.", status_code=404)

        # Extract target turn or latest turn
        turns = session.get("turns") or []
        target_turn = None
        if turn_idx is not None and 0 <= turn_idx < len(turns):
            target_turn = turns[turn_idx]
        elif turns:
            target_turn = turns[-1]
        else:
            target_turn = {
                "query": session.get("query"),
                "effort_level": session.get("effort_level", "medium"),
                "report": session.get("report") or {},
                "findings": session.get("findings") or [],
            }

        report_data = target_turn.get("report") or {}
        markdown_content = report_data.get("markdown_content") or ""
        if not markdown_content:
            markdown_content = f"# {target_turn.get('query', 'Research Report')}\n\n*No dossier report text available for this session.*"

        title = report_data.get("title") or target_turn.get("query") or "Research Dossier"
        query = target_turn.get("query") or session.get("query") or "Research"
        effort_level = target_turn.get("effort_level") or session.get("effort_level") or "medium"

        # Aggregate sources from turn findings and report
        sources = []
        seen_urls = set()
        for f in target_turn.get("findings") or []:
            if isinstance(f, dict):
                for s in f.get("sources") or []:
                    url = s.get("url") if isinstance(s, dict) else s
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        sources.append(s if isinstance(s, dict) else {"url": url, "title": url})

        created_at_str = session.get("created_at")
        date_str = None
        if created_at_str:
            try:
                dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                date_str = dt.strftime("%B %d, %Y")
            except Exception:
                date_str = None

        pdf_bytes = pdf_export_service.generate_dossier_pdf(
            title=title,
            query=query,
            markdown_content=markdown_content,
            sources=sources,
            effort_level=effort_level,
            date_str=date_str
        )

        safe_filename = re.sub(r"[^a-zA-Z0-9_\-]", "_", query[:40]).strip("_") or "research_dossier"
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
