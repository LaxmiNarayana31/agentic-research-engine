from typing import Optional
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse

from app.helpers.auth_helper import get_optional_user
from app.core.errors import AppException
from app.core.logging import logger
from app.dtos.api_dto import ErrorResponse, ResearchPipelineRequest, ResearchPipelineResponse
from app.models.user import User
from app.services.rate_limiter import rate_limit_guard
from app.services.research_service import ResearchService

router = APIRouter()
research_service = ResearchService()

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
        
        # Check if chat mode is requested
        is_chat_mode = (
            req.mode == "chat" or 
            req.effort_level == "chat" or 
            req.query.strip().lower().startswith("/chat")
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
    user: Optional[User] = Depends(get_optional_user)
):
    """Subscribe or reconnect to an active or past research session stream."""
    try:
        user_id = user.id if user else None
        return StreamingResponse(
            research_service.subscribe_session_stream(session_id, user_id=user_id),
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to subscribe to stream for {session_id}: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)
