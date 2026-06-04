import asyncio
import json
import logging
import time
from typing import List

from ..config import get_settings
from .base import Health

logger = logging.getLogger("agentos.proxmox")


def _format_uptime(seconds: float) -> str:
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    if days > 0:
        return f"{days}d {hours}h"
    return f"{hours}h"


async def get_nodes_health() -> List[Health]:
    """Queries Proxmox host for cluster node statistics and returns Health entries."""
    settings = get_settings()
    host = settings.proxmox_ssh_host
    user = settings.proxmox_ssh_user

    if not host:
        return [Health(name="proxmox", ok=False, enabled=False, detail="PROXMOX_SSH_HOST not set")]

    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        f"{user}@{host}",
        "pvesh get /nodes --output-format json"
    ]

    t0 = time.perf_counter()
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL
        )
        
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
        ms = int((time.perf_counter() - t0) * 1000)

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8").strip()
            logger.error(f"Proxmox nodes query failed: {err_msg}")
            return [Health(name="proxmox", ok=False, detail=f"SSH failed: {err_msg[:60]}")]

        data = json.loads(stdout.decode("utf-8"))
        health_entries = []

        for node_data in data:
            node_name = node_data.get("node", "unknown")
            status = node_data.get("status", "offline")
            is_online = status == "online"
            
            if is_online:
                cpu = node_data.get("cpu", 0.0)
                mem = node_data.get("mem", 0)
                maxmem = node_data.get("maxmem", 1)
                disk = node_data.get("disk", 0)
                maxdisk = node_data.get("maxdisk", 1)
                uptime = node_data.get("uptime", 0.0)

                cpu_pct = f"{cpu * 100:.1f}"
                mem_pct = f"{(mem / maxmem) * 100:.1f}"
                disk_pct = f"{(disk / maxdisk) * 100:.1f}"
                uptime_str = _format_uptime(uptime)

                detail = f"CPU {cpu_pct}%, MEM {mem_pct}%, DISK {disk_pct}% (Uptime: {uptime_str})"
            else:
                detail = f"Node status is {status}"

            health_entries.append(Health(
                name=f"proxmox_node_{node_name}",
                ok=is_online,
                detail=detail,
                latency_ms=ms
            ))

        return health_entries

    except asyncio.TimeoutError:
        logger.error("Proxmox nodes query timed out.")
        return [Health(name="proxmox", ok=False, detail="SSH request timed out")]
    except Exception as e:
        logger.error(f"Proxmox health probe failed: {e}")
        return [Health(name="proxmox", ok=False, detail=f"{type(e).__name__}: {e}")]
