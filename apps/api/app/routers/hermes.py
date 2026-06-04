import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..bridges.hermes_mcp import HermesClient, HermesError, HermesDisabled
from ..bridges.hermes_acp import HermesACPClient

router = APIRouter(prefix="/hermes", tags=["hermes"])


class SendRequest(BaseModel):
    target: str
    message: str


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HermesDisabled):
        return HTTPException(status_code=503, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


@router.get("/conversations")
async def conversations(platform: str | None = None, limit: int = 20):
    try:
        return await HermesClient().list_conversations(platform=platform, limit=limit)
    except HermesError as e:
        raise _http(e)


@router.get("/session/{session_key}")
async def session(session_key: str, limit: int = 20):
    try:
        return await HermesClient().read_messages(session_key, limit=limit)
    except HermesError as e:
        raise _http(e)


@router.get("/events")
async def events(session_key: str | None = None, limit: int = 50):
    try:
        return await HermesClient().poll_events(session_key=session_key, limit=limit)
    except HermesError as e:
        raise _http(e)


@router.post("/send")
async def send(req: SendRequest):
    try:
        return await HermesClient().send_message(req.target, req.message)
    except HermesDisabled as e:
        raise HTTPException(status_code=503, detail=str(e))
    except HermesError as e:
        raise HTTPException(status_code=400, detail=str(e))


class ACPPromptRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = None


@router.post("/acp/prompt")
async def acp_prompt(req: ACPPromptRequest):
    client = HermesACPClient()
    
    async def generator():
        async for event in client.stream_prompt(req.prompt, req.session_id):
            yield f"data: {json.dumps(event)}\n\n"
            
    return StreamingResponse(generator(), media_type="text/event-stream")
