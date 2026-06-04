import os
import sqlite3
import time

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
