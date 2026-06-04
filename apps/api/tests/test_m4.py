"""M4 unit tests — Claude Code bridge, Memory OS recall, and Multi-Agent Handoff Loop.

Run: `python -m tests.test_m4` from apps/api
"""
import os
import json
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test"
os.environ["GEMINI_API_KEY"] = "gem-test"
os.environ["QDRANT_URL"] = "http://localhost:6333"

from app.config import get_settings  # noqa: E402
get_settings.cache_clear()

from app.bridges import providers as pv  # noqa: E402
from app.bridges import memory_os as mo  # noqa: E402
from app.bridges.claude_code import ClaudeCodeClient  # noqa: E402
from app.agents.router import AgentRouter  # noqa: E402
from app.agents.handoff import get_handoff_orchestrator  # noqa: E402
from app.mcp import server as mcp_srv  # noqa: E402

HTTP_CALLS = []


class FakeResp:
    def __init__(self, status=200, json_data=None):
        self.status_code = status
        self._json = json_data

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _route(url, payload):
    HTTP_CALLS.append(("POST", url, payload))
    if "gemini-embedding-2:embedContent" in url:
        # Return mock 3072 dimension vector
        vec = [0.1] * 3072
        return FakeResp(200, {"embedding": {"values": vec}})
    if "collections/knowledge_base/points/search" in url:
        return FakeResp(200, {
            "result": [
                {
                    "id": "1",
                    "score": 0.95,
                    "payload": {
                        "text": "Google Workspace config rules",
                        "source": "wiki-root",
                        "created_at": "2026-06-04"
                    }
                }
            ]
        })
    return FakeResp(404, {})


class FakeClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        return _route(url, json)


# Monkeypatch httpx in providers and memory_os
pv.httpx.AsyncClient = FakeClient
mo.httpx.AsyncClient = FakeClient


async def run_tests():
    # 1) Embedding generation dimensions & payload
    HTTP_CALLS.clear()
    vec = await mo.get_embedding("workspace memory")
    assert len(vec) == 3072
    assert HTTP_CALLS[0][1].endswith("gemini-embedding-2:embedContent?key=gem-test")

    # 2) Recall query structure (dense named vector search)
    HTTP_CALLS.clear()
    results = await mo.recall_memories("Workspace setup", limit=2)
    assert len(results) == 1
    assert results[0]["id"] == "1"
    assert results[0]["score"] == 0.95
    assert results[0]["payload"]["text"] == "Google Workspace config rules"
    
    # Check dense named vector in request body
    search_payload = HTTP_CALLS[1][2]
    assert search_payload["vector"]["name"] == "dense"
    assert len(search_payload["vector"]["vector"]) == 3072
    assert search_payload["limit"] == 2

    # 3) Claude Code subprocess headless execution execution mock
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(b"Success: files modified", b""))
    
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        client = ClaudeCodeClient()
        out = await client.run_prompt("make standard tests")
        assert "Success: files modified" in out
        mock_exec.assert_called_once()
        args = mock_exec.call_args[0]
        assert "/Users/user/.local/bin/claude" in args or "npx" in args
        assert "--print" in args
        assert "--dangerously-skip-permissions" in args

    # 4) AgentRouter mapping verification
    router = AgentRouter()
    
    # hephaestus -> claude_code
    mock_proc.communicate = AsyncMock(return_value=(b"Headless Claude Output", b""))
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        res = await router.run("build tool specs", persona="hephaestus")
        assert res["reply"] == "Headless Claude Output"
        assert res["model"] == "claude-code-cli"

    # hermes -> hermes_mcp -> ACP client stream
    mock_stream = AsyncMock()
    mock_stream.__aiter__.return_value = [
        {"type": "chunk", "text": "Hermes "},
        {"type": "chunk", "text": "is "},
        {"type": "chunk", "text": "conducting."},
        {"type": "done", "usage": {}}
    ]
    with patch("app.bridges.hermes_acp.HermesACPClient.stream_prompt", return_value=mock_stream):
        res = await router.run("conduct morning scan", persona="hermes")
        assert res["reply"] == "Hermes is conducting."
        assert res["model"] == "hermes-acp"

    # 5) Multi-agent Handoff Engine testing
    # Prepare dummy files in workspace for testing
    settings = get_settings()
    os.makedirs(settings.agent_os_dir, exist_ok=True)
    context_file = settings.agent_os_dir / "context.json"
    
    initial_ctx = {
        "summary": "Ready",
        "next_steps": [],
        "active_agent": "System",
        "handoffs": [
            {
                "id": "test-h-1",
                "timestamp": "2026-06-04T12:00:00",
                "from_agent": "Operator",
                "to_agent": "Daedalus",
                "task": "Test handoff task description",
                "payload": "mock data payload",
                "status": "pending"
            }
        ]
    }
    context_file.write_text(json.dumps(initial_ctx, indent=2))
    
    # Mock Daedalus execution in Router
    with patch("app.agents.router.AgentRouter.run", AsyncMock(return_value={"reply": "Handoff successfully run"})):
        orchestrator = get_handoff_orchestrator()
        
        # Start orchestrator
        orchestrator.start()
        
        # Wait a short period to allow execution to pick up the task and run
        await asyncio.sleep(6.5)
        
        # Stop orchestrator
        await orchestrator.stop()
        
        # Assert updated context file state
        final_ctx = json.loads(context_file.read_text())
        h_entry = final_ctx["handoffs"][0]
        assert h_entry["status"] == "completed"
        assert h_entry["result"] == "Handoff successfully run"
        assert final_ctx["active_agent"] == "Daedalus"
        assert "Completed delegation to Daedalus" in final_ctx["summary"]

    # Clean up test workspace files
    if context_file.exists():
        os.remove(context_file)
        
    print("ALL M4 GATEWAY AND SEMANTIC SEAM TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(run_tests())
