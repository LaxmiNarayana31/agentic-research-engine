from typing import Dict, Any, List
from app.core.logging import logger

class StandaloneObsClient:
    """Built-in telemetry trace logger and in-memory span store."""

    def __init__(self):
        self._spans: List[Dict[str, Any]] = []

    async def log_span(self, span: Dict[str, Any]) -> bool:
        span["project_id"] = "Project-1_MultiAgent"
        self._spans.append(span)
        logger.info(f"Telemetry span logged: {span.get('span_name')} (model={span.get('model_name')}, duration={span.get('duration_ms')}ms)")
        return True

    def get_spans(self) -> List[Dict[str, Any]]:
        return list(self._spans)

RealObsClient = StandaloneObsClient
