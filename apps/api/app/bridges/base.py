from typing import Optional
from pydantic import BaseModel


class Health(BaseModel):
    name: str
    ok: bool
    enabled: bool = True
    detail: str = ""
    latency_ms: Optional[int] = None
