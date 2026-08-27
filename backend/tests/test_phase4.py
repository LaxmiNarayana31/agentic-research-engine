import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.agents.planner import PlannerSubTask
from app.agents.researcher import ResearchAgent

@pytest.mark.asyncio
async def test_circuit_breaker_fallback_path(monkeypatch):
    async def mock_fail_subtask(self, task):
        raise RuntimeError("Transient upstream service connection drop")

    monkeypatch.setattr(ResearchAgent, "execute_subtask", mock_fail_subtask)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/research", json={
            "query": "Testing multi-agent circuit breaker fallback handling"
        })

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert len(data["findings"]) > 0
    assert "Fallback Cache" in data["findings"][0]["sources"]

@pytest.mark.asyncio
async def test_circuit_breaker_invalid_query():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/research", json={
            "query": "hi"  # invalid query min_length=5 -> Pydantic 422
        })
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_circuit_breaker_transient_retry_handling(monkeypatch):
    calls = []
    from app.clients.router_client import RealRouterClient

    async def mock_get_route_error(self, prompt):
        calls.append(prompt)
        raise RuntimeError("Router service unavailable")

    monkeypatch.setattr(RealRouterClient, "get_route", mock_get_route_error)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/research", json={
            "query": "Testing circuit breaker router failure handling"
        })
    assert res.status_code == 200
    assert res.json()["status"] == "success"

@pytest.mark.asyncio
async def test_circuit_breaker_all_subtasks_failure(monkeypatch):
    async def mock_crash(self, task):
        raise ValueError("Critical upstream connection failure")

    monkeypatch.setattr(ResearchAgent, "execute_subtask", mock_crash)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/research", json={
            "query": "Testing full pipeline degradation under subtask failure"
        })
    assert res.status_code == 200
    data = res.json()
    assert len(data["findings"]) > 0
    for finding in data["findings"]:
        assert finding["sources"] == ["Fallback Cache"]
        assert finding["used_model"] == "fallback-mode"

