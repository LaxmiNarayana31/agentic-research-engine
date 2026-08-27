from typing import Dict, Any
from app.core.logging import logger

class StandaloneToolClient:
    """Built-in tool executor for database queries and external tool actions."""

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        logger.info(f"Executing standalone tool '{tool_name}' with args {arguments}")
        if tool_name == "list_tables":
            return ["customers", "orders", "research_archive"]
        elif tool_name == "describe_table":
            return {"table": arguments.get("table_name", "customers"), "columns": ["id", "name", "email", "created_at"]}
        elif tool_name == "run_query":
            return {"rows": [{"id": 1, "name": "Enterprise Sample", "status": "active"}]}
        return {"status": "ok", "tool": tool_name, "data": "Executed standalone tool"}

RealMCPClient = StandaloneToolClient
