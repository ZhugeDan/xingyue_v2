import json
import logging
import os
import re
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import desc
from qcloud_cos import CosConfig, CosS3Client

from database import SessionLocal, get_db
from models import Moment, Comment
from schemas import MomentCreate, MomentResponse, MomentsListResponse, CommentCreate, CommentResponse
from deps import AuditContext, check_access, guest_access
from ip_location import get_ip_location

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/moments", tags=["moments"])


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

@router.get("/", response_model=MomentsListResponse)
def get_moments(
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(guest_access),   # 访客可无密码访问
):
    moments = (
        db.query(Moment)
        .options(selectinload(Moment.comments))
        .order_by(desc(Moment.created_at))
        .all()
    )
    audit.write(db, "LIST_MOMENTS")   # 访客时此调用内部静默跳过
    return MomentsListResponse(items=moments, is_admin=audit.is_admin)


@router.post("/", response_model=MomentResponse, status_code=201)
def create_moment(
    payload: MomentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
):
    data = payload.model_dump()
    moment = Moment(
        title=data["title"],
        description=data["description"],
        media_list=data["media_list"],
        ai_tags=None,
        location=get_ip_location(audit.ip),
    )
    db.add(moment)
    db.commit()
    db.refresh(moment)

    photo_urls = [m["url"] for m in data["media_list"] if m["type"] == "photo"]
    if photo_urls:
        background_tasks.add_task(_ai_enrich, moment.id, photo_urls)

    audit.write(db, "CREATE_MOMENT", moment.id)
    return moment


@router.delete("/{moment_id}", status_code=204)
def delete_moment(
    moment_id: int,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
):
    moment = db.get(Moment, moment_id)
    if not moment:
        raise HTTPException(status_code=404, detail="动态不存在")

    # 保存所有媒体 URL，删除 DB 记录后再清除 COS 文件
    urls = [item["url"] for item in (moment.media_list or [])]

    db.delete(moment)   # cascade 自动删除 comments
    db.commit()

    audit.write(db, "DELETE_MOMENT", moment_id)

    for url in urls:
        _cos_delete(url)


# ── Comments ──────────────────────────────────────────────────────────────────

@router.post("/{moment_id}/comments", response_model=CommentResponse, status_code=201)
def add_comment(
    moment_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
):
    if not db.get(Moment, moment_id):
        raise HTTPException(status_code=404, detail="动态不存在")
    comment = Comment(
        moment_id=moment_id,
        role=payload.role,
        content=payload.content,
        location=get_ip_location(audit.ip),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    audit.write(db, "CREATE_COMMENT", comment.id)
    return comment


@router.delete("/{moment_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    moment_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
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
    audit.write(db, "DELETE_COMMENT", comment_id)


# ── Media items ───────────────────────────────────────────────────────────────

@router.delete("/{moment_id}/media/{media_index}", status_code=204)
def delete_media_item(
    moment_id: int,
    media_index: int,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
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

    audit.write(db, "DELETE_MEDIA", moment_id)
    _cos_delete(removed["url"])


# ── AI Stream ─────────────────────────────────────────────────────────────────

def _save_stream_result(moment_id: int, full_text: str) -> None:
    """
    解析流式输出，将日记文案和标签持久化到数据库。
    此接口为用户主动触发，始终覆写 description（即使已有值）。
    """
    sep_match = re.search(r'---\s*TAGS\s*---', full_text, re.IGNORECASE)
    if sep_match:
        desc_part = full_text[:sep_match.start()]
        tags_raw  = full_text[sep_match.end():]
    else:
        desc_part, tags_raw = full_text, ""

    description = desc_part.strip() or None
    tags: list[str] = []
    if tags_raw.strip():
        try:
            m = re.search(r"\[.*?\]", tags_raw.strip(), re.DOTALL)
            if m:
                parsed = json.loads(m.group())
                tags = [str(t).strip() for t in parsed if str(t).strip()]
        except (json.JSONDecodeError, ValueError):
            pass

    db = SessionLocal()
    try:
        moment = db.get(Moment, moment_id)
        if not moment:
            return
        if description:
            moment.description = description
        if tags:
            moment.ai_tags = tags
        db.commit()
        logger.info("AI stream saved: moment=%s tags=%s", moment_id, tags)
    except Exception as exc:
        logger.warning("AI stream DB save failed (moment %s): %s", moment_id, exc)
    finally:
        db.close()


async def _sse_generator(moment_id: int, photo_urls: list[str]):
    """
    将 stream_analysis 的文本 delta 格式化为 SSE 事件，并在流结束后入库。

    SSE 协议：
      data: {"text": "..."}\\n\\n   — 文本增量
      data: [DONE]\\n\\n             — 流正常结束
      data: {"error": "..."}\\n\\n  — 出错
    """
    from ai.vision import stream_analysis   # 延迟导入，避免循环依赖

    full_text = ""
    try:
        async for delta in stream_analysis(photo_urls):
            full_text += delta
            yield f"data: {json.dumps({'text': delta}, ensure_ascii=False)}\n\n"

        if not full_text:
            # API key 未配置或模型无输出
            yield f"data: {json.dumps({'error': 'AI 服务未配置或无输出'}, ensure_ascii=False)}\n\n"
            return

        yield "data: [DONE]\n\n"
        _save_stream_result(moment_id, full_text)

    except Exception as exc:
        logger.warning("SSE stream error (moment %s): %s", moment_id, exc)
        yield f"data: {json.dumps({'error': str(exc)[:120]}, ensure_ascii=False)}\n\n"


@router.get("/{moment_id}/ai_stream")
async def ai_stream(
    moment_id: int,
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
):
    """
    流式返回 AI 生成的日记文案与标签（SSE 格式）。
    - 仅分析图片，跳过视频。
    - 同时传入全部图片 URL，让模型综合所有画面。
    - 前端通过 fetch + ReadableStream 实现打字机效果。
    - 流结束后自动将结果入库（description & ai_tags）。
    """
    moment = db.get(Moment, moment_id)
    if not moment:
        raise HTTPException(status_code=404, detail="动态不存在")

    photo_urls = [
        item["url"] for item in (moment.media_list or [])
        if item.get("type") == "photo"
    ]
    if not photo_urls:
        raise HTTPException(status_code=400, detail="该动态没有图片，无法生成日记")

    audit.write(db, "AI_STREAM", moment_id)

    return StreamingResponse(
        _sse_generator(moment_id, photo_urls),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # 告知 Nginx/Caddy 不要缓冲响应
            "Connection":      "keep-alive",
        },
    )
