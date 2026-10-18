import asyncio
import json
import logging
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from app.agents.critic import CriticAgent
from app.agents.planner import PlannerAgent
from app.agents.report_writer import ReportWriterAgent
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent
from app.clients.llm_client import MultiModelLLMClient
from app.dtos.planner_dto import PlannerOutput, PlannerSubTask
from app.dtos.report_dto import FinalReport
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult


logger = logging.getLogger(__name__)

class ActionState(TypedDict):
    action: str
    reason: str
    target: Optional[str]
    query: Optional[str]

class EvidenceStore(TypedDict):
    claims: List[dict]
    sources: List[dict]
    unresolved_questions: List[str]

class AgentState(TypedDict):
    query: str
    effort_level: str
    conversation_history: Optional[List[dict]]
    
    plan: Optional[PlannerOutput]
    raw_findings: List[ResearchFinding]
    findings: List[ResearchFinding]
    verifications: List[ClaimVerificationResult]
    evidence_store: EvidenceStore
    report: Optional[FinalReport]
    
    research_history: List[ActionState]
    iteration_count: int
    tool_call_count: int
    
    critic_feedback: Optional[str]
    rewrite_count: int
    max_rewrites: int


async def initial_plan_node(state: AgentState) -> dict:
    logger.info("Executing initial_plan_node")
    planner = PlannerAgent()
    query = state["query"]
        
    plan = await planner.generate_plan(
        query,
        state["effort_level"],
        conversation_history=state.get("conversation_history")
    )
    if not plan.is_valid:
        raise ValueError(f"Invalid plan generated: {plan.validation_notes}")
        
    evidence_store = state.get("evidence_store", {"claims": [], "sources": [], "unresolved_questions": []})
    
    return {
        "plan": plan, 
        "evidence_store": evidence_store, 
        "research_history": [], 
        "iteration_count": 0, 
        "tool_call_count": 0,
        "raw_findings": [],
        "findings": [],
        "verifications": []
    }


async def orchestrator_node(state: AgentState) -> dict:
    logger.info("Executing orchestrator_node")
    llm_client = MultiModelLLMClient()
    
    history_str = json.dumps(state.get("research_history", []), indent=2)
    plan_str = state.get("plan").model_dump_json() if state.get("plan") else "{}"
    findings_count = len(state.get("findings", []))
    iteration = state.get("iteration_count", 0)
    
    prompt = f"""
    You are a Research Orchestrator. Your goal is to satisfy the research query: "{state['query']}"
    
    Current Plan: {plan_str}
    Findings Collected: {findings_count}
    Current Iteration: {iteration}
    History of actions:
    {history_str}
    
    Choose the next valid research action.
    Options for action:
    - SEARCH: Search the web for a query.
    - VERIFY: Cross-check claims.
    - SYNTHESIZE: Finish research and write report.
    - FINISH: End research if done.
    
    Output JSON exactly matching this schema:
    {{
        "action": "SEARCH" | "VERIFY" | "SYNTHESIZE" | "FINISH",
        "reason": "Why this action",
        "target": "Target identifier if any",
        "query": "Query string if searching"
    }}
    """
    
    data, _ = await llm_client.complete_json(prompt, effort_level="low")
    action_state = {
        "action": data.get("action", "SYNTHESIZE"),
        "reason": data.get("reason", ""),
        "target": data.get("target"),
        "query": data.get("query")
    }
    
    history = state.get("research_history", []) + [action_state]
    return {
        "research_history": history,
        "iteration_count": iteration + 1
    }


def route_orchestrator(state: AgentState) -> str:
    history = state.get("research_history", [])
    if not history:
        return "synthesize"
    
    last_action = history[-1].get("action", "SYNTHESIZE")
    iteration = state.get("iteration_count", 0)
    
    # Calibrated maximum iterations per effort tier to prevent unbounded execution loops
    effort_budgets = {
        "low": 2,
        "medium": 4,
        "high": 6,
        "chat": 1
    }
    max_budget = effort_budgets.get(state.get("effort_level", "medium"), 4)
    if iteration >= max_budget:
        logger.info(f"Orchestrator reached iteration budget ({iteration}/{max_budget}): forcing synthesis.")
        return "synthesize"
        
    if last_action == "SEARCH":
        return "search"
    elif last_action == "VERIFY":
        return "verify"
    elif last_action in ("SYNTHESIZE", "FINISH"):
        return "synthesize"
    return "synthesize"


async def search_node(state: AgentState) -> dict:
    logger.info("Executing search_node")
    researcher = ResearchAgent()
    history = state.get("research_history", [])
    last_action = history[-1] if history else {}
    
    query = last_action.get("query") or state["query"]
    subtask = PlannerSubTask(task_id=f"search_{state.get('iteration_count', 0)}", description=query, required_tools=["tavily_search"], search_depth="deep")
    
    finding = await researcher.execute_subtask(subtask)
    
    findings = state.get("findings", []) + [finding]
    
    # Maintain evidence store with source deduplication and claim tracking
    evidence_store = state.get("evidence_store") or {"claims": [], "sources": [], "unresolved_questions": []}
    current_sources = list(evidence_store.get("sources", []))
    for s in (finding.sources or []):
        if not any(cs.get("url") == s for cs in current_sources):
            current_sources.append({"url": s, "task_id": subtask.task_id})
    evidence_store["sources"] = current_sources
    
    current_claims = list(evidence_store.get("claims", []))
    if finding.summary:
        current_claims.append({
            "claim": finding.summary,
            "task_id": subtask.task_id,
            "verified": False
        })
    evidence_store["claims"] = current_claims

    return {
        "findings": findings,
        "evidence_store": evidence_store
    }


async def verify_node(state: AgentState) -> dict:
    logger.info("Executing verify_node")
    verifier = VerificationAgent()
    verifications = await verifier.verify_findings(state.get("findings", []))
    
    # Update evidence store with verified claim statuses
    evidence_store = state.get("evidence_store") or {"claims": [], "sources": [], "unresolved_questions": []}
    claims = list(evidence_store.get("claims", []))
    for idx, v in enumerate(verifications):
        if idx < len(claims):
            claims[idx]["verified"] = getattr(v, "is_supported", False)
            claims[idx]["score"] = getattr(v, "entailment_score", 0.0)
            claims[idx]["has_contradiction"] = getattr(v, "has_contradiction", False)
            claims[idx]["uncertainty_level"] = getattr(v, "uncertainty_level", "low")
    evidence_store["claims"] = claims
    
    return {
        "verifications": verifications,
        "evidence_store": evidence_store
    }


async def write_node(state: AgentState) -> dict:
    logger.info("Executing write_node")
    writer = ReportWriterAgent()
    
    outline = None
    if state.get("plan"):
        outline = getattr(state["plan"], "report_outline", None)
        
    report = await writer.write_report(
        query=state["query"],
        findings=state.get("findings", []),
        verifications=state.get("verifications", []),
        feedback=state.get("critic_feedback"),
        effort_level=state["effort_level"],
        outline=outline
    )
    return {"report": report}


async def critic_node(state: AgentState) -> dict:
    logger.info("Executing critic_node in LangGraph workflow")
    critic = CriticAgent()
    report = state.get("report")
    if not report:
        return {"critic_feedback": None}
    
    outline = None
    if state.get("plan"):
        outline = getattr(state["plan"], "report_outline", None)
        
    critique = await critic.evaluate_report(
        query=state["query"],
        report=report,
        outline=outline
    )
    
    rewrite_count = state.get("rewrite_count", 0)
    is_approved = critique.get("approved", True)
    feedback = critique.get("feedback")
    
    new_rewrite_count = rewrite_count + (0 if is_approved else 1)
    return {
        "critic_feedback": feedback if not is_approved else None,
        "rewrite_count": new_rewrite_count
    }


def route_critic(state: AgentState) -> str:
    feedback = state.get("critic_feedback")
    rewrite_count = state.get("rewrite_count", 0)
    max_rewrites = state.get("max_rewrites", 1)
    
    if feedback and rewrite_count <= max_rewrites:
        logger.info(f"Critic requested rewrite (iteration {rewrite_count}/{max_rewrites}): routing back to writer")
        return "rewrite"
    logger.info("Critic approved report or reached maximum rewrites: routing to finish.")
    return "end"


def build_research_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("planner", initial_plan_node)
    workflow.add_node("orchestrator", orchestrator_node)
    workflow.add_node("search", search_node)
    workflow.add_node("verify", verify_node)
    workflow.add_node("write", write_node)
    workflow.add_node("critic", critic_node)
    
    workflow.set_entry_point("planner")
    workflow.add_edge("planner", "orchestrator")
    
    workflow.add_conditional_edges(
        "orchestrator",
        route_orchestrator,
        {
            "search": "search",
            "verify": "verify",
            "synthesize": "write"
        }
    )
    
    workflow.add_edge("search", "orchestrator")
    workflow.add_edge("verify", "orchestrator")
    
    # Critic review loop
    workflow.add_edge("write", "critic")
    workflow.add_conditional_edges(
        "critic",
        route_critic,
        {
            "rewrite": "write",
            "end": END
        }
    )
    
    return workflow.compile()
