import re
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

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
    effort_level: Literal["low", "medium", "high", "chat"] = "medium"
    mode: Optional[Literal["research", "chat"]] = "research"
    previous_session_id: Optional[str] = None
    session_id: Optional[str] = None

    @field_validator("query")
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        # Strip null bytes and non-printable control characters
        cleaned = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', v).strip()
        if len(cleaned) < 2:
            raise ValueError("Query contains insufficient printable characters after sanitization.")
        return cleaned

class ResearchPipelineResponse(BaseModel):
    id: Optional[str] = None
    status: str
    query: str
    plan: PlannerOutput
    findings: List[ResearchFinding]
    verifications: List[ClaimVerificationResult]
    report: FinalReport
    groundedness_score: Optional[float] = 0.0
    total_tokens: Optional[int] = 0
    estimated_cost_usd: Optional[float] = 0.0
