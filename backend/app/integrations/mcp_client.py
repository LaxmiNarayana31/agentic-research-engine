import os

class MCPClient:
    """Client for Project 3 — MCP Enterprise Assistant (Port 8003)."""

    def __init__(self, host_url: str = None):
        self.host_url = host_url or os.getenv("MCP_HOST_URL", "http://localhost:8003")

    async def execute_tool(self, tool_name: str, arguments: dict) -> dict:
        # TODO: wire to real service on port 8003
        return {
            "status": "mocked",
            "tool": tool_name,
            "result": f"Mock response from MCP server for {tool_name}",
            "mcp_host": self.host_url
        }
