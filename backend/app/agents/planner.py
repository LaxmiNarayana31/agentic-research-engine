import json
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from app.clients.router_client import RealRouterClient
from app.core.logging import logger

class PlannerSubTask(BaseModel):
    task_id: str
    description: str
    required_tools: List[str]
    estimated_priority: int = 1

class PlannerOutput(BaseModel):
    research_query: str
    sub_tasks: List[PlannerSubTask]
    total_tasks: int
    is_valid: bool = True
    validation_notes: str = ""
    used_model: str = "rule-based"

class PlannerAgent:
    """Planner Agent producing structured sub-task breakdown for research team via LLM with fallback."""

    def __init__(self, max_tasks: int = 5, router_client: Optional[RealRouterClient] = None):
        self.max_tasks = max_tasks
        self.router_client = router_client or RealRouterClient()

    async def generate_plan(self, research_query: str) -> PlannerOutput:
        query = research_query.strip()
        if len(query) < 5:
            return PlannerOutput(
                research_query=research_query,
                sub_tasks=[],
                total_tasks=0,
                is_valid=False,
                validation_notes="Research query is too short or ambiguous."
            )

        prompt = f"""You are an expert Research Task Planner. Decompose the following research query into 2 to {self.max_tasks} distinct, focused sub-tasks.
Query: "{query}"

Available tools for subtasks: ["tavily_search", "mcp_postgres_read", "verification_engine"]

Return ONLY a valid JSON object matching this exact schema:
{{
  "sub_tasks": [
    {{
      "task_id": "task_1",
      "description": "Scoping and core concept analysis",
      "required_tools": ["tavily_search"],
      "estimated_priority": 1
    }}
  ]
}}
JSON Response:"""

        used_model = "rule-based"
        try:
            res = await self.router_client.complete(prompt)
            raw_text = res.get("response", "")
            used_model = res.get("model", "llama-3.3-70b-versatile")
            
            match = re.search(r'\{.*\}', raw_text, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
                sub_tasks = []
                for idx, t in enumerate(data.get("sub_tasks", [])):
                    if idx >= self.max_tasks:
                        break
                    sub_tasks.append(PlannerSubTask(
                        task_id=t.get("task_id", f"task_{idx+1}"),
                        description=t.get("description", f"Research step {idx+1} for: {query}"),
                        required_tools=t.get("required_tools", ["tavily_search"]),
                        estimated_priority=t.get("estimated_priority", idx+1)
                    ))
                if sub_tasks:
                    return PlannerOutput(
                        research_query=query,
                        sub_tasks=sub_tasks,
                        total_tasks=len(sub_tasks),
                        is_valid=True,
                        validation_notes=f"LLM successfully decomposed query into {len(sub_tasks)} sub-tasks.",
                        used_model=used_model
                    )
        except Exception as e:
            logger.warning(f"PlannerAgent LLM decomposition failed: {e}. Executing rule-based fallback.")

        # Deterministic fallback logic
        raw_tasks = [
            PlannerSubTask(
                task_id="task_1",
                description=f"Initial research & concept scoping for: {query}",
                required_tools=["tavily_search"],
                estimated_priority=1
            ),
            PlannerSubTask(
                task_id="task_2",
                description=f"Query internal database records regarding: {query}",
                required_tools=["mcp_postgres_read"],
                estimated_priority=2
            ),
            PlannerSubTask(
                task_id="task_3",
                description=f"Cross-verify claims and technical details for: {query}",
                required_tools=["tavily_search", "verification_engine"],
                estimated_priority=3
            )
        ]

        # Deduplicate & cap task count
        unique_tasks = []
        seen_descriptions = set()
        for t in raw_tasks:
            if t.description not in seen_descriptions:
                seen_descriptions.add(t.description)
                unique_tasks.append(t)
            if len(unique_tasks) >= self.max_tasks:
                break

        return PlannerOutput(
            research_query=query,
            sub_tasks=unique_tasks,
            total_tasks=len(unique_tasks),
            is_valid=True,
            validation_notes=f"Structured {len(unique_tasks)} sub-tasks via fallback.",
            used_model=used_model
        )
