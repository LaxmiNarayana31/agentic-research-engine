import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.agents.researcher import ResearchFinding
from app.agents.verifier import ClaimVerificationResult
from app.agents.report_writer import ReportWriterAgent

@pytest.mark.asyncio
async def test_report_writer_agent():
    writer = ReportWriterAgent()
    findings = [
        ResearchFinding(
            task_id="t1",
            summary="PostgreSQL indexing improves query speed",
            sources=["Project-3 MCP PostgreSQL"],
            raw_data={},
            used_model="gpt-4o"
        )
    ]
    verifications = [
        ClaimVerificationResult(
            claim="PostgreSQL indexing improves query speed",
            is_supported=True,
            entailment_score=0.95,
            verifier_notes="Verified"
        )
    ]
    report = await writer.generate_report("PostgreSQL performance", findings, verifications)
    assert report.citation_count == 1
    assert "[1]" in report.markdown_content
    assert len(report.bibliography) == 1

@pytest.mark.asyncio
async def test_full_pipeline_with_report():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/research", json={
            "query": "Enterprise multi-agent report writer synthesis engine"
        })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "report" in data
    assert data["report"]["citation_count"] > 0
    assert "markdown_content" in data["report"]
