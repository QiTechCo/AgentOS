import time
from typing import Any

import httpx

from ..config import get_settings
from .base import Health


def _base() -> str:
    return get_settings().hermes_mcp_url.strip().rstrip("/")


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    key = get_settings().hermes_mcp_api_key.strip()
    if key:
        h["Authorization"] = f"Bearer {key}"
    return h


class HermesError(RuntimeError):
    pass


class HermesDisabled(HermesError):
    pass


async def health() -> Health:
    base = _base()
    if not base:
        return Health(name="hermes", ok=False, enabled=False, detail="HERMES_MCP_URL not set")
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{base}/openapi.json")
        ms = int((time.perf_counter() - t0) * 1000)
        n = len(r.json().get("paths", {})) if r.status_code == 200 else 0
        return Health(name="hermes", ok=r.status_code == 200, detail=f"HTTP {r.status_code}, {n} tools", latency_ms=ms)
    except Exception as e:  # noqa: BLE001
        return Health(name="hermes", ok=False, detail=f"{type(e).__name__}: {e}")


def _first(obj: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(obj, dict):
        for k in keys:
            if k in obj and obj[k] is not None:
                return obj[k]
        for v in obj.values():
            found = _first(v, keys)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _first(item, keys)
            if found is not None:
                return found
    return None


def _best_reply(messages: Any) -> str | None:
    rows = messages
    if isinstance(messages, dict):
        rows = messages.get("messages") or messages.get("items") or messages.get("data") or []
    if not isinstance(rows, list):
        return None
    for m in reversed(rows):
        if not isinstance(m, dict):
            continue
        role = (m.get("role") or m.get("sender") or "").lower()
        if role in ("user", "human"):
            continue
        text = m.get("content") or m.get("text") or m.get("message")
        if isinstance(text, str) and text.strip():
            return text
    return None


class HermesClient:
    def __init__(self, base: str | None = None, timeout: float = 30.0) -> None:
        self.base = base if base is not None else _base()
        self.timeout = timeout

    async def _call(self, tool: str, payload: dict) -> Any:
        if not self.base:
            raise HermesDisabled("HERMES_MCP_URL not set")
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            r = await c.post(f"{self.base}/{tool}", headers=_headers(), json=payload)
        if r.status_code == 401:
            raise HermesError("unauthorized — check HERMES_MCP_API_KEY")
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            return r.text

    async def list_conversations(self, platform: str | None = None, limit: int = 20, search: str | None = None) -> Any:
        p: dict = {"limit": limit}
        if platform:
            p["platform"] = platform
        if search:
            p["search"] = search
        return await self._call("conversations_list", p)

    async def read_messages(self, session_key: str, limit: int = 20) -> Any:
        return await self._call("messages_read", {"session_key": session_key, "limit": limit})

    async def conversation_get(self, session_key: str) -> Any:
        return await self._call("conversation_get", {"session_key": session_key})

    async def channels_list(self, platform: str | None = None) -> Any:
        return await self._call("channels_list", {"platform": platform} if platform else {})

    async def poll_events(self, session_key: str | None = None, after_cursor: int | None = None, limit: int = 50) -> Any:
        p: dict = {"limit": limit}
        if session_key is not None:
            p["session_key"] = session_key
        if after_cursor is not None:
            p["after_cursor"] = after_cursor
        return await self._call("events_poll", p)

    async def wait_events(self, session_key: str | None = None, after_cursor: int | None = None, timeout_ms: int = 20000) -> Any:
        p: dict = {"timeout_ms": timeout_ms}
        if session_key is not None:
            p["session_key"] = session_key
        if after_cursor is not None:
            p["after_cursor"] = after_cursor
        return await self._call("events_wait", p)

    async def send_message(self, target: str, message: str) -> dict:
        if not target:
            raise HermesError("send_message requires an explicit target (e.g. 'telegram:<chat_id>')")
        return await self._call("messages_send", {"target": target, "message": message})

    @staticmethod
    def session_key_for(platform: str, chat_id: str, chat_type: str = "dm") -> str:
        return f"agent:main:{platform}:{chat_type}:{chat_id}"

    async def latest_assistant_message(self, session_key: str, limit: int = 10) -> str | None:
        return _best_reply(await self.read_messages(session_key, limit=limit))
