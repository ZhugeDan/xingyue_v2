"""
共享依赖项 — 鉴权 + 审计日志

所有需要 ACCESS_PASSWORD 的接口统一使用 check_access。
它在验证通过后返回一个 AuditContext，端点用它写审计记录。
"""

import os

from fastapi import Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from models import AuditLog


class AuditContext:
    """携带请求元数据，并提供写审计日志的方法。"""

    def __init__(self, ip: str, user_agent: str):
        self.ip = ip
        self.user_agent = user_agent

    def write(self, db: Session, action: str, resource_id: int | None = None) -> None:
        log = AuditLog(
            action=action,
            resource_id=resource_id,
            ip_address=self.ip,
            user_agent=self.user_agent,
        )
        db.add(log)
        db.commit()


def check_access(
    request: Request,
    x_access_password: str | None = Header(default=None),
    password: str | None = Query(default=None),   # SSE/EventSource fallback
) -> AuditContext:
    """
    校验 X-Access-Password Header 或 ?password= 查询参数；失败则 401。
    成功后返回 AuditContext（含 IP 和 User-Agent），供端点写审计日志。
    """
    required = os.environ.get("ACCESS_PASSWORD")
    provided = x_access_password or password
    if required and provided != required:
        raise HTTPException(status_code=401, detail="暗号错误")

    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    return AuditContext(ip=ip, user_agent=ua)
