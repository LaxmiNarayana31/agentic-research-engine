from typing import List, Dict
from pydantic import BaseModel

class FinalReport(BaseModel):
    title: str
    markdown_content: str
    citation_count: int
    bibliography: List[Dict[str, str]]
    verification_score: float
    used_model: str = "rule-based"
    related_questions: List[str] = []
    groundedness_score: float = 0.0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
