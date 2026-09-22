import logging
from typing import TypedDict, List, Optional, Any
from langgraph.graph import StateGraph, END

from app.agents.planner import PlannerAgent
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent
from app.agents.report_writer import ReportWriterAgent
from app.agents.critic import CriticAgent
from app.dtos.planner_dto import PlannerOutput
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult
from app.dtos.report_dto import FinalReport


logger = logging.getLogger(__name__)

def add_list(list1: List[Any], list2: List[Any]) -> List[Any]:
    return list2

class AgentState(TypedDict):
    query: str
    effort_level: str
    conversation_history: Optional[List[dict]]
    
    plan: Optional[PlannerOutput]
    findings: List[ResearchFinding]
    verifications: List[ClaimVerificationResult]
    report: Optional[FinalReport]
    
    critic_feedback: Optional[str]
    rewrite_count: int
    max_rewrites: int


async def planner_node(state: AgentState) -> dict:
    logger.info("Executing planner_node")
    planner = PlannerAgent()
    plan = await planner.generate_plan(
        state["query"],
        state["effort_level"],
        conversation_history=state.get("conversation_history")
    )
    if not plan.is_valid:
        raise ValueError(f"Invalid plan generated: {plan.validation_notes}")
    return {"plan": plan}


async def research_node(state: AgentState) -> dict:
    logger.info("Executing research_node")
    researcher = ResearchAgent()
    plan = state["plan"]
    
    findings = []
    import asyncio
    tasks = []
    for subtask in plan.sub_tasks:
        tasks.append(researcher.execute_subtask(subtask))
        
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for res in results:
        if isinstance(res, Exception):
            logger.error(f"Research subtask failed: {res}")
            continue
        findings.append(res)
        
    return {"findings": findings}


async def verify_node(state: AgentState) -> dict:
    logger.info("Executing verify_node")
    verifier = VerificationAgent()
    verifications = await verifier.verify_findings(state["findings"])
    return {"verifications": verifications}


async def write_node(state: AgentState) -> dict:
    logger.info("Executing write_node")
    writer = ReportWriterAgent()
    
    outline = None
    if state.get("plan"):
        outline = getattr(state["plan"], "report_outline", None)
        
    report = await writer.write_report(
        query=state["query"],
        findings=state["findings"],
        verifications=state["verifications"],
        feedback=state.get("critic_feedback"),
        effort_level=state["effort_level"],
        outline=outline
    )
    return {"report": report}


async def critic_node(state: AgentState) -> dict:
    logger.info("Executing critic_node")
    critic = CriticAgent()
    
    outline = None
    if state.get("plan"):
        outline = getattr(state["plan"], "report_outline", None)
        
    result = await critic.evaluate_report(
        query=state["query"],
        report=state["report"],
        outline=outline
    )
    
    approved = result.get("approved", False)
    if approved:
        feedback = None
    else:
        feedback = result.get("feedback", "Report rejected by critic.")
        
    new_count = state.get("rewrite_count", 0) + 1
    
    return {
        "critic_feedback": feedback,
        "rewrite_count": new_count
    }


def should_rewrite(state: AgentState) -> str:
    feedback = state.get("critic_feedback")
    count = state.get("rewrite_count", 0)
    max_rewrites = state.get("max_rewrites", 1)
    
    if feedback is None:
        logger.info("Critic approved report. Ending.")
        return "end"
    if count > max_rewrites:
        logger.info(f"Max rewrites ({max_rewrites}) reached. Ending.")
        return "end"
        
    logger.info(f"Critic rejected report. Rewriting (attempt {count}/{max_rewrites}).")
    return "rewrite"


def build_research_graph():
    workflow = StateGraph(AgentState)
    
    # Add nodes
    workflow.add_node("planner", planner_node)
    workflow.add_node("research", research_node)
    workflow.add_node("verify", verify_node)
    workflow.add_node("write", write_node)
    workflow.add_node("critic", critic_node)
    
    # Define edges
    workflow.set_entry_point("planner")
    workflow.add_edge("planner", "research")
    workflow.add_edge("research", "verify")
    workflow.add_edge("verify", "write")
    workflow.add_edge("write", "critic")
    
    # Conditional edge
    workflow.add_conditional_edges(
        "critic",
        should_rewrite,
        {
            "rewrite": "write",
            "end": END
        }
    )
    
    return workflow.compile()
