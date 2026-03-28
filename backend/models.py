from datetime import datetime
from sqlalchemy import String, DateTime, JSON, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    resource_id: Mapped[int | None] = mapped_column(nullable=True)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False)   # IPv4 or IPv6
    user_agent: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False, index=True
    )


class Moment(Base):
    __tablename__ = "moments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    media_list: Mapped[list] = mapped_column(JSON, nullable=False)          # [{"url": "...", "type": "photo|video"}]
    ai_tags: Mapped[list | None] = mapped_column(JSON, nullable=True)       # ["合照", "户外", ...]
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # 一对多：删除 Moment 时自动级联删除旗下所有 Comment
    comments: Mapped[list["Comment"]] = relationship(
        "Comment",
        back_populates="moment",
        cascade="all, delete-orphan",
        order_by="Comment.created_at",
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    moment_id: Mapped[int] = mapped_column(
        ForeignKey("moments.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False)       # e.g. "👵 姥姥"
    content: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    moment: Mapped["Moment"] = relationship("Moment", back_populates="comments")
