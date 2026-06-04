import logging
from pathlib import Path
import yaml

from ..config import get_settings

logger = logging.getLogger("agentos.router")


class AgentRouter:
    def __init__(self) -> None:
        self._cfg = self._load()

    def _load(self) -> dict:
        path = Path(get_settings().personas_file)
        if not path.exists():
            logger.warning(f"Personas configuration file not found at {path}. Using empty personas list.")
            return {"personas": {}}
        try:
            return yaml.safe_load(path.read_text()) or {"personas": {}}
        except Exception as e:
            logger.error(f"Failed to parse personas yaml: {e}")
            return {"personas": {}}

    def list_personas(self) -> list[dict]:
        out = []
        for name, p in (self._cfg.get("personas") or {}).items():
            out.append({"name": name, **p})
        return out

    def _personas(self) -> dict:
        return self._cfg.get("personas") or {}

    def get_persona(self, name: str | None) -> dict:
        personas = self._personas()
        if name:
            if name not in personas:
                raise KeyError(f"unknown persona '{name}'")
            return {"name": name, **personas[name]}
        for n, p in personas.items():  # default persona
            if p.get("default"):
                return {"name": n, **p}
        raise KeyError("no default persona configured")

    async def run(self, message: str, persona: str | None = None, timeout_ms: int = 300000) -> dict:
        """Dispatch a cognition turn (prompt -> response) to a persona's backend.
        
        Supported backends:
        - anthropic: Claude completions (for Hephaestus/Athena)
        - gemini: Gemini API generateContent (Apollo/Athena/Mercury)
        - antigravity: Gemini Managed Agents API (Daedalus)
        - ollama: Local model API (Mercury local fallback)
        """
        from ..bridges import providers as pv

        p = self.get_persona(persona)
        backend = p.get("backend", "")
        model = p.get("model")
        base = {"persona": p["name"], "backend": backend}

        # Map models to safe live identifiers if the user requests 3.5 variants, but fall back gracefully
        model_str = model
        if backend == "gemini" and model_str:
            if "3.5-pro" in model_str:
                model_str = "gemini-1.5-pro"
            elif "3.5-flash" in model_str:
                model_str = "gemini-1.5-flash"

        from ..bridges.audit import log_audit
        log_audit("cognition_start", p["name"], f"Querying model '{model_str or model}' via backend '{backend}' for: '{message[:100]}...'")

        logger.info(f"Routing prompt for persona '{p['name']}' to backend '{backend}' using model '{model_str}'")

        res = None
        if backend == "anthropic":
            reply = await pv.anthropic_complete(
                message, 
                model=model_str or "claude-3-5-sonnet-20241022",
                timeout=timeout_ms / 1000.0
            )
            res = {**base, "model": model_str or "claude-3-5-sonnet-20241022", "reply": reply}
            
        elif backend == "gemini":
            reply = await pv.gemini_complete(
                message, 
                model=model_str or "gemini-1.5-flash",
                timeout=timeout_ms / 1000.0
            )
            res = {**base, "model": model_str or "gemini-1.5-flash", "reply": reply}
            
        elif backend == "antigravity":
            agent_id = pv.ANTIGRAVITY_AGENT
            out = await pv.antigravity_run(
                message, 
                agent=agent_id,
                timeout=timeout_ms / 1000.0
            )
            res = {**base, "agent": agent_id, **out}
            
        elif backend == "ollama":
            reply = await pv.ollama_complete(
                message, 
                model=model_str or "llama3.1",
                timeout=timeout_ms / 1000.0
            )
            res = {**base, "model": model_str or "llama3.1", "reply": reply}
            
        elif backend == "hermes_mcp":
            from ..bridges.hermes_acp import HermesACPClient
            client = HermesACPClient()
            reply_chunks = []
            logger.info(f"Invoking remote Hermes ACP for persona '{p['name']}' cognition turn...")
            async for event in client.stream_prompt(message):
                if event.get("type") == "chunk":
                    reply_chunks.append(event.get("text", ""))
                elif event.get("type") == "error":
                    raise pv.ProviderError(event.get("message", "ACP Error"))
            reply = "".join(reply_chunks)
            res = {**base, "model": "hermes-acp", "reply": reply}
            
        elif backend == "claude_code":
            from ..bridges.claude_code import ClaudeCodeClient
            client = ClaudeCodeClient()
            reply = await client.run_prompt(message, timeout_sec=int(timeout_ms / 1000.0))
            res = {**base, "model": "claude-code-cli", "reply": reply}
            
        else:
            raise NotImplementedError(f"persona '{p['name']}' backend '{backend}' is not supported")

        # Log completion output
        res_text = res.get("reply", "")
        log_audit("cognition_end", p["name"], f"Response (model: {res.get('model', res.get('agent', 'unknown'))}): '{res_text[:120]}...'")
        return res

    def provider_status(self) -> list[dict]:
        s = get_settings()
        configured = {
            "anthropic": bool(s.anthropic_api_key),
            "gemini": bool(s.gemini_api_key),
            "antigravity": bool(s.gemini_api_key),
            "ollama": bool(s.ollama_url),
        }
        seen, rows = set(), []
        for p in self.list_personas():
            backend = p.get("backend", "")
            if backend in configured and backend not in seen:
                seen.add(backend)
                rows.append({
                    "name": backend,
                    "ok": configured[backend],
                    "enabled": configured[backend],
                    "detail": "configured" if configured[backend] else "no key set",
                    "latency_ms": None,
                })
        return rows
