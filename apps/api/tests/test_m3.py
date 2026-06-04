"""M3 unit tests — cognition providers + AgentRouter dispatch for Gemini-centric Pantheon.

Mocks providers.httpx.AsyncClient: no network, no real API calls, no keys needed.
Run: `python -m tests.test_m3` from apps/api
"""
import os
import asyncio

os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test"
os.environ["GEMINI_API_KEY"] = "gem-test"

from app.config import get_settings  # noqa: E402
get_settings.cache_clear()

from app.bridges import providers as pv  # noqa: E402
from app.agents.router import AgentRouter  # noqa: E402

CALLS = []


class FakeResp:
    def __init__(self, status=200, json_data=None):
        self.status_code = status
        self._json = json_data

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _route(url):
    if "api.anthropic.com" in url:
        return FakeResp(200, {"content": [{"type": "text", "text": "claude-says-hi"}]})
    if "/interactions" in url:
        return FakeResp(200, {"id": "int_1", "environment_id": "env_1", "output_text": "antigravity-done"})
    if ":generateContent" in url:
        return FakeResp(200, {"candidates": [{"content": {"parts": [{"text": "gemini-says-hi"}]}}]})
    if "/api/chat" in url:
        return FakeResp(200, {"message": {"content": "ollama-says-hi"}})
    return FakeResp(404, {})


class FakeClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        CALLS.append(("POST", url, headers or {}, json or {}))
        return _route(url)


# Monkeypatch httpx in providers bridge
pv.httpx.AsyncClient = FakeClient


async def run_tests():
    # 1) Claude: correct endpoint + auth header + parse
    CALLS.clear()
    out = await pv.anthropic_complete("hi", model="claude-3-5-sonnet-20241022")
    _, url, headers, body = CALLS[-1]
    assert url == pv.ANTHROPIC_URL, url
    assert headers["x-api-key"] == "sk-ant-test" and headers["anthropic-version"] == pv.ANTHROPIC_VERSION
    assert body["model"] == "claude-3-5-sonnet-20241022" and body["messages"][0]["content"] == "hi"
    assert out == "claude-says-hi"

    # 2) Gemini: generateContent URL + x-goog-api-key + parse
    CALLS.clear()
    out = await pv.gemini_complete("hi", model="gemini-1.5-flash")
    _, url, headers, body = CALLS[-1]
    assert url.endswith("/models/gemini-1.5-flash:generateContent"), url
    assert headers["x-goog-api-key"] == "gem-test"
    assert body["contents"][0]["parts"][0]["text"] == "hi"
    assert out == "gemini-says-hi"

    # 3) Antigravity: interactions endpoint + Api-Revision + agent/input/environment shape
    CALLS.clear()
    res = await pv.antigravity_run("build me a thing")
    _, url, headers, body = CALLS[-1]
    assert url == pv.ANTIGRAVITY_URL and headers["Api-Revision"] == pv.ANTIGRAVITY_REVISION
    assert body["agent"] == pv.ANTIGRAVITY_AGENT
    assert body["input"] == [{"type": "text", "text": "build me a thing"}]
    assert body["environment"] == {"type": "remote"}
    assert res["reply"] == "antigravity-done" and res["interaction_id"] == "int_1" and res["environment_id"] == "env_1"

    # 4) Router dispatch by persona (Our Gemini-centric configs)
    r = AgentRouter()
    
    # Athena is gemini (gemini-3.5-pro mapped to gemini-1.5-pro)
    CALLS.clear()
    athena_res = await r.run("hi", persona="athena")
    assert athena_res["reply"] == "gemini-says-hi"
    assert athena_res["model"] == "gemini-1.5-pro"
    
    # Apollo is gemini (gemini-3.5-flash mapped to gemini-1.5-flash)
    CALLS.clear()
    apollo_res = await r.run("hi", persona="apollo")
    assert apollo_res["reply"] == "gemini-says-hi"
    assert apollo_res["model"] == "gemini-1.5-flash"
    
    # Daedalus is Antigravity
    CALLS.clear()
    daedalus_res = await r.run("hi", persona="daedalus")
    assert daedalus_res["reply"] == "antigravity-done"
    assert daedalus_res["agent"] == pv.ANTIGRAVITY_AGENT

    # Mercury is gemini (gemini-3.5-flash mapped to gemini-1.5-flash)
    CALLS.clear()
    mercury_res = await r.run("hi", persona="mercury")
    assert mercury_res["reply"] == "gemini-says-hi"
    assert mercury_res["model"] == "gemini-1.5-flash"

    # 5) Non-cognition backends still error clearly
    for persona, needle in (("hermes", "i/o"), ("hephaestus", "claude code")):
        try:
            await r.run("hi", persona=persona)
            assert False, f"expected NotImplementedError for {persona}"
        except NotImplementedError as e:
            assert needle in str(e).lower(), str(e)

    # 6) Disabled when key missing
    os.environ.pop("GEMINI_API_KEY", None)
    get_settings.cache_clear()
    try:
        await pv.gemini_complete("hi")
        assert False, "expected ProviderDisabled"
    except pv.ProviderDisabled:
        pass
    finally:
        os.environ["GEMINI_API_KEY"] = "gem-test"
        get_settings.cache_clear()

    print("ALL AGENT OS PANTHEON TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(run_tests())
