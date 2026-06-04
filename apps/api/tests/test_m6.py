"""M6 unit tests — Proxmox self-observability and Goals step checklist matrix.

Run: `python -m tests.test_m6` from apps/api
"""
import os
import json
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch

os.environ["GEMINI_API_KEY"] = "gem-test"
os.environ["QDRANT_URL"] = "http://localhost:6333"

from app.config import get_settings  # noqa: E402
get_settings.cache_clear()

from app.bridges import proxmox as px  # noqa: E402
from app.mcp import server as mcp_srv  # noqa: E402


async def run_tests():
    # 1) Proxmox Node health parsing test
    mock_pvesh_json = [
        {
            "cpu": 0.085,
            "disk": 10000000000,
            "maxdisk": 100000000000,
            "mem": 4000000000,
            "maxmem": 16000000000,
            "node": "pve-test-node",
            "status": "online",
            "uptime": 172800.0  # 2 days
        }
    ]
    
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(json.dumps(mock_pvesh_json).encode("utf-8"), b""))
    
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        nodes = await px.get_nodes_health()
        assert len(nodes) == 1
        assert nodes[0].name == "proxmox_node_pve-test-node"
        assert nodes[0].ok is True
        assert "CPU 8.5%" in nodes[0].detail
        assert "MEM 25.0%" in nodes[0].detail
        assert "DISK 10.0%" in nodes[0].detail
        assert "Uptime: 2d 0h" in nodes[0].detail
        mock_exec.assert_called_once()

    # 2) Goals Step Matrix validation
    settings = get_settings()
    os.makedirs(settings.agent_os_dir, exist_ok=True)
    goals_file = settings.agent_os_dir / "goals.json"
    
    # Clean file first
    if goals_file.exists():
        os.remove(goals_file)
        
    # Add a goal
    msg1 = mcp_srv.add_goal("Scaffold Proxmox observability", "Daedalus", "2026-06-15")
    assert "New goal added" in msg1
    
    # Read goals and locate ID
    goals_data = mcp_srv._read_json("goals.json", mcp_srv.DEFAULT_GOALS)
    goal_id = goals_data["goals"][-1]["id"]
    assert goals_data["goals"][-1]["steps"] == []
    
    # Add a checklist step
    msg2 = mcp_srv.add_goal_step(goal_id, "Create proxmox.py telemetry bridge", "Hephaestus")
    assert "Added step" in msg2
    assert "assigned to Hephaestus" in msg2
    
    # Verify step exists under goal
    goals_data = mcp_srv._read_json("goals.json", mcp_srv.DEFAULT_GOALS)
    goal = goals_data["goals"][-1]
    assert len(goal["steps"]) == 1
    step_id = goal["steps"][0]["id"]
    assert goal["steps"][0]["description"] == "Create proxmox.py telemetry bridge"
    assert goal["steps"][0]["assignee"] == "Hephaestus"
    assert goal["steps"][0]["status"] == "pending"
    
    # Toggle step status
    msg3 = mcp_srv.update_goal_step_status(goal_id, step_id, "completed")
    assert "updated to completed" in msg3
    
    # Verify updated status
    goals_data = mcp_srv._read_json("goals.json", mcp_srv.DEFAULT_GOALS)
    assert goals_data["goals"][-1]["steps"][0]["status"] == "completed"

    # Clean up test files
    if goals_file.exists():
        os.remove(goals_file)
        
    print("ALL M6 PROXMOX AND STEP CHECKLIST MATRIX TESTS PASSED!")


if __name__ == "__main__":
    asyncio.run(run_tests())
