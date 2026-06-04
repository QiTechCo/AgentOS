import json
import logging
import httpx

from ..config import get_settings

logger = logging.getLogger("agentos.providers")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTIGRAVITY_URL = f"{GEMINI_BASE}/interactions"
ANTIGRAVITY_AGENT = "antigravity-preview-05-2026"
ANTIGRAVITY_REVISION = "2026-05-20"


class ProviderError(RuntimeError):
    pass


class ProviderDisabled(ProviderError):
    pass


def _fallback(data) -> str:
    return json.dumps(data)[:500]


async def anthropic_complete(
    prompt: str,
    model: str = "claude-3-5-sonnet-20241022",
    system: str | None = None,
    max_tokens: int = 1024,
    timeout: float = 60,
) -> str:
    key = get_settings().anthropic_api_key.strip()
    if not key:
        raise ProviderDisabled("ANTHROPIC_API_KEY not set")
    body: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system
    headers = {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(ANTHROPIC_URL, headers=headers, json=body)
        if r.status_code in (401, 403):
            raise ProviderError("anthropic unauthorized — check ANTHROPIC_API_KEY")
        r.raise_for_status()
        data = r.json()
        parts = data.get("content") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "text")
        return text or _fallback(data)
    except httpx.HTTPStatusError as e:
        raise ProviderError(f"Anthropic API error: {e.response.status_code} - {e.response.text}") from e
    except Exception as e:
        raise ProviderError(f"Anthropic error: {type(e).__name__}: {e}") from e


async def gemini_complete(
    prompt: str,
    model: str = "gemini-1.5-flash",
    system: str | None = None,
    timeout: float = 60,
) -> str:
    # Handle gemini-3.5-flash or gemini-3.5-pro model mapping in case it's not live yet
    # We will use gemini-1.5-flash/pro as a fallback if the API doesn't resolve 3.5.
    # But we will first try the model passed.
    key = get_settings().gemini_api_key.strip()
    if not key:
        raise ProviderDisabled("GEMINI_API_KEY not set")
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}]
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    
    url = f"{GEMINI_BASE}/models/{model}:generateContent"
    headers = {
        "x-goog-api-key": key,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(url, headers=headers, json=body)
        if r.status_code in (401, 403):
            raise ProviderError("gemini unauthorized — check GEMINI_API_KEY")
        r.raise_for_status()
        data = r.json()
        cand = (data.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        return text or _fallback(data)
    except httpx.HTTPStatusError as e:
        raise ProviderError(f"Gemini API error: {e.response.status_code} - {e.response.text}") from e
    except Exception as e:
        raise ProviderError(f"Gemini error: {type(e).__name__}: {e}") from e


async def antigravity_run(
    prompt: str,
    agent: str = ANTIGRAVITY_AGENT,
    timeout: float = 300,
) -> dict:
    key = get_settings().gemini_api_key.strip()
    if not key:
        raise ProviderDisabled("GEMINI_API_KEY not set (Antigravity reuses it)")
    body = {
        "agent": agent,
        "input": [{"type": "text", "text": prompt}],
        "environment": {"type": "remote"},
    }
    headers = {
        "x-goog-api-key": key,
        "Api-Revision": ANTIGRAVITY_REVISION,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(ANTIGRAVITY_URL, headers=headers, json=body)
        if r.status_code in (401, 403):
            raise ProviderError("antigravity unauthorized — check GEMINI_API_KEY")
        r.raise_for_status()
        data = r.json()
        text = data.get("output_text") or data.get("outputText") or _fallback(data)
        return {
            "reply": text,
            "interaction_id": data.get("id"),
            "environment_id": data.get("environment_id") or data.get("environmentId"),
        }
    except httpx.HTTPStatusError as e:
        raise ProviderError(f"Antigravity API error: {e.response.status_code} - {e.response.text}") from e
    except Exception as e:
        raise ProviderError(f"Antigravity error: {type(e).__name__}: {e}") from e


async def ollama_complete(
    prompt: str,
    model: str = "llama3.1",
    system: str | None = None,
    timeout: float = 120,
) -> str:
    base = get_settings().ollama_url.strip().rstrip("/")
    if not base:
        raise ProviderDisabled("OLLAMA_URL not set")
    msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{base}/api/chat", json={"model": model, "messages": msgs, "stream": False})
        r.raise_for_status()
        data = r.json()
        return (data.get("message") or {}).get("content", "") or _fallback(data)
    except Exception as e:
        raise ProviderError(f"Ollama error: {type(e).__name__}: {e}") from e
