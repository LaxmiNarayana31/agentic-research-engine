from typing import Any, List, Optional

from pydantic import BaseModel, Field

from app.dtos.planner_dto import PlannerOutput
from app.dtos.report_dto import FinalReport
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult

class ErrorDetail(BaseModel):
    code: str
    message: str
    detail: Optional[Any] = None

class ErrorResponse(BaseModel):
    error: ErrorDetail

class ResearchPipelineRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=2000)
    effort_level: str = "medium"
    mode: Optional[str] = "research"  # "research" or "chat"
    previous_session_id: Optional[str] = None
    session_id: Optional[str] = None

class ResearchPipelineResponse(BaseModel):
    id: Optional[str] = None
    status: str
    query: str
    plan: PlannerOutput
    findings: List[ResearchFinding]
    verifications: List[ClaimVerificationResult]
    report: FinalReport
