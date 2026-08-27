import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.agents.planner import PlannerSubTask
from app.agents.researcher import ResearchAgent
from app.agents.verifier import VerificationAgent

@pytest.mark.asyncio
async def test_research_agent_execution():
    agent = ResearchAgent()
    task = PlannerSubTask(
        task_id="t1",
        description="Investigate PostgreSQL database schema",
        required_tools=["mcp_postgres_read"],
        estimated_priority=1
    )
    finding = await agent.execute_subtask(task)
    assert finding.task_id == "t1"
    assert "Project-3 MCP PostgreSQL" in finding.sources

def test_verification_agent_entailment():
    verifier = VerificationAgent()
    from app.agents.researcher import ResearchFinding
    finding = ResearchFinding(
        task_id="t1",
        summary="Verified claim",
        sources=["Source 1"],
        raw_data={},
        used_model="gpt-4o"
    )
    results = verifier.verify_findings([finding])
    assert len(results) == 1
    assert results[0].is_supported is True
    assert results[0].entailment_score >= 0.70

@pytest.mark.asyncio
async def test_research_pipeline_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/research", json={
            "query": "Enterprise multi-agent research pipeline verification"
        })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert len(data["findings"]) > 0
    assert len(data["verifications"]) > 0
