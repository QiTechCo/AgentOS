from fastapi import Header, HTTPException, status
from .config import get_settings


async def verify_auth_token(
    x_agent_os_token: str | None = Header(None, alias="X-Agent-OS-Token"),
    authorization: str | None = Header(None)
):
    """Dependency that checks for X-Agent-OS-Token or Authorization: Bearer header.
    Checks are skipped if AGENT_OS_AUTH_TOKEN is not set in the environment.
    """
    token = get_settings().agent_os_auth_token.strip()
    if not token:
        return
        
    if x_agent_os_token == token:
        return
        
    if isinstance(authorization, str) and authorization.startswith("Bearer "):
        if authorization[7:].strip() == token:
            return
            
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Invalid or missing Agent OS authentication token."
    )
