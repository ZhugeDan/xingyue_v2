from contextlib import asynccontextmanager
import logging
import sqlite3

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from api.moments import router as moments_router
from api.upload import router as upload_router

logger = logging.getLogger(__name__)


def _run_migrations():
    """为存量 SQLite 数据库补充新字段，不破坏已有数据。"""
    try:
        conn = sqlite3.connect("diary.db")
        cur = conn.cursor()
        for table, col in [("moments", "location"), ("comments", "location")]:
            existing = [row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()]
            if col not in existing:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} VARCHAR(50)")
                logger.info("DB migration: added %s.%s", table, col)
        conn.commit()
        conn.close()
    except Exception as exc:
        logger.warning("DB migration failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    yield


app = FastAPI(title="Diary API", version="1.0.0", lifespan=lifespan)

# CORS — allow Vite dev server and same-origin production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(moments_router)
app.include_router(upload_router)


@app.get("/health")
def health():
    return {"status": "ok"}
