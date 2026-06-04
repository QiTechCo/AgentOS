from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, connections, personas, ws, hermes, chat, agent_os
from .auth import verify_auth_token


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .agents.handoff import get_handoff_orchestrator
    get_handoff_orchestrator().start()
    yield
    await get_handoff_orchestrator().stop()


app = FastAPI(title="Agent OS Gateway", version="0.1.0-m3", lifespan=lifespan)

# Enable CORS for Next.js dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # LAN-only in dev; restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router)
app.include_router(connections.router, dependencies=[Depends(verify_auth_token)])
app.include_router(personas.router, dependencies=[Depends(verify_auth_token)])
app.include_router(ws.router)
app.include_router(hermes.router, dependencies=[Depends(verify_auth_token)])
app.include_router(chat.router, dependencies=[Depends(verify_auth_token)])
app.include_router(agent_os.router, dependencies=[Depends(verify_auth_token)])


@app.get("/")
def root():
    return {
        "name": "Agent OS",
        "status": "online",
        "version": "0.1.0",
        "docs": "/docs"
    }
