from fastapi import APIRouter

from ..bridges import hermes_mcp, memory_os
from ..bridges.base import Health
from ..agents.router import AgentRouter

router = APIRouter(prefix="/connections", tags=["connections"])


def _ser(h: Health) -> dict:
    return {
        "name": h.name,
        "ok": h.ok,
        "enabled": h.enabled,
        "detail": h.detail,
        "latency_ms": h.latency_ms,
    }


@router.get("")
async def connections():
    results = [
        _ser(await hermes_mcp.health()),
        _ser(await memory_os.qdrant_health()),
        _ser(memory_os.hermes_home_health()),
    ]
    # Provider states (Gemini, Anthropic, Ollama configs)
    for p in AgentRouter().provider_status():
        results.append(p)
    return {"connections": results}
