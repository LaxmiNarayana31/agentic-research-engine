import os

class ObservabilityClient:
    """Client for Project 6 — Agent Observability Platform (Port 8006)."""

    def __init__(self, ingest_url: str = None):
        self.ingest_url = ingest_url or os.getenv("OBS_INGEST_URL", "http://localhost:8006")

    async def emit_span(self, span_name: str, payload: dict) -> dict:
        # TODO: wire to real service on port 8006
        return {
            "status": "mocked",
            "span_name": span_name,
            "ingest_url": self.ingest_url,
            "emitted": True
        }
