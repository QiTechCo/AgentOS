from fastapi import APIRouter
from ..agents.router import AgentRouter

router = APIRouter(prefix="/personas", tags=["personas"])


@router.get("")
def list_personas():
    return {"personas": AgentRouter().list_personas()}
