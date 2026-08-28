from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.errors import AppException
from app.core.logging import logger
from app.dtos.api_dto import ErrorResponse, ResearchPipelineRequest, ResearchPipelineResponse
from app.services.research_service import ResearchService

router = APIRouter()
research_service = ResearchService()

@router.get("/history", tags=["Orchestration"])
async def get_research_history():
    """Retrieve past research sessions."""
    try:
        return await research_service.get_history()
    except Exception as e:
        logger.error(f"Error fetching research history: {e}")
        return {"history": []}

@router.delete("/history/{session_id}", tags=["Orchestration"])
async def delete_research_history(session_id: str):
    """Delete a past research session."""
    try:
        return await research_service.delete_history(session_id)
    except Exception as e:
        logger.error(f"Error deleting session {session_id}: {e}")
        raise AppException(code="DELETE_ERROR", message=str(e), status_code=500)

@router.post("/planner", tags=["Planner"], responses={400: {"model": ErrorResponse}})
async def create_research_plan(req: ResearchPipelineRequest):
    """Decompose research query into validated sub-tasks."""
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
async def run_research_pipeline(req: ResearchPipelineRequest):
    """Execute end-to-end multi-agent pipeline."""
    try:
        return await research_service.run_pipeline_sync(req.query, req.effort_level, req.previous_session_id)
    except ValueError as e:
        raise AppException(code="INVALID_QUERY", message=str(e), status_code=400)
    except Exception as e:
        logger.error(f"Sync pipeline failed: {e}")
        raise AppException(code="INTERNAL_ERROR", message=f"Pipeline failed: {e}", status_code=500)

@router.post("/stream", tags=["Orchestration"])
async def stream_research_pipeline(req: ResearchPipelineRequest):
    """Execute multi-agent pipeline and stream results live using SSE."""
    try:
        return StreamingResponse(
            research_service.stream_pipeline(req.query, req.effort_level, req.previous_session_id), 
            media_type="text/event-stream"
        )
    except Exception as e:
        logger.error(f"Failed to start SSE stream: {e}")
        raise AppException(code="STREAM_ERROR", message=str(e), status_code=500)

# trigger reload
