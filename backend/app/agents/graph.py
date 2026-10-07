import asyncio
import logging
import json
from typing import TypedDict, List, Optional, Any, Dict
from langgraph.graph import StateGraph, END

from app.agents.planner import PlannerAgent
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent
from app.agents.report_writer import ReportWriterAgent
from app.agents.critic import CriticAgent
from app.clients.llm_client import MultiModelLLMClient
from app.dtos.planner_dto import PlannerOutput, PlannerSubTask
from app.dtos.researcher_dto import ResearchFinding
from app.dtos.verifier_dto import ClaimVerificationResult
from app.dtos.report_dto import FinalReport


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
    
    if iteration > 10:
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
    last_action = history[-1]
    
    query = last_action.get("query") or state["query"]
    subtask = PlannerSubTask(task_id=f"search_{state.get('iteration_count', 0)}", description=query, required_tools=["tavily_search"], search_depth="deep")
    
    finding = await researcher.execute_subtask(subtask)
    
    findings = state.get("findings", []) + [finding]
    return {"findings": findings}


async def verify_node(state: AgentState) -> dict:
    logger.info("Executing verify_node")
    verifier = VerificationAgent()
    verifications = await verifier.verify_findings(state.get("findings", []))
    
    return {"verifications": verifications}


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


def build_research_graph():
    workflow = StateGraph(AgentState)
    
    workflow.add_node("planner", initial_plan_node)
    workflow.add_node("orchestrator", orchestrator_node)
    workflow.add_node("search", search_node)
    workflow.add_node("verify", verify_node)
    workflow.add_node("write", write_node)
    
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
    workflow.add_edge("write", END)
    
    return workflow.compile()
