import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional
from mcp.server.fastmcp import FastMCP

from ..config import get_settings

logger = logging.getLogger("agentos.mcp")

# Initialize FastMCP Server
mcp = FastMCP("AgentOS-MCP")


# Helper functions to manage the .agent_os workspace directory
def _get_os_dir() -> Path:
    d = get_settings().agent_os_dir
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_json(filename: str, default_val: Any) -> Any:
    path = _get_os_dir() / filename
    if not path.exists():
        with open(path, "w") as f:
            json.dump(default_val, f, indent=2)
        return default_val
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading {filename}: {e}")
        return default_val


def _write_json(filename: str, data: Any) -> None:
    path = _get_os_dir() / filename
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Error writing {filename}: {e}")


# Define standard schemas
DEFAULT_CONTEXT = {
    "summary": "Project initialized.",
    "next_steps": ["Define goals", "Establish coding standards"],
    "active_agent": "AgentOS System",
    "last_updated": datetime.now().isoformat(),
    "history": []
}

DEFAULT_STANDARDS = {
    "general": [
        "Maintain absolute codebase cleanlines and strict module boundaries.",
        "Keep environment configuration isolated in .env."
    ],
    "python": [
        "Use async/await for I/O bound tasks.",
        "Include docstrings and types for all functions."
    ],
    "javascript": [
        "Prefer functional components in React and clean, descriptive custom hooks.",
        "Use semantic HTML elements and CSS variables for theming."
    ]
}

DEFAULT_GOALS = {
    "goals": [
        {
            "id": str(uuid.uuid4())[:8],
            "description": "Establish Unified Agentic OS skeleton and UI",
            "owner": "Antigravity",
            "status": "in_progress",
            "target_date": "2026-06-15",
            "created_at": datetime.now().isoformat()
        }
    ]
}


@mcp.tool()
def read_shared_context() -> str:
    """Read the unified project context, active goals, and developer standards files.
    Returns a unified JSON string containing all shared states.
    """
    ctx = _read_json("context.json", DEFAULT_CONTEXT)
    std = _read_json("standards.json", DEFAULT_STANDARDS)
    goals = _read_json("goals.json", DEFAULT_GOALS)
    
    res = {
        "context": ctx,
        "standards": std,
        "goals": goals.get("goals", [])
    }
    return json.dumps(res, indent=2)


@mcp.tool()
def update_shared_context(summary: str, next_steps: List[str], active_agent: str) -> str:
    """Update the shared project context with current progress, next steps, and the active agent ownership.
    
    Args:
        summary: High-level summary of the current work status or progress.
        next_steps: List of immediate next steps for execution.
        active_agent: The agent currently taking ownership (e.g., 'Hermes', 'Claude Code', 'Antigravity').
    """
    ctx = _read_json("context.json", DEFAULT_CONTEXT)
    
    # Save past context to history (limit to last 5 entries)
    if "history" not in ctx:
        ctx["history"] = []
    
    ctx["history"].append({
        "summary": ctx.get("summary"),
        "next_steps": ctx.get("next_steps"),
        "active_agent": ctx.get("active_agent"),
        "updated_at": ctx.get("last_updated")
    })
    ctx["history"] = ctx["history"][-5:]
    
    # Update values
    ctx["summary"] = summary
    ctx["next_steps"] = next_steps
    ctx["active_agent"] = active_agent
    ctx["last_updated"] = datetime.now().isoformat()
    
    _write_json("context.json", ctx)
    return "Shared context updated successfully."


@mcp.tool()
def propose_standard(category: str, rule: str) -> str:
    """Propose or append a developer coding standard rule under a category.
    
    Args:
        category: The category (e.g., 'general', 'python', 'javascript', 'css').
        rule: The specific developer rule or guideline.
    """
    std = _read_json("standards.json", DEFAULT_STANDARDS)
    
    cat = category.lower().strip()
    if cat not in std:
        std[cat] = []
        
    if rule not in std[cat]:
        std[cat].append(rule)
        _write_json("standards.json", std)
        return f"Standard rule added under category '{category}'."
    return "Standard rule already exists."


@mcp.tool()
def add_goal(description: str, owner: str, target_date: str) -> str:
    """Add a new mid-term or long-term goal or sub-task to the project tracker.
    
    Args:
        description: Description of the goal or task.
        owner: The owner responsible (e.g., 'Human', 'Hermes', 'Claude Code', 'Antigravity').
        target_date: Target completion date (YYYY-MM-DD).
    """
    goals_data = _read_json("goals.json", DEFAULT_GOALS)
    goal_id = str(uuid.uuid4())[:8]
    
    new_goal = {
        "id": goal_id,
        "description": description,
        "owner": owner,
        "status": "pending",
        "target_date": target_date,
        "created_at": datetime.now().isoformat()
    }
    
    if "goals" not in goals_data:
        goals_data["goals"] = []
        
    goals_data["goals"].append(new_goal)
    _write_json("goals.json", goals_data)
    return f"New goal added with ID: {goal_id}."


@mcp.tool()
def update_goal_status(goal_id: str, status: str) -> str:
    """Update the status of a specific goal in the goals tracker.
    
    Args:
        goal_id: The unique ID of the goal.
        status: The new status ('pending', 'in_progress', 'completed').
    """
    goals_data = _read_json("goals.json", DEFAULT_GOALS)
    
    found = False
    for g in goals_data.get("goals", []):
        if g.get("id") == goal_id:
            g["status"] = status
            g["updated_at"] = datetime.now().isoformat()
            found = True
            break
            
    if found:
        _write_json("goals.json", goals_data)
        return f"Goal {goal_id} status updated to {status}."
    return f"Goal with ID {goal_id} not found."


@mcp.tool()
def handoff_task(target_agent: str, task_description: str, context_payload: str) -> str:
    """Log a task handoff from the current agent to a target agent to coordinate multi-agent workflows.
    
    Args:
        target_agent: The receiving agent ('Hermes', 'Claude Code', 'Antigravity').
        task_description: Summary of the task they are expected to do.
        context_payload: Critical memory, directories, or state details they need.
    """
    ctx = _read_json("context.json", DEFAULT_CONTEXT)
    
    # Update active agent and add handoff logs
    handoff_entry = {
        "timestamp": datetime.now().isoformat(),
        "from_agent": ctx.get("active_agent", "Unknown"),
        "to_agent": target_agent,
        "task": task_description,
        "payload": context_payload
    }
    
    ctx["active_agent"] = f"Handoff to {target_agent}"
    if "handoffs" not in ctx:
        ctx["handoffs"] = []
    ctx["handoffs"].append(handoff_entry)
    ctx["handoffs"] = ctx["handoffs"][-10:] # limit log to last 10 entries
    
    _write_json("context.json", ctx)
    return f"Handoff to {target_agent} recorded."


if __name__ == "__main__":
    # When executed directly, run as stdio server
    mcp.run()
