from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class MediaItem(BaseModel):
    url: str = Field(..., min_length=1, max_length=1000)
    type: Literal["photo", "video"]


# ── Comment schemas ───────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    role: str = Field(..., min_length=1, max_length=50)     # e.g. "👵 姥姥"
    content: str = Field(..., min_length=1, max_length=500)


class CommentResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Moment schemas ────────────────────────────────────────────────────────────

class MomentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    media_list: list[MediaItem] = Field(..., min_length=1, max_length=9)


class MomentResponse(BaseModel):
    id: int
    title: str
    description: str | None
    media_list: list[MediaItem]
    ai_tags: list[str] | None
    created_at: datetime
    comments: list[CommentResponse] = []

    model_config = {"from_attributes": True}


class UploadAuthResponse(BaseModel):
    upload_url: str
    key: str


class BatchUploadAuthResponse(BaseModel):
    items: list[UploadAuthResponse]
