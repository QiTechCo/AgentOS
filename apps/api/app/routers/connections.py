from fastapi import APIRouter

from ..bridges import hermes_mcp, memory_os, proxmox
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
    # Proxmox host node stats
    try:
        nodes = await proxmox.get_nodes_health()
        for node in nodes:
            results.append(_ser(node))
    except Exception as e:
        results.append({
            "name": "proxmox",
            "ok": False,
            "enabled": True,
            "detail": f"Failed to probe nodes: {e}",
            "latency_ms": None
        })

    # Provider states (Gemini, Anthropic, Ollama configs)
    for p in AgentRouter().provider_status():
        results.append(p)
    return {"connections": results}
