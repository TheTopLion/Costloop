from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().validate_runtime()
    yield


app = FastAPI(title="Appraise Worker", version="0.1.0", lifespan=lifespan)


@app.get("/health", tags=["operations"])
def health() -> dict[str, str]:
    settings = get_settings()
    return {"status": "ok", "environment": settings.appraise_env}


@app.get("/ready", tags=["operations"])
def ready() -> dict[str, str]:
    settings = get_settings()
    settings.validate_runtime()
    return {"status": "ready", "provider": settings.appraise_model_provider}
