"""
IP 属地解析工具

- 使用离线 ip2region xdb 数据库，无需任何在线 API。
- 首次调用时将整个 xdb 载入内存（约 11 MB），后续查询纯内存操作，极快。
- get_real_ip(request)  : 优先读取 X-Real-IP，兼容直连和 Nginx 反代。
- get_ip_location(ip)   : IP → 省份/地区文字，如 "河北"、"北京"、"海外"、"未知"。
"""

import ipaddress
import logging
import os
import sys
from fastapi import Request

logger = logging.getLogger(__name__)

# ── Singleton searcher (lazy init) ────────────────────────────────────────────

_searcher = None
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def _get_searcher():
    global _searcher
    if _searcher is not None:
        return _searcher

    try:
        if _BACKEND_DIR not in sys.path:
            sys.path.insert(0, _BACKEND_DIR)

        import ip2region.util as util
        import ip2region.searcher as xdb_searcher

        db_path = os.path.join(_BACKEND_DIR, "ip2region.xdb")
        c_buffer = util.load_content_from_file(db_path)
        header = util.load_header_from_file(db_path)
        version = util.version_from_header(header)
        _searcher = xdb_searcher.new_with_buffer(version, c_buffer)
        logger.info("ip2region xdb 已载入内存 (%.1f MB)", len(c_buffer) / 1024 / 1024)
    except Exception as exc:
        logger.warning("ip2region 初始化失败: %s", exc)
        _searcher = None

    return _searcher


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return (
            addr.is_private
            or addr.is_loopback
            or addr.is_reserved
            or addr.is_unspecified
            or addr.is_link_local
        )
    except ValueError:
        return True


_PROVINCE_SUFFIXES = ["省", "自治区", "特别行政区"]


def _clean_province(name: str) -> str:
    """去掉省/自治区/特别行政区后缀，如 '河北省' → '河北'，'香港特别行政区' → '香港'。"""
    for suffix in _PROVINCE_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


# ── Public API ────────────────────────────────────────────────────────────────

def get_real_ip(request: Request) -> str:
    """
    优先从 X-Real-IP 头取真实客户端 IP（Nginx 已配置 proxy_set_header X-Real-IP $remote_addr）。
    降级顺序：X-Forwarded-For 首项 → request.client.host。
    """
    ip = (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )
    return ip or "unknown"


def get_ip_location(ip: str) -> str:
    """
    IP → 省份/地区，例如：
      121.22.33.44  → "河北"
      202.106.0.20  → "北京"
      1.1.1.1       → "海外"
      127.0.0.1     → "未知"

    xdb 数据格式：国家|省份|城市|ISP|CC
    """
    if not ip or ip == "unknown" or _is_private(ip):
        return "未知"

    s = _get_searcher()
    if s is None:
        return "未知"

    try:
        result = s.search(ip)
    except Exception as exc:
        logger.warning("ip2region 查询失败 %s: %s", ip, exc)
        return "未知"

    if not result:
        return "未知"

    parts = result.split("|")
    country = parts[0].strip()

    if not country or country.lower() == "reserved":
        return "未知"

    if country != "中国":
        return "海外"

    province = parts[1].strip() if len(parts) > 1 else ""
    if not province or province == "0":
        return "未知"

    return _clean_province(province)
