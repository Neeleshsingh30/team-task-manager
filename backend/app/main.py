from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.auth import workspace_connections
from app.core.config import get_settings


settings = get_settings()

app = FastAPI(
    title="Team Task Manager API",
    version="0.1.0",
)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "Team Task Manager API is running",
        "docs": "/docs",
        "health": "/api/health",
    }


app.include_router(api_router, prefix="/api")


@app.middleware("http")
async def publish_workspace_changes(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") and request.method in {"POST", "PUT", "PATCH", "DELETE"} and response.status_code < 400:
        await workspace_connections.broadcast_refresh()
    return response


# Register CORS last so Starlette puts it outside the custom HTTP middleware.
# Preflight OPTIONS requests can then be answered before they enter app logic.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
