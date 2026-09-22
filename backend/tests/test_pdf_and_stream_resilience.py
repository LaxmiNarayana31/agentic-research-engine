import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from httpx import AsyncClient, ASGITransport
from app.db.database import AsyncSessionLocal
from app.models.research_session import ResearchSession
from app.services.research_service import ActiveJob, research_service
from main import app


@pytest.mark.asyncio
async def test_server_pdf_export_endpoint():
    """Test GET /api/research/{session_id}/export/pdf generates a valid vector PDF."""
    test_session_id = "test_export_sess_123"
    async with AsyncSessionLocal() as db:
        session = ResearchSession(
            id=test_session_id,
            query="Deep Research on Vector PDF Exporting",
            effort_level="deep",
            status="completed",
            report_data={
                "title": "Autonomous Vector PDF Architecture",
                "markdown_content": "# Autonomous Vector PDF Architecture\n\nThis is a **vector PDF report** with selectable text.\n\n## Subheading\n- Point A\n- Point B\n\n> Verified by multi-agent critic.",
                "turns": [{
                    "query": "Deep Research on Vector PDF Exporting",
                    "effort_level": "deep",
                    "report": {
                        "title": "Autonomous Vector PDF Architecture",
                        "markdown_content": "# Autonomous Vector PDF Architecture\n\nThis is a **vector PDF report** with selectable text.\n\n## Subheading\n- Point A\n- Point B\n\n> Verified by multi-agent critic."
                    },
                    "findings": [
                        {
                            "task_id": "t1",
                            "sources": [
                                {"title": "Vector PDF Reference", "url": "https://example.com/pdf-spec"}
                            ]
                        }
                    ]
                }]
            }
        )
        db.add(session)
        await db.commit()

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.get(f"/api/research/{test_session_id}/export/pdf")
            assert res.status_code == 200
            assert res.headers["content-type"] == "application/pdf"
            assert "attachment;" in res.headers["content-disposition"]
            assert res.content.startswith(b"%PDF-1.")
            assert len(res.content) > 1000
            print(f"PDF Export OK: {len(res.content)} bytes")
    finally:
        # Cleanup
        async with AsyncSessionLocal() as db:
            s = await db.get(ResearchSession, test_session_id)
            if s:
                await db.delete(s)
                await db.commit()


@pytest.mark.asyncio
async def test_sse_resubscription_and_event_id():
    """Test ActiveJob sequential event_id and subscribe_session_stream with Last-Event-ID."""
    test_job_id = "test_active_job_456"
    job = ActiveJob(test_job_id, "Test Query", "medium")
    research_service.active_jobs[test_job_id] = job

    # Broadcast a few events
    job.broadcast({"type": "status", "message": "Step 1"})
    job.broadcast({"type": "status", "message": "Step 2"})
    job.broadcast({"type": "status", "message": "Step 3"})

    assert len(job.history_events) == 3
    assert job.history_events[0]["event_id"] == 1
    assert job.history_events[1]["event_id"] == 2
    assert job.history_events[2]["event_id"] == 3

    # Resubscribe with last_event_id=1, should only get events 2 and 3
    replayed = []
    stream_gen = research_service.subscribe_session_stream(test_job_id, last_event_id=1)
    
    # Mark job completed so generator finishes after replaying history
    job.completed = True

    async for chunk in stream_gen:
        for line in chunk.strip().split("\n"):
            if line.startswith("data: "):
                data = json.loads(line.replace("data: ", ""))
                replayed.append(data)

    # First event is the reconnect notice, followed by events 2 and 3
    assert replayed[0]["type"] == "reconnected"
    event_ids = [e.get("event_id") for e in replayed if "event_id" in e]
    assert event_ids == [2, 3], f"Expected event IDs [2, 3], got {event_ids}"
    print("SSE Reconnection and Event ID filtering OK!")

    # Cleanup
    research_service.active_jobs.pop(test_job_id, None)
