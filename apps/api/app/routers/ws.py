import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Send live heartbeat ticks every 5s. In future releases, this is pushed
            # dynamically by event listeners and file watchers.
            await websocket.send_json({"type": "tick", "status": "active"})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
