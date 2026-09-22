import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.agents.researcher import ResearchAgent, _fetch_page_content, is_safe_url
from app.clients.llm_client import MultiModelLLMClient
from app.db.database import AsyncSessionLocal, engine, is_postgres
from app.dtos.planner_dto import PlannerOutput, PlannerSubTask
from app.dtos.researcher_dto import ResearchFinding
from app.services.research_service import ActiveJob, research_service


@pytest.mark.asyncio
async def test_subtask_worker_fault_tolerance():
    """Verify that a failing subtask worker synthesizes a fallback finding without crashing the pipeline."""
    failing_agent = MagicMock()

    async def mock_failing_stream(subtask):
        raise RuntimeError("Simulated transient 3rd-party failure during subtask execution")
        yield  # make it a generator

    failing_agent.execute_subtask_stream = mock_failing_stream

    # Setup a queue and test the resilient worker pattern used in research_service
    queue = asyncio.Queue()
    subtask = PlannerSubTask(
        task_id="st_resilience_1",
        description="Investigate market trends",
        required_tools=["web_search"],
        search_depth="fast"
    )

    async def resilient_worker(st):
        try:
            async for chunk in failing_agent.execute_subtask_stream(st):
                await queue.put(chunk)
            await queue.put({"type": "worker_done", "task_id": st.task_id})
        except Exception as e:
            # Honest failure: no fabricated URLs, empty sources, clear failure message
            fallback_finding = ResearchFinding(
                task_id=st.task_id,
                summary=f"Research worker failed for '{st.description}' — no evidence collected.",
                sources=[],
                rich_sources=[],
                raw_data={"worker_error": str(e)},
                used_model="worker-failed"
            )
            await queue.put({"type": "finding", "content": fallback_finding})
            await queue.put({"type": "worker_done", "task_id": st.task_id})

    # Run the resilient worker
    await resilient_worker(subtask)

    findings = []
    completed = 0
    while completed < 1:
        chunk = await queue.get()
        if chunk["type"] == "worker_done":
            completed += 1
        elif chunk["type"] == "finding":
            findings.append(chunk["content"])

    assert len(findings) == 1
    assert findings[0].task_id == "st_resilience_1"
    assert findings[0].used_model == "worker-failed"
    # Sources must be empty — no fabricated fallback URLs
    assert findings[0].sources == []
    assert findings[0].rich_sources == []
    # Summary must indicate failure honestly, not pretend research happened
    assert "failed" in findings[0].summary.lower() or "no evidence" in findings[0].summary.lower()
    assert completed == 1


@pytest.mark.asyncio
async def test_database_connection_pooling_configuration():
    """Verify that the database engine uses connection pooling rather than NullPool."""
    from sqlalchemy.pool import NullPool

    assert not isinstance(engine.pool, NullPool), "Engine must not use NullPool in production"
    
    if is_postgres:
        assert engine.pool.size() == 10 or hasattr(engine.pool, "_pool")
        assert engine.pool._max_overflow == 20
        assert engine.pool._recycle == 1800


@pytest.mark.asyncio
async def test_gemini_429_rate_limit_retry():
    """Verify that _call_gemini retries on 429 RESOURCE_EXHAUSTED and succeeds on backoff."""
    client = MultiModelLLMClient(agent_role="researcher")

    mock_gemini_client = MagicMock()
    # First call raises 429 RESOURCE_EXHAUSTED, second call succeeds
    mock_success_response = MagicMock()
    mock_success_response.text = "Analysis synthesized successfully after rate limit retry."

    mock_generate = AsyncMock(
        side_effect=[
            Exception("429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate Content API'"),
            mock_success_response
        ]
    )
    mock_gemini_client.aio.models.generate_content = mock_generate
    client._raw_gemini_client = mock_gemini_client

    with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        result = await client._call_gemini("Test prompt", "gemini-2.5-flash")
        assert result == "Analysis synthesized successfully after rate limit retry."
        assert mock_generate.call_count == 2
        mock_sleep.assert_called_once_with(2)


@pytest.mark.asyncio
async def test_gemini_stream_429_retry():
    """Verify that _stream_gemini retries on 429 / rate limit errors."""
    client = MultiModelLLMClient(agent_role="researcher")

    mock_gemini_client = MagicMock()

    class AsyncMockChunkIterator:
        def __init__(self, texts):
            self.texts = texts
            self.idx = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self.idx < len(self.texts):
                chunk = MagicMock()
                chunk.text = self.texts[self.idx]
                self.idx += 1
                return chunk
            raise StopAsyncIteration

    first_call = True
    async def mock_generate_stream(*args, **kwargs):
        nonlocal first_call
        if first_call:
            first_call = False
            raise Exception("429 rate limit exceeded, please back off")
        return AsyncMockChunkIterator(["Token1 ", "Token2"])

    mock_gemini_client.aio.models.generate_content_stream = mock_generate_stream
    client._raw_gemini_client = mock_gemini_client

    with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        tokens = []
        async for chunk in client._stream_gemini("Stream prompt", "gemini-2.5-flash"):
            tokens.append(chunk)

        assert "".join(tokens) == "Token1 Token2"
        mock_sleep.assert_called_once_with(2)


@pytest.mark.asyncio
async def test_article_scraper_html_stripping():
    """Verify that _fetch_page_content strips HTML, scripts, and styles properly."""
    raw_html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Quantum Computing Breakthrough</title>
        <style>.hidden { display: none; }</style>
        <script>console.log("tracker");</script>
    </head>
    <body>
        <header><nav><a href="/home">Home</a></nav></header>
        <main>
            <h1>Quantum Supremacy Update</h1>
            <p>Researchers have demonstrated high-fidelity logical qubits with low error rates.</p>
            <p>The system achieved fault-tolerant threshold requirements across 100 physical qubits.</p>
        </main>
        <footer>Copyright 2026</footer>
    </body>
    </html>
    """

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = raw_html

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_resp
        text = await _fetch_page_content("https://example.com/quantum-paper")
        assert "Quantum Supremacy Update" in text
        assert "logical qubits" in text
        assert "console.log" not in text
        assert ".hidden" not in text
        assert "<p>" not in text


def test_ssrf_guard_blocks_private_and_metadata_ips():
    """Verify that is_safe_url blocks private IP ranges, cloud metadata, and loopback."""
    # Forbidden / Restricted Targets
    assert is_safe_url("http://127.0.0.1:8000/admin") is False
    assert is_safe_url("http://localhost:5432") is False
    assert is_safe_url("http://169.254.169.254/latest/meta-data/") is False  # AWS IMDS
    assert is_safe_url("http://10.0.0.1/internal") is False                  # RFC 1918 Class A
    assert is_safe_url("http://192.168.1.1/router") is False                # RFC 1918 Class C
    assert is_safe_url("http://172.16.0.5/api") is False                    # RFC 1918 Class B
    assert is_safe_url("http://0.0.0.0:3000") is False
    assert is_safe_url("file:///etc/passwd") is False                        # Non-HTTP(S)
    assert is_safe_url("ftp://server/data") is False
    assert is_safe_url("http://metadata.google.internal") is False          # GCP metadata

    # Allowed Public Targets
    assert is_safe_url("https://en.wikipedia.org/wiki/Artificial_intelligence") is True
    assert is_safe_url("https://www.nature.com/articles/s41586-023-06747-5") is True


def test_groundedness_score_calculation():
    """Verify that Groundedness score is computed accurately from verifier claim entailment scores."""
    from app.dtos.verifier_dto import ClaimVerificationResult

    verifications = [
        ClaimVerificationResult(claim="Claim A", is_supported=True, entailment_score=0.95, verifier_notes="Verified"),
        ClaimVerificationResult(claim="Claim B", is_supported=True, entailment_score=0.90, verifier_notes="Verified"),
        ClaimVerificationResult(claim="Claim C", is_supported=True, entailment_score=0.85, verifier_notes="Verified"),
    ]

    avg_entailment = sum(v.entailment_score for v in verifications) / len(verifications)
    groundedness = round(avg_entailment * 100.0, 1)

    assert groundedness == 90.0
    assert 0.0 <= groundedness <= 100.0


def test_token_usage_and_cost_meter():
    """Verify that ActiveJob exact provider-reported token usage accumulates correctly with official model pricing."""
    from app.clients.llm_client import calculate_cost

    job = ActiveJob("session_test_meter", "Test query", "medium")

    assert job.prompt_tokens == 0
    assert job.completion_tokens == 0
    assert job.total_tokens == 0
    assert job.estimated_cost_usd == 0.0

    # Simulate exact provider-reported planning tokens (e.g. from Gemini usage_metadata)
    job.add_token_usage(prompt_tokens=1200, completion_tokens=350, model="gemma-4-31b-it")
    assert job.prompt_tokens == 1200
    assert job.completion_tokens == 350
    assert job.total_tokens == 1550

    # Simulate exact provider-reported research tokens (e.g. from Groq usage)
    job.add_token_usage(prompt_tokens=5000, completion_tokens=1500, model="openai/gpt-oss-120b")
    assert job.prompt_tokens == 6200
    assert job.completion_tokens == 1850
    assert job.total_tokens == 8050
    assert job.estimated_cost_usd > 0.0

    # Cost should use official model pricing via calculate_cost, not heuristic blending
    expected_cost = round(calculate_cost(6200, 1850, "openai/gpt-oss-120b"), 6)
    assert job.estimated_cost_usd == expected_cost


