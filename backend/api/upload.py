import os
import uuid

from fastapi import APIRouter, HTTPException
from qcloud_cos import CosConfig, CosS3Client

from schemas import UploadAuthResponse

router = APIRouter(prefix="/api/upload", tags=["upload"])


def _get_cos_client() -> tuple[CosS3Client, str, str]:
    secret_id = os.environ.get("TENCENT_SECRET_ID")
    secret_key = os.environ.get("TENCENT_SECRET_KEY")
    bucket = os.environ.get("TENCENT_BUCKET")
    region = os.environ.get("TENCENT_REGION")

    if not all([secret_id, secret_key, bucket, region]):
        raise HTTPException(
            status_code=500,
            detail="COS credentials not configured. Set TENCENT_SECRET_ID, "
                   "TENCENT_SECRET_KEY, TENCENT_BUCKET, TENCENT_REGION.",
        )

    config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key)
    client = CosS3Client(config)
    return client, bucket, region


@router.get("/auth", response_model=UploadAuthResponse)
def get_upload_auth():
    client, bucket, _ = _get_cos_client()

    ext_map = {".jpg": "photo", ".jpeg": "photo", ".png": "photo", ".gif": "photo",
               ".mp4": "video", ".mov": "video", ".webm": "video"}
    # Default to jpg; front-end should append correct extension via `key`
    key = f"moments/{uuid.uuid4().hex}.jpg"

    try:
        upload_url = client.get_presigned_url(
            Method="PUT",
            Bucket=bucket,
            Key=key,
            Expired=900,  # 15 minutes
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate presigned URL: {e}")

    return UploadAuthResponse(upload_url=upload_url, key=key)
