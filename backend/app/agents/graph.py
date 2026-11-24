"""
Backward-compatibility proxy.
The orchestrator nodes and workflow graph have been separated into app.orchestrator.
Agents now reside strictly in app.agents.
"""

from app.orchestrator.state import ActionState, AgentState, EvidenceStore
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
from app.orchestrator.graph import build_research_graph

__all__ = [
    "ActionState",
    "EvidenceStore",
    "AgentState",
    "initial_plan_node",
    "orchestrator_node",
    "search_node",
    "verify_node",
    "write_node",
    "critic_node",
    "route_orchestrator",
    "route_critic",
    "build_research_graph",
]
