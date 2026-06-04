import os
import sqlite3
import time
import logging

import httpx

from ..config import get_settings
from .base import Health


async def qdrant_health() -> Health:
    url = get_settings().qdrant_url.strip()
    if not url:
        return Health(name="qdrant", ok=False, enabled=False, detail="QDRANT_URL not set")
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{url.rstrip('/')}/readyz")
        ms = int((time.perf_counter() - t0) * 1000)
        return Health(name="qdrant", ok=r.status_code == 200, detail=f"HTTP {r.status_code}", latency_ms=ms)
    except Exception as e:  # noqa: BLE001
        return Health(name="qdrant", ok=False, detail=f"{type(e).__name__}: {e}")


def hermes_home_health() -> Health:
    home = get_settings().hermes_home_ro.strip()
    if not home:
        return Health(name="hermes_home", ok=False, enabled=False, detail="HERMES_HOME_RO not set")
    state = os.path.join(home, "state.db")
    if not os.path.exists(state):
        return Health(name="hermes_home", ok=False, detail=f"state.db not found at {home}")
    try:
        # Read-only URI connection
        con = sqlite3.connect(f"file:{state}?mode=ro", uri=True)
        n = con.execute("SELECT count(*) FROM sessions").fetchone()[0]
        con.close()
        return Health(name="hermes_home", ok=True, detail=f"{n} sessions (read-only)")
    except Exception as e:  # noqa: BLE001
        return Health(name="hermes_home", ok=False, detail=f"{type(e).__name__}: {e}")


logger = logging.getLogger("agentos.memory_os")


async def get_embedding(text: str) -> list[float]:
    """Generates embedding via Gemini REST API using models/gemini-embedding-2."""
    key = get_settings().gemini_api_key.strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not configured for generating embeddings")
    
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent"
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": "models/gemini-embedding-2",
        "content": {
            "parts": [
                {"text": text}
            ]
        }
    }
    
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{url}?key={key}", headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
        
    return data["embedding"]["values"]


async def recall_memories(query: str, limit: int = 5) -> list[dict]:
    """Recall semantically relevant project memories and documentation from Qdrant."""
    url = get_settings().qdrant_url.strip()
    if not url:
        logger.warning("QDRANT_URL is not set; skipping memory recall.")
        return []
        
    collection = get_settings().qdrant_collection or "knowledge_base"
    
    try:
        vector = await get_embedding(query)
    except Exception as e:
        logger.error(f"Failed to generate embedding for query '{query}': {e}")
        return []
        
    search_url = f"{url.rstrip('/')}/collections/{collection}/points/search"
    payload = {
        "vector": {
            "name": "dense",
            "vector": vector
        },
        "limit": limit,
        "with_payload": True
    }
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(search_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            
        results = []
        for point in data.get("result", []):
            results.append({
                "id": point.get("id"),
                "score": point.get("score"),
                "payload": point.get("payload", {})
            })
        return results
    except Exception as e:
        logger.error(f"Failed to query Qdrant memories: {e}")
        return []
