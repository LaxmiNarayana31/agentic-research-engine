import textwrap
import uuid
from typing import List, Optional

from app.clients.llm_client import MultiModelLLMClient
from app.core.logging import logger
from app.dtos.planner_dto import PlannerOutput, PlannerSubTask, ReportSectionSpec

class PlannerAgent:
    """Planner Agent autonomously producing query-tailored sub-task breakdown and dynamic report outline via LLM."""

    def __init__(self, max_tasks: Optional[int] = None):
        self.max_tasks = max_tasks
        self.llm_client = MultiModelLLMClient(agent_role='planner')

    def _generate_fallback_outline(self, query: str, effort_level: str = "medium") -> List[ReportSectionSpec]:
        """Generates dynamic topic-relevant outline fallback when LLM outline is omitted."""
        if effort_level == "low":
            return [
                ReportSectionSpec(
                    section_title="Executive Briefing & Key Insights",
                    focus_description=f"Synthesize the core bottom-line conclusions and key facts for {query}."
                ),
                ReportSectionSpec(
                    section_title="Detailed Findings & Analysis",
                    focus_description=f"Directly analyze the evidence, metrics, and primary findings regarding {query}."
                )
            ]
        elif effort_level == "high":
            return [
                ReportSectionSpec(
                    section_title="Executive Summary & Strategic Verdict",
                    focus_description=f"Comprehensive overview of primary findings, confidence rating, and bottom-line verdict for {query}."
                ),
                ReportSectionSpec(
                    section_title="Architectural & Domain Deep Dive",
                    focus_description=f"In-depth technical, architectural, or foundational breakdown for {query}."
                ),
                ReportSectionSpec(
                    section_title="Quantitative Metrics & Comparative Matrix",
                    focus_description=f"Comparative analysis with structured Markdown comparison table for {query}.",
                    requires_table=True
                ),
                ReportSectionSpec(
                    section_title="Key Milestones & Chronological Progression",
                    focus_description=f"Historical or developmental timeline and regulatory milestones for {query}.",
                    requires_timeline=True
                ),
                ReportSectionSpec(
                    section_title="Debates, Discrepancies & Counter-Arguments",
                    focus_description=f"Critical analysis of where experts, industry data, or jurisdictions diverge for {query}."
                ),
                ReportSectionSpec(
                    section_title="Strategic Trajectory & Future Outlook",
                    focus_description=f"Predictive forecast, upcoming risks, and long-term implications for {query}."
                )
            ]
        else:
            return [
                ReportSectionSpec(
                    section_title="Executive Summary & Key Takeaways",
                    focus_description=f"High-impact synthesis of top findings for {query}."
                ),
                ReportSectionSpec(
                    section_title="Comprehensive Domain Analysis",
                    focus_description=f"Detailed thematic evaluation of all core subtasks regarding {query}."
                ),
                ReportSectionSpec(
                    section_title="Comparative Metrics & Evaluation Matrix",
                    focus_description=f"Structured Markdown comparison table covering key entities, specifications, or benchmarks.",
                    requires_table=True
                ),
                ReportSectionSpec(
                    section_title="Nuances, Risks & Strategic Outlook",
                    focus_description=f"Caveats, limitations, and future outlook for {query}."
                )
            ]

    async def generate_plan(self, research_query: str, effort_level: str = "medium", conversation_history: Optional[List[dict]] = None) -> PlannerOutput:
        """Autonomously decomposes research query into as many subtasks and dynamic report sections as the LLM determines necessary."""
        try:
            query = research_query.strip() if research_query else ""
            if len(query) < 5:
                return PlannerOutput(
                    research_query=research_query,
                    sub_tasks=[],
                    report_outline=[],
                    total_tasks=0,
                    is_valid=False,
                    validation_notes="Research query is too short or ambiguous."
                )

            history_context_str = ""
            if conversation_history and isinstance(conversation_history, list) and len(conversation_history) > 0:
                history_lines = []
                for idx, t in enumerate(conversation_history[-3:]):
                    t_query = t.get("query") or ""
                    t_rep = t.get("report") or {}
                    t_summary = t_rep.get("summary") or (t_rep.get("markdown_content", "")[:200] + "...")
                    if t_query:
                        history_lines.append(f"- Turn {idx + 1}: Query: \"{t_query}\"\n  Summary: {t_summary.strip()}")
                if history_lines:
                    history_context_str = f"""
                    PREVIOUS CONVERSATION TURNS IN THIS SESSION:
                    {chr(10).join(history_lines)}
                    
                    NOTE: The user is asking a follow-up query in this ongoing session.
                    Decompose search subtasks specifically for the follow-up angle without redundantly re-searching general fundamentals already covered.
                    """

            if effort_level == "low":
                effort_instructions = """
                EFFORT LEVEL: LOW (Focused & Rapid)
                - Focus on directly resolving the core inquiry with the precise, focused sub-tasks needed.
                - Search depth: standard/basic.
                - Autonomously decide the exact number of sub-tasks and outline sections necessary to answer the prompt directly.
                """
            elif effort_level == "high":
                effort_instructions = """
                EFFORT LEVEL: HIGH (Exhaustive & Multi-Dimensional)
                - Conduct an exhaustive, multi-perspective deep investigation.
                - Search depth: advanced.
                - Autonomously decompose the query into all necessary deep-dive sub-tasks (technical mechanisms, empirical data, regulatory frameworks, economics/tokenomics, critical debates, future trajectory).
                - Autonomously determine the complete, domain-accurate outline sections needed for an institutional-grade research dossier.
                """
            else:
                effort_instructions = """
                EFFORT LEVEL: MEDIUM (Comprehensive & Balanced)
                - Perform a thorough investigation covering all main aspects, evidence, and comparisons.
                - Search depth: advanced or basic depending on topic complexity.
                - Autonomously determine the optimal number of sub-tasks and outline sections for full coverage.
                """

            prompt = textwrap.dedent(f"""\
                You are an expert Autonomous Research Task Planner and Research Architect.
                Analyze the research query, evaluate its complexity, and autonomously determine:
                1. Exactly how many and which distinct search sub-tasks are needed for web research agents to gather complete intelligence.
                2. A dynamic, domain-accurate Report Outline tailored specifically to the subject matter of the query (NO generic placeholder headings).
                
                Query: "{query}"
                {history_context_str}
                Available tools for subtasks: ["tavily_search", "verification_engine"]
                
                {effort_instructions}

                Return ONLY a valid JSON object matching this schema:
                {{
                  "sub_tasks": [
                    {{
                      "task_id": "subtask_1",
                      "description": "Clear actionable research objective",
                      "required_tools": ["tavily_search"],
                      "estimated_priority": 1,
                      "search_depth": "advanced",
                      "max_results": 5
                    }}
                  ],
                  "report_outline": [
                    {{
                      "section_title": "Domain-Specific Section Header (e.g., Layer-1 Sharding vs Subnet Economics)",
                      "focus_description": "Detailed prompt instruction for the writer on what this section must cover",
                      "requires_table": false,
                      "requires_timeline": false
                    }}
                  ]
                }}
                JSON Response:""")

            try:
                data, used_model = await self.llm_client.complete_json(prompt, effort_level)
                sub_tasks = []
                for idx, t in enumerate(data.get("sub_tasks", [])):
                    if self.max_tasks and idx >= self.max_tasks:
                        break
                    tid = str(t.get("task_id") or f"subtask_{uuid.uuid4().hex[:8]}").strip()
                    desc = str(t.get("description") or f"Investigate {query}").strip()
                    tools = t.get("required_tools") if isinstance(t.get("required_tools"), list) else ["tavily_search"]
                    sub_tasks.append(PlannerSubTask(
                        task_id=tid,
                        description=desc,
                        required_tools=tools,
                        estimated_priority=int(t.get("estimated_priority", idx + 1)),
                        search_depth=str(t.get("search_depth", "advanced" if effort_level == "high" else "basic")),
                        max_results=int(t.get("max_results", 5))
                    ))
                if not sub_tasks:
                    raise ValueError("LLM returned empty subtasks list")

                # Parse dynamic report outline
                raw_outline = data.get("report_outline", [])
                report_outline = []
                if isinstance(raw_outline, list) and raw_outline:
                    for s in raw_outline:
                        if isinstance(s, dict) and s.get("section_title"):
                            report_outline.append(ReportSectionSpec(
                                section_title=str(s.get("section_title")).strip(),
                                focus_description=str(s.get("focus_description", "")).strip(),
                                requires_table=bool(s.get("requires_table", False)),
                                requires_timeline=bool(s.get("requires_timeline", False))
                            ))
                if not report_outline:
                    report_outline = self._generate_fallback_outline(query, effort_level)

            except Exception as e:
                logger.warning(f"PlannerAgent LLM dynamic decomposition note: {e}")
                sub_tasks = [
                    PlannerSubTask(
                        task_id=f"subtask_{uuid.uuid4().hex[:8]}",
                        description=f"Examine foundational context, evidence, and recent data for: {query}",
                        required_tools=["tavily_search"],
                        estimated_priority=1,
                        search_depth="advanced" if effort_level == "high" else "basic",
                        max_results=5
                    ),
                    PlannerSubTask(
                        task_id=f"subtask_{uuid.uuid4().hex[:8]}",
                        description=f"Analyze detailed metrics, methodologies, and cross-sector impact of: {query}",
                        required_tools=["tavily_search"],
                        estimated_priority=2,
                        search_depth="advanced" if effort_level == "high" else "basic",
                        max_results=5
                    )
                ]
                report_outline = self._generate_fallback_outline(query, effort_level)
                used_model = "dynamic-planner-fallback"
                
            return PlannerOutput(
                research_query=query,
                sub_tasks=sub_tasks,
                report_outline=report_outline,
                total_tasks=len(sub_tasks),
                is_valid=True,
                validation_notes=f"Successfully generated {len(sub_tasks)} sub-tasks and {len(report_outline)} dynamic sections via {used_model}.",
                used_model=used_model
            )
        except Exception as top_err:
            logger.error(f"Top-level exception in PlannerAgent.generate_plan: {top_err}")
            fallback_subtasks = [
                PlannerSubTask(
                    task_id=f"subtask_{uuid.uuid4().hex[:8]}",
                    description=f"Examine core findings and domain analysis for: {research_query}",
                    required_tools=["tavily_search"],
                    estimated_priority=1,
                    search_depth="basic",
                    max_results=5
                )
            ]
            fallback_outline = self._generate_fallback_outline(research_query, effort_level)
            return PlannerOutput(
                research_query=research_query,
                sub_tasks=fallback_subtasks,
                report_outline=fallback_outline,
                total_tasks=len(fallback_subtasks),
                is_valid=True,
                validation_notes="Generated plan via fallback handler.",
                used_model="dynamic-fallback"
            )
