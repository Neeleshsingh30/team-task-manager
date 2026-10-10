from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.api.auth import auth_router, authorize_request, realtime_router
from app.api.crud import router as crud_router


api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(realtime_router)
api_router.include_router(crud_router, dependencies=[Depends(authorize_request)])


@api_router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/health/db")
def database_health_check(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database connection failed") from exc
    return {"status": "ok", "database": "connected"}
