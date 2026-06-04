import asyncio
import json
import logging
from typing import AsyncGenerator, Optional

from ..config import get_settings

logger = logging.getLogger("agentos.hermes_acp")


class HermesACPClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.host = settings.proxmox_ssh_host
        self.user = settings.proxmox_ssh_user
        self.lxc_id = settings.hermes_lxc_id
        self.python_path = settings.hermes_python_path

    async def stream_prompt(self, prompt: str, session_id: Optional[str] = None) -> AsyncGenerator[dict, None]:
        """Spawn the remote Hermes ACP server, create/load a session, send prompt, and stream results.
        
        Yields dictionaries representing typed JSON-RPC events:
        - {"type": "session_created", "session_id": "..."}
        - {"type": "chunk", "text": "..."}
        - {"type": "done", "usage": {...}}
        - {"type": "error", "message": "..."}
        """
        cmd = [
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            f"{self.user}@{self.host}",
            f"pct exec {self.lxc_id} -- {self.python_path} -m hermes_cli.main acp --accept-hooks"
        ]

        logger.info(f"Connecting to Hermes ACP over SSH: {' '.join(cmd)}")
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        async def send_rpc(method: str, params: dict, req_id: int) -> None:
            req = {
                "jsonrpc": "2.0",
                "id": req_id,
                "method": method,
                "params": params
            }
            payload = json.dumps(req) + "\n"
            proc.stdin.write(payload.encode("utf-8"))
            await proc.stdin.drain()

        try:
            # 1) Handshake
            await send_rpc("initialize", {
                "protocolVersion": 1,
                "clientInfo": {"name": "AgentOS", "version": "0.1.0"},
                "workspaceFolders": [{"uri": "file:///root", "name": "root"}],
                "capabilities": {}
            }, req_id=1)

            # Wait for initialize response
            init_line = await asyncio.wait_for(proc.stdout.readline(), timeout=15.0)
            if not init_line:
                yield {"type": "error", "message": "Handshake failed: server EOF"}
                return
            init_res = json.loads(init_line.decode("utf-8"))
            if "error" in init_res:
                yield {"type": "error", "message": f"Handshake failed: {init_res['error'].get('message')}"}
                return

            # 2) Session logic: Resume or Create
            active_session_id = session_id
            if not active_session_id:
                # Create new session
                await send_rpc("session/new", {
                    "cwd": "/root",
                    "name": "AgentOS Dynamic Session",
                    "mcpServers": []
                }, req_id=2)

                session_line = await asyncio.wait_for(proc.stdout.readline(), timeout=15.0)
                if not session_line:
                    yield {"type": "error", "message": "Session creation failed: server EOF"}
                    return
                session_res = json.loads(session_line.decode("utf-8"))
                if "error" in session_res:
                    yield {"type": "error", "message": f"Session creation failed: {session_res['error'].get('message')}"}
                    return
                active_session_id = session_res.get("result", {}).get("sessionId")
                if not active_session_id:
                    yield {"type": "error", "message": "Session creation failed: no sessionId returned"}
                    return

            yield {"type": "session_created", "session_id": active_session_id}

            # 3) Send prompt
            await send_rpc("session/prompt", {
                "sessionId": active_session_id,
                "prompt": [{"type": "text", "text": prompt}]
            }, req_id=3)

            # 4) Listen to the stream
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                
                msg = json.loads(line.decode("utf-8").strip())
                
                # Check for updates or result responses
                if "method" in msg and msg["method"] == "session/update":
                    update_data = msg.get("params", {}).get("update", {})
                    update_type = update_data.get("sessionUpdate")
                    
                    if update_type == "agent_message_chunk":
                        content = update_data.get("content", {})
                        text = content.get("text", "")
                        if text:
                            yield {"type": "chunk", "text": text}
                
                elif "id" in msg and msg["id"] == 3:
                    # Final result response to the prompt request
                    if "error" in msg:
                        yield {"type": "error", "message": msg["error"].get("message")}
                    else:
                        yield {"type": "done", "usage": msg.get("result", {}).get("usage", {})}
                    break
                    
        except asyncio.TimeoutError as e:
            logger.error(f"ACP connection timed out: {e}")
            yield {"type": "error", "message": "Request timed out waiting for remote agent response."}
        except Exception as e:
            logger.error(f"ACP error: {e}")
            yield {"type": "error", "message": f"ACP communication error: {type(e).__name__}: {e}"}
        finally:
            # Terminate SSH process cleanly
            proc.terminate()
            await proc.wait()
