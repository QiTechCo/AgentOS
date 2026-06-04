from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..agents.router import AgentRouter
from ..bridges.providers import ProviderError, ProviderDisabled

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    persona: Optional[str] = None


@router.post("")
async def chat(req: ChatRequest):
    try:
        return await AgentRouter().run(req.message, persona=req.persona)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NotImplementedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ProviderDisabled as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ProviderError as e:
        raise HTTPException(status_code=502, detail=str(e))
