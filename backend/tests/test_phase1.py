import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.agents.planner import PlannerAgent

@pytest.mark.asyncio
async def test_planner_agent_generation():
    planner = PlannerAgent(max_tasks=3)
    plan = await planner.generate_plan("Enterprise multi-agent research pipeline orchestration")
    assert plan.is_valid is True
    assert plan.total_tasks > 0
    assert len(plan.sub_tasks) <= 3
    assert "required_tools" in plan.sub_tasks[0].model_dump()

@pytest.mark.asyncio
async def test_planner_agent_short_query():
    planner = PlannerAgent()
    plan = await planner.generate_plan("ab")
    assert plan.is_valid is False

@pytest.mark.asyncio
async def test_planner_api_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/planner", json={
            "query": "Orchestrating multi-agent research teams with verification and citation engine"
        })
    assert response.status_code == 200
    data = response.json()
    assert data["is_valid"] is True
    assert data["total_tasks"] >= 1
