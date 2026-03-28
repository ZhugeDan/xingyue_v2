import logging
import os
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import desc
from qcloud_cos import CosConfig, CosS3Client

from database import SessionLocal, get_db
from models import Moment, Comment
from schemas import MomentCreate, MomentResponse, CommentCreate, CommentResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/moments", tags=["moments"])


def _check_access(x_access_password: str | None = Header(default=None)):
    required = os.environ.get("ACCESS_PASSWORD")
    if required and x_access_password != required:
        raise HTTPException(status_code=401, detail="暗号错误")


def _cos_delete(url: str) -> None:
    """从 COS 删除一个文件。失败时只记录日志，不向上抛异常。"""
    try:
        key = urlparse(url).path.lstrip("/")
        if not key:
            return
        config = CosConfig(
            Region=os.environ["TENCENT_REGION"],
            SecretId=os.environ["TENCENT_SECRET_ID"],
            SecretKey=os.environ["TENCENT_SECRET_KEY"],
        )
        CosS3Client(config).delete_object(
            Bucket=os.environ["TENCENT_BUCKET"], Key=key
        )
        logger.info("COS deleted: %s", key)
    except Exception as exc:
        logger.warning("COS delete failed for %s: %s", url, exc)


# ── Background task: AI enrichment ───────────────────────────────────────────

async def _ai_enrich(moment_id: int, image_urls: list[str]) -> None:
    """
    发帖后异步执行：调用 Vision API 分析第一张图片，
    将 AI 生成的情感文案和标签写回数据库。

    - 若 VISION_API_KEY 未配置则静默跳过，不影响任何已有逻辑。
    - description 仅在用户未填写时才由 AI 补全，避免覆盖用户原文。
    - ai_tags 始终由 AI 更新。
    """
    if not image_urls:
        return

    from ai.vision import analyze_image   # 延迟导入，避免循环依赖

    result = await analyze_image(image_urls[0])
    if not result:
        return

    db = SessionLocal()
    try:
        moment = db.get(Moment, moment_id)
        if not moment:
            return
        if result.get("description") and not moment.description:
            moment.description = result["description"]
        if result.get("tags"):
            moment.ai_tags = result["tags"]
        db.commit()
        logger.info("AI enrich done: moment=%s tags=%s", moment_id, moment.ai_tags)
    except Exception as exc:
        logger.warning("AI enrich DB write failed (moment %s): %s", moment_id, exc)
    finally:
        db.close()


# ── Moments ───────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[MomentResponse])
def get_moments(
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    return (
        db.query(Moment)
        .options(selectinload(Moment.comments))
        .order_by(desc(Moment.created_at))
        .all()
    )


@router.post("/", response_model=MomentResponse, status_code=201)
def create_moment(
    payload: MomentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    data = payload.model_dump()
    moment = Moment(
        title=data["title"],
        description=data["description"],
        media_list=data["media_list"],
        ai_tags=None,
    )
    db.add(moment)
    db.commit()
    db.refresh(moment)

    photo_urls = [m["url"] for m in data["media_list"] if m["type"] == "photo"]
    if photo_urls:
        background_tasks.add_task(_ai_enrich, moment.id, photo_urls)

    return moment


@router.delete("/{moment_id}", status_code=204)
def delete_moment(
    moment_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    moment = db.get(Moment, moment_id)
    if not moment:
        raise HTTPException(status_code=404, detail="动态不存在")

    # 保存所有媒体 URL，删除 DB 记录后再清除 COS 文件
    urls = [item["url"] for item in (moment.media_list or [])]

    db.delete(moment)   # cascade 自动删除 comments
    db.commit()

    for url in urls:
        _cos_delete(url)


# ── Comments ──────────────────────────────────────────────────────────────────

@router.post("/{moment_id}/comments", response_model=CommentResponse, status_code=201)
def add_comment(
    moment_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    if not db.get(Moment, moment_id):
        raise HTTPException(status_code=404, detail="动态不存在")
    comment = Comment(moment_id=moment_id, role=payload.role, content=payload.content)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


@router.delete("/{moment_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    moment_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    comment = (
        db.query(Comment)
        .filter(Comment.id == comment_id, Comment.moment_id == moment_id)
        .first()
    )
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    db.delete(comment)
    db.commit()


# ── Media items ───────────────────────────────────────────────────────────────

@router.delete("/{moment_id}/media/{media_index}", status_code=204)
def delete_media_item(
    moment_id: int,
    media_index: int,
    db: Session = Depends(get_db),
    _: None = Depends(_check_access),
):
    moment = db.get(Moment, moment_id)
    if not moment:
        raise HTTPException(status_code=404, detail="动态不存在")

    media = list(moment.media_list)

    if media_index < 0 or media_index >= len(media):
        raise HTTPException(status_code=400, detail="媒体索引超出范围")

    if len(media) == 1:
        raise HTTPException(
            status_code=400,
            detail="不能删除最后一个文件，请直接删除整条动态",
        )

    removed = media.pop(media_index)

    # flag_modified 告知 SQLAlchemy JSON 列已变更（防止仅 list 内容变化时漏检）
    moment.media_list = media
    flag_modified(moment, "media_list")
    db.commit()

    _cos_delete(removed["url"])
