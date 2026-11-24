import logging
from langgraph.graph import END, StateGraph

from app.orchestrator.nodes import (
    critic_node,
    initial_plan_node,
    orchestrator_node,
    route_critic,
    route_orchestrator,
    search_node,
    verify_node,
    write_node,
)
from app.orchestrator.state import AgentState

logger = logging.getLogger(__name__)


def build_research_graph():
    """Compiles the multi-agent autonomous research state graph workflow."""
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
