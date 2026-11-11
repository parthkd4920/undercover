"""The UnderCover backend."""

from contextlib import asynccontextmanager, closing

from fastapi import FastAPI

from backend import database, seed


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Seed the database when it is empty."""
    with closing(database.connect()) as connection:
        seed.seed(connection)
    yield


app = FastAPI(title="UnderCover", lifespan=lifespan)


@app.get("/api/health", operation_id="health")
def health() -> dict[str, str]:
    """Check that the backend is running."""
    return {"status": "ok"}
