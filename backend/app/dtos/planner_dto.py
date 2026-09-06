from typing import List, Optional
from pydantic import BaseModel, Field

class PlannerSubTask(BaseModel):
    task_id: str
    description: str
    required_tools: List[str]
    estimated_priority: int = 1
    search_depth: str = "basic"
    max_results: int = 3

class ReportSectionSpec(BaseModel):
    """Specification for a dynamically planned report section."""
    section_title: str
    focus_description: str
    requires_table: bool = False
    requires_timeline: bool = False

class PlannerOutput(BaseModel):
    research_query: str
    sub_tasks: List[PlannerSubTask]
    report_outline: List[ReportSectionSpec] = Field(default_factory=list)
    total_tasks: int
    is_valid: bool = True
    validation_notes: str = ""
    used_model: str = "rule-based"
