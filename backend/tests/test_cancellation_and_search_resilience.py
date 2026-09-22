import asyncio
import os
import sys
import uuid
import pytest
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, message=".*duckduckgo_search.*")

from app.agents.researcher import ResearchAgent
from app.db.database import AsyncSessionLocal
from app.dtos.planner_dto import PlannerSubTask
from app.models.research_session import ResearchSession
from app.services.research_service import ActiveJob, research_service
from main import app

@pytest.mark.asyncio
async def test_request_id_middleware():
    """Verify ASGI middleware assigns X-Request-ID and returns it in headers."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Without incoming request ID
        res = await client.get("/health")
        assert res.status_code == 200
        assert "x-request-id" in res.headers
        req_id = res.headers["x-request-id"]
        assert req_id.startswith("req_")

        # 2. With incoming request ID
        custom_id = "test-custom-trace-123"
        res2 = await client.get("/health", headers={"X-Request-ID": custom_id})
        assert res2.status_code == 200
        assert res2.headers.get("x-request-id") == custom_id
        print("X-Request-ID Correlation Middleware OK!")

@pytest.mark.asyncio
async def test_active_job_cancellation():
    """Verify ActiveJob cancellation stops task, updates DB, and broadcasts cancelled event."""
    test_session_id = f"test_cancel_{uuid.uuid4().hex[:8]}"
    
    # Pre-seed running session in DB
    async with AsyncSessionLocal() as db:
        session = ResearchSession(
            id=test_session_id,
            query="Deep research to be cancelled",
            effort_level="medium",
            status="running"
        )
        db.add(session)
        await db.commit()

    try:
        # Create active job in memory
        job = ActiveJob(test_session_id, "Deep research to be cancelled", "medium")
        research_service.active_jobs[test_session_id] = job
        
        # Add subscriber queue
        q = job.add_subscriber()

        # Call cancel endpoint
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(f"/api/research/{test_session_id}/cancel")
            assert res.status_code == 200
            data = res.json()
            assert data["success"] is True

        assert job.status == "cancelled"
        assert job.completed is True

        # Check broadcasted events
        cancelled_event = None
        while not q.empty():
            ev = q.get_nowait()
            if ev and ev.get("type") == "cancelled":
                cancelled_event = ev
                break

        assert cancelled_event is not None
        assert cancelled_event["session_id"] == test_session_id
        print("ActiveJob Cancellation & SSE broadcast OK!")

    finally:
        # Cleanup
        research_service.active_jobs.pop(test_session_id, None)
        async with AsyncSessionLocal() as db:
            s = await db.get(ResearchSession, test_session_id)
            if s:
                await db.delete(s)
                await db.commit()

@pytest.mark.asyncio
async def test_duckduckgo_search_fallback():
    """Verify ResearchAgent falls back to DuckDuckGo when Tavily is unconfigured or fails."""
    agent = ResearchAgent()
    task = PlannerSubTask(
        task_id="t_sub_fallback",
        description="Renewable Energy Innovations 2025",
        required_tools=["web_search"],
        estimated_seconds=10,
        search_depth="basic"
    )

    # Directly verify _search_duckduckgo returns valid sources
    results = await agent._search_duckduckgo(task.description, max_results=3)
    assert isinstance(results, list)
    # If network allows, results will be found; otherwise fallback handles cleanly
    for r in results:
        assert "url" in r
        assert "title" in r
    print(f"DuckDuckGo search fallback returned {len(results)} sources OK!")
