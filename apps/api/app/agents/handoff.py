import asyncio
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

from ..config import get_settings
from .router import AgentRouter

logger = logging.getLogger("agentos.handoff")


class HandoffOrchestrator:
    def __init__(self) -> None:
        self._running = False
        self._task: Optional[asyncio.Task] = None

    def start(self) -> None:
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._loop())
            logger.info("Multi-agent Handoff Orchestrator started.")

    async def stop(self) -> None:
        if self._running:
            self._running = False
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            logger.info("Multi-agent Handoff Orchestrator stopped.")

    def _get_context_path(self) -> Path:
        d = get_settings().agent_os_dir
        d.mkdir(parents=True, exist_ok=True)
        return d / "context.json"

    def _read_context(self) -> dict:
        p = self._get_context_path()
        if not p.exists():
            return {
                "summary": "Project initialized.",
                "next_steps": [],
                "active_agent": "System Idle",
                "last_updated": datetime.now().isoformat(),
                "handoffs": []
            }
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            logger.error(f"Handoff loader failed to read context: {e}")
            return {"handoffs": []}

    def _write_context(self, ctx: dict) -> None:
        p = self._get_context_path()
        try:
            p.write_text(json.dumps(ctx, indent=2), encoding="utf-8")
        except Exception as e:
            logger.error(f"Handoff loader failed to write context: {e}")

    def _map_agent(self, name: str) -> str:
        name_lower = name.lower()
        if "claude" in name_lower or "hephaestus" in name_lower or "smith" in name_lower:
            return "hephaestus"
        if "antigravity" in name_lower or "daedalus" in name_lower or "builder" in name_lower:
            return "daedalus"
        if "apollo" in name_lower or "seeker" in name_lower:
            return "apollo"
        if "athena" in name_lower or "strategist" in name_lower:
            return "athena"
        if "mercury" in name_lower or "courier" in name_lower:
            return "mercury"
        # Default fallback to conductive/conductive-hermes
        return "hermes"

    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(5.0)
                ctx = self._read_context()
                handoffs = ctx.get("handoffs", [])
                
                # Check for any pending handoff
                pending_handoff = None
                for h in handoffs:
                    if h.get("status") == "pending":
                        pending_handoff = h
                        break
                        
                if pending_handoff:
                    logger.info(f"Processing handoff: {pending_handoff['id']} -> {pending_handoff['to_agent']}")
                    
                    # Update status to in_progress to avoid double processing
                    pending_handoff["status"] = "in_progress"
                    pending_handoff["started_at"] = datetime.now().isoformat()
                    ctx["active_agent"] = f"{pending_handoff['to_agent']} (Executing Handoff)"
                    self._write_context(ctx)
                    
                    # Resolve target persona and prepare instructions
                    persona = self._map_agent(pending_handoff["to_agent"])
                    from_agent = pending_handoff.get("from_agent", "Unknown Agent")
                    task_desc = pending_handoff.get("task", "")
                    payload = pending_handoff.get("payload", "")
                    
                    prompt = (
                        f"You have been delegated a task by {from_agent}.\n\n"
                        f"Task Description:\n{task_desc}\n\n"
                        f"Context / Parameter Payload:\n{payload}\n\n"
                        "Please perform this task against the repository workspace, log any updates "
                        "in the context, and output a detailed completion message."
                    )
                    
                    try:
                        router = AgentRouter()
                        logger.info(f"Dispatching handoff task {pending_handoff['id']} to persona '{persona}'")
                        result = await router.run(prompt, persona=persona)
                        
                        # Reload context to avoid overwriting updates that occurred during execution
                        ctx = self._read_context()
                        # Relocate our handoff item in updated context
                        for idx, item in enumerate(ctx.get("handoffs", [])):
                            if item.get("id") == pending_handoff["id"]:
                                ctx["handoffs"][idx]["status"] = "completed"
                                ctx["handoffs"][idx]["completed_at"] = datetime.now().isoformat()
                                ctx["handoffs"][idx]["result"] = result.get("reply", "")[:2000]
                                break
                                
                        ctx["active_agent"] = pending_handoff["to_agent"]
                        ctx["summary"] = f"Completed delegation to {pending_handoff['to_agent']} for task: {task_desc[:60]}..."
                        self._write_context(ctx)
                        logger.info(f"Successfully processed handoff {pending_handoff['id']}")
                        
                    except Exception as e:
                        logger.error(f"Handoff task execution failed: {e}")
                        ctx = self._read_context()
                        for idx, item in enumerate(ctx.get("handoffs", [])):
                            if item.get("id") == pending_handoff["id"]:
                                ctx["handoffs"][idx]["status"] = "failed"
                                ctx["handoffs"][idx]["completed_at"] = datetime.now().isoformat()
                                ctx["handoffs"][idx]["error"] = str(e)
                                break
                        ctx["active_agent"] = "System (Idle)"
                        self._write_context(ctx)
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Handoff loop error: {e}", exc_info=True)


# Singleton instance
_orchestrator = HandoffOrchestrator()


def get_handoff_orchestrator() -> HandoffOrchestrator:
    return _orchestrator
