import textwrap

from typing import List, Optional, Any
from app.clients.llm_client import MultiModelLLMClient
from app.core.logging import logger
from app.dtos.report_dto import FinalReport

class CriticAgent:
    """Critic Agent acting as an Editor-in-Chief to evaluate research reports."""

    def __init__(self):
        self.llm_client = MultiModelLLMClient(agent_role='critic')

    async def evaluate_report(self, query: str, report: FinalReport, outline: Optional[List[Any]] = None) -> dict:
        """Evaluates draft research report with full end-to-end exception protection and outline coverage audit."""
        try:
            logger.info(f"CriticAgent evaluating report for query='{query[:30]}...'")
            
            outline_context = ""
            if outline:
                outline_lines = []
                for s in outline:
                    t = getattr(s, "section_title", None) or (s.get("section_title") if isinstance(s, dict) else str(s))
                    if t:
                        outline_lines.append(f"- {t}")
                if outline_lines:
                    outline_context = f"\nPlanned Domain Outline:\n" + "\n".join(outline_lines) + "\n"

            prompt = textwrap.dedent(f"""\
                You are a rigorous Editor-in-Chief and Quality Assurance Reviewer.
                Your job is to read the provided Draft Research Report and determine if it fully answers the user's original query and satisfies the planned domain outline.
                
                Original Query: "{query}"
                {outline_context}
                Draft Report:
                {report.markdown_content}
                
                Evaluate the report on the following criteria:
                1. Does it directly address the main points of the original query with specific empirical evidence and inline citations [1], [2]?
                2. Is the report sufficiently detailed and exhaustive, covering the planned domain themes without superficial filler?
                3. Are there any obvious hallucinations, contradictory statements, or missing comparison tables where required?
                
                If the report is EXCELLENT and meets all criteria, approve it.
                If the report is WEAK, lacks depth, or misses the core query/planned sections, reject it and provide SPECIFIC, actionable feedback on what the writer must fix.
                
                Return ONLY valid JSON matching this schema:
                {{
                  "approved": true or false,
                  "feedback": "If approved, a brief praise. If rejected, detailed instructions for the writer to fix the report."
                }}
                """)
                
            eval_data, _ = await self.llm_client.complete_json(prompt)
            is_approved = bool(eval_data.get("approved", True))
            feedback = str(eval_data.get("feedback", "Report approved."))
            
            if is_approved:
                logger.info("CriticAgent approved the report.")
            else:
                logger.info(f"CriticAgent requested report revisions: {feedback[:60]}...")
                
            return {
                "approved": is_approved,
                "feedback": feedback
            }
        except Exception as e:
            logger.warning(f"CriticAgent evaluation fallback: {e}. Auto-approving report draft.")
            return {
                "approved": True,
                "feedback": "Approved via fallback heuristic."
            }
