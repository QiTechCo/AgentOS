import os
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..config import get_settings
from ..mcp import server as mcp_srv

router = APIRouter(prefix="/agent_os", tags=["agent_os"])


class ContextUpdateRequest(BaseModel):
    summary: str
    next_steps: List[str]
    active_agent: str


class StandardProposeRequest(BaseModel):
    category: str
    rule: str


class GoalCreateRequest(BaseModel):
    description: str
    owner: str
    target_date: str


class GoalStatusUpdateRequest(BaseModel):
    status: str


class ArtifactCreateRequest(BaseModel):
    filename: str
    content: str


@router.get("/context")
def get_context():
    return mcp_srv._read_json("context.json", mcp_srv.DEFAULT_CONTEXT)


@router.post("/context")
def update_context(req: ContextUpdateRequest):
    mcp_srv.update_shared_context(req.summary, req.next_steps, req.active_agent)
    return {"message": "Context updated"}


@router.get("/standards")
def get_standards():
    return mcp_srv._read_json("standards.json", mcp_srv.DEFAULT_STANDARDS)


@router.post("/standards")
def propose_standard(req: StandardProposeRequest):
    msg = mcp_srv.propose_standard(req.category, req.rule)
    return {"message": msg}


@router.get("/goals")
def get_goals():
    data = mcp_srv._read_json("goals.json", mcp_srv.DEFAULT_GOALS)
    return {"goals": data.get("goals", [])}


@router.post("/goals")
def create_goal(req: GoalCreateRequest):
    msg = mcp_srv.add_goal(req.description, req.owner, req.target_date)
    return {"message": msg}


@router.post("/goals/{goal_id}/status")
def update_goal_status(goal_id: str, req: GoalStatusUpdateRequest):
    msg = mcp_srv.update_goal_status(goal_id, req.status)
    return {"message": msg}


@router.get("/artifacts")
def list_artifacts():
    d = get_settings().agent_os_dir / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    files = []
    for f in os.listdir(d):
        if f == ".gitkeep":
            continue
        p = d / f
        if p.is_file():
            stat = p.stat()
            files.append({
                "name": f,
                "size_bytes": stat.st_size,
                "modified_at": stat.st_mtime
            })
    return {"artifacts": sorted(files, key=lambda x: x["modified_at"], reverse=True)}


@router.get("/artifacts/{filename}")
def get_artifact(filename: str):
    d = get_settings().agent_os_dir / "artifacts"
    p = d / filename
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")
    
    # Check if we should render it as text/html or standard file response
    # Natively previewable files: html, md, txt, json
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".html", ".htm"):
        return FileResponse(p, media_type="text/html")
    elif ext in (".md", ".markdown"):
        return FileResponse(p, media_type="text/markdown")
    elif ext in (".txt", ".json"):
        return FileResponse(p, media_type="text/plain")
    return FileResponse(p)


@router.post("/artifacts")
def write_artifact(req: ArtifactCreateRequest):
    """Write a new artifact file to the shared workspace (Filing Cabinet).
    Used to verify the 'Dana White' workflow where HTML assets are created dynamically.
    """
    d = get_settings().agent_os_dir / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    p = d / req.filename
    try:
        with open(p, "w", encoding="utf-8") as f:
            f.write(req.content)
        return {"message": f"Artifact {req.filename} written successfully.", "path": str(p)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write artifact: {e}")
