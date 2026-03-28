import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from qcloud_cos import CosConfig, CosS3Client

from database import get_db
from schemas import BatchUploadAuthResponse, UploadAuthResponse
from deps import AuditContext, check_access

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


def _get_cos_client() -> tuple[CosS3Client, str]:
    secret_id = os.environ.get("TENCENT_SECRET_ID")
    secret_key = os.environ.get("TENCENT_SECRET_KEY")
    bucket = os.environ.get("TENCENT_BUCKET")
    region = os.environ.get("TENCENT_REGION")

    if not all([secret_id, secret_key, bucket, region]):
        raise HTTPException(
            status_code=500,
            detail="COS credentials not configured.",
        )

    config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key)
    return CosS3Client(config), bucket


def _make_presigned_url(client: CosS3Client, bucket: str, mime: str) -> UploadAuthResponse:
    ext = ALLOWED_EXTENSIONS.get(mime, ".jpg")
    key = f"moments/{uuid.uuid4().hex}{ext}"
    try:
        upload_url = client.get_presigned_url(
            Method="PUT",
            Bucket=bucket,
            Key=key,
            Expired=900,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate presigned URL: {e}")
    return UploadAuthResponse(upload_url=upload_url, key=key)


@router.get("/auth", response_model=BatchUploadAuthResponse)
def get_upload_auth(
    mimes: list[str] = Query(..., description="每个文件的 MIME 类型，e.g. image/jpeg"),
    db: Session = Depends(get_db),
    audit: AuditContext = Depends(check_access),
):
    """
    批量获取预签名上传 URL。
    前端传入每个文件的 MIME 类型列表，后端返回对应数量的 {upload_url, key}。
    """
    if len(mimes) > 9:
        raise HTTPException(status_code=400, detail="最多同时上传 9 个文件")

    client, bucket = _get_cos_client()
    items = [_make_presigned_url(client, bucket, mime) for mime in mimes]
    audit.write(db, "GET_UPLOAD_AUTH")
    return BatchUploadAuthResponse(items=items)
