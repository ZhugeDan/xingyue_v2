"""
共享依赖项 — 鉴权 + 审计日志

check_access  : 严格鉴权，用于所有写操作（POST / DELETE）。
guest_access  : 宽松鉴权，用于只读 GET，无密码时以访客身份放行。
"""

import os

from fastapi import Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from models import AuditLog


class AuditContext:
    """携带请求元数据，并提供写审计日志的方法。"""

    def __init__(self, ip: str, user_agent: str, is_admin: bool = True):
        self.ip = ip
        self.user_agent = user_agent
        self.is_admin = is_admin

    def write(self, db: Session, action: str, resource_id: int | None = None) -> None:
        # 访客浏览不写审计日志
        if not self.is_admin:
            return
        log = AuditLog(
            action=action,
            resource_id=resource_id,
            ip_address=self.ip,
            user_agent=self.user_agent,
        )
        db.add(log)
        db.commit()


def _resolve(request: Request, header_pwd: str | None, query_pwd: str | None) -> AuditContext:
    """公共解析逻辑，被两个依赖复用。"""
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    return AuditContext(ip=ip, user_agent=ua)


def check_access(
    request: Request,
    x_access_password: str | None = Header(default=None),
    password: str | None = Query(default=None),   # SSE/EventSource fallback
) -> AuditContext:
    """
    严格鉴权：密码缺失或错误均 401。
    用于 POST / DELETE / ai_stream 等写操作。
    """
    required = os.environ.get("ACCESS_PASSWORD")
    provided = x_access_password or password
    if required and provided != required:
        raise HTTPException(status_code=401, detail="暗号错误")

    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    return AuditContext(ip=ip, user_agent=ua, is_admin=True)


def guest_access(
    request: Request,
    x_access_password: str | None = Header(default=None),
    password: str | None = Query(default=None),
) -> AuditContext:
    """
    宽松鉴权：只读 GET 路由使用。
    - 无密码  → 访客身份放行（is_admin=False）
    - 密码正确 → 管理员身份（is_admin=True）
    - 密码错误 → 401（防止暴力探测）
    """
    required = os.environ.get("ACCESS_PASSWORD")
    provided = x_access_password or password

    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")

    if not required:
        # 未设置密码的部署 → 所有人都是管理员
        return AuditContext(ip=ip, user_agent=ua, is_admin=True)

    if not provided:
        # 没有提供密码 → 访客模式
        return AuditContext(ip=ip, user_agent=ua, is_admin=False)

    if provided != required:
        # 密码错误 → 拒绝
        raise HTTPException(status_code=401, detail="暗号错误")

    return AuditContext(ip=ip, user_agent=ua, is_admin=True)
