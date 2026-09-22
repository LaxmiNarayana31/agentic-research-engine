from typing import Optional
from pydantic import BaseModel, Field

class ClaimVerificationResult(BaseModel):
    claim: str
    is_supported: bool
    entailment_score: float = Field(..., ge=0.0, le=1.0)
    verifier_notes: str
    exact_quote: Optional[str] = Field(
        default=None,
        description="Verbatim quote from raw source data supporting the claim, or None if not found."
    )
