from typing import List, Dict, Any
from pydantic import BaseModel

class ResearchFinding(BaseModel):
    task_id: str
    summary: str
    sources: List[str]
    rich_sources: List[Dict[str, Any]] = []
    raw_data: Dict[str, Any]
    used_model: str
