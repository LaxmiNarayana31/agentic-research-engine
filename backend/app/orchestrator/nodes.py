import json
import logging
from typing import Optional

from app.agents.critic import CriticAgent
from app.agents.planner import PlannerAgent
from app.agents.report_writer import ReportWriterAgent
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent
from app.clients.llm_client import MultiModelLLMClient
from app.dtos.planner_dto import PlannerSubTask
from app.orchestrator.state import ActionState, AgentState

logger = logging.getLogger(__name__)


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
    effort = state.get("effort_level", "medium")
    
    prompt = f"""
    You are a Research Orchestrator. Your goal is to satisfy the research query: "{state['query']}"
    Effort Level: {effort}
    
    Current Plan: {plan_str}
    Findings Collected: {findings_count}
    Current Iteration: {iteration}
    History of actions:
    {history_str}
    
    Choose the next valid research action dynamically based on what the user is asking and the evidence gathered so far:
    - If the user query is conversational or already sufficiently answered by collected findings -> SYNTHESIZE
    - If specific subtasks from the plan or key factual data are missing -> SEARCH (with a tailored query string)
    - If key claims need factual validation or contradiction checking -> VERIFY
    - If research is complete -> FINISH
    
    Output JSON exactly matching this schema:
    {{
        "action": "SEARCH" | "VERIFY" | "SYNTHESIZE" | "FINISH",
        "reason": "Why this action based on user query and evidence",
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
    effort = state.get("effort_level", "medium")
    
    # In fast chat mode, bypass rewrite loops for low latency
    if effort == "chat":
        logger.info("Effort is 'chat': bypassing critic rewrite loops for speed.")
        return "end"
    
    if feedback and rewrite_count <= max_rewrites:
        logger.info(f"Critic requested rewrite (iteration {rewrite_count}/{max_rewrites}): routing back to writer")
        return "rewrite"
    logger.info("Critic approved report or reached maximum rewrites: routing to finish.")
    return "end"
