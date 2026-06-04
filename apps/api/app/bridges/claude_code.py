import asyncio
import os
import logging
from typing import Optional

from ..config import get_settings

logger = logging.getLogger("agentos.claude_code")


class ClaudeCodeClient:
    def __init__(self) -> None:
        pass

    async def run_prompt(self, prompt: str, timeout_sec: int = 300) -> str:
        """Run a non-interactive coding task using Claude Code CLI against the repository.
        """
        # Look for the binary path of Claude Code CLI
        binary_path = "/Users/user/.local/bin/claude"
        if not os.path.exists(binary_path):
            logger.warning(f"Claude Code binary not found at {binary_path}. Falling back to npx.")
            cmd = ["npx", "@anthropic-ai/claude-code"]
        else:
            cmd = [binary_path]
            
        cmd.extend([
            "--print", 
            "--dangerously-skip-permissions",
            "--tools", "default",
            "-p", prompt
        ])

        env = os.environ.copy()
        settings = get_settings()
        api_key = settings.anthropic_api_key.strip()
        if api_key:
            env["ANTHROPIC_API_KEY"] = api_key

        logger.info(f"Spawning Claude Code headless process: {' '.join(cmd)}")
        
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
            cwd=str(settings.root_dir)
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=float(timeout_sec))
            out_str = stdout.decode("utf-8").strip()
            err_str = stderr.decode("utf-8").strip()
            
            if proc.returncode != 0:
                logger.error(f"Claude Code failed with code {proc.returncode}. Stderr: {err_str}")
                if "You're out of extra usage" in err_str or "You're out of extra usage" in out_str:
                    return f"Error: Claude Code is out of usage limits. Details: {out_str or err_str}"
                return f"Error: {err_str or out_str or f'Exit code {proc.returncode}'}"
                
            return out_str
        except asyncio.TimeoutError:
            try:
                proc.terminate()
                await proc.wait()
            except Exception as e:
                logger.error(f"Failed to terminate timed out Claude Code process: {e}")
            raise RuntimeError("Claude Code process timed out.")
