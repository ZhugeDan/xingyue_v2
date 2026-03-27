from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class MomentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    media_url: str = Field(..., min_length=1, max_length=1000)
    media_type: Literal["photo", "video"]
    password: str = Field(default="127")


class MomentResponse(BaseModel):
    id: int
    title: str
    description: str | None
    media_url: str
    media_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadAuthResponse(BaseModel):
    upload_url: str
    key: str
