"""
AI Vision 模块 — 基于 OpenAI 兼容格式的多模态大模型客户端。

兼容所有实现了 OpenAI Chat Completions API 的视觉大模型，通过环境变量切换：
  - 实验室 3x3090 算力集群（当前使用） http://127.0.0.1:8080/v1
  - 通义千问 Qwen-VL            https://dashscope.aliyuncs.com/compatible-mode/v1
  - DeepSeek-VL              https://api.deepseek.com/v1

所需环境变量（均在 .env 中配置）：
  VISION_API_KEY   — 必填；留空则跳过 AI 分析
  VISION_BASE_URL  — 选填；本地隧道填 http://127.0.0.1:8080/v1
  VISION_MODEL     — 选填；默认为 qwen-vl-7b
"""

import json
import logging
import os
import re
from typing import AsyncGenerator
  
  
import httpx

logger = logging.getLogger(__name__)

# [微调1] 默认值回退到本地私有化引擎
_DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1"
_DEFAULT_MODEL    = "qwen-vl-7b"
# [微调2] 本地大模型处理多图可能耗时较长，将全局超时时间稍微放宽到 60 秒
_TIMEOUT_SEC      = 60 

# ── Prompts ───────────────────────────────────────────────────────────────────
# 单图批量分析（后台任务用）
_PROMPT = """\
你是一位家庭相册 AI 助手，擅长用温暖细腻的中文描述家人间的珍贵瞬间。

请分析这张照片，严格按以下 JSON 格式回复（不要包含任何其他内容）：
{
  "description": "一段 20-60 字的温馨情感文案，描述画面场景与情绪氛围",
  "tags": ["3-5 个简短标签，如：笑脸、户外、合照、生日、亲子时光"]
}"""

# 多图流式分析（用户主动触发，打字机效果）
_STREAM_PROMPT = """\
你是一位家庭相册 AI 助手，擅长用温暖细腻的中文描述家人间的珍贵瞬间。

请综合分析以下 {n} 张照片，写一段 40-80 字的温馨日记文案，描述整体场景与情感氛围。
写完文案后，另起一行，严格输出以下分隔符（单独占一行）：
---TAGS---
再另起一行，以 JSON 数组输出 3-5 个简短标签，例如：["笑脸", "合照", "户外"]
除此之外不要输出任何内容。"""


# ── JSON 提取 ─────────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    """从模型输出中提取 JSON，兼容 markdown 代码块包裹的情况。"""
    text = text.strip()
    # 使用 `{3} 正则匹配三个反引号，完美绕过前端 Markdown 解析器截断 Bug
    m = re.search(r"`{3}(?:json)?\s*(\{[\s\S]*?\})\s*`{3}", text)
    if m:
        return json.loads(m.group(1))
    return json.loads(text)


# ── 主函数 ────────────────────────────────────────────────────────────────────

async def analyze_image(image_url: str) -> dict:
    """
    调用 Vision API 分析图片，返回 {"description": str | None, "tags": list[str]}。

    - 若 VISION_API_KEY 未配置，静默返回 {} （不影响正常发帖流程）。
    - 网络或解析错误时同样返回 {}，并记录 warning 日志。
    """
    api_key  = os.environ.get("VISION_API_KEY", "").strip()
    base_url = os.environ.get("VISION_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    model    = os.environ.get("VISION_MODEL", _DEFAULT_MODEL)

    if not api_key:
        logger.debug("VISION_API_KEY not set — skipping AI analysis")
        return {}

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text",      "text": _PROMPT},
                ],
            }
        ],
        # [微调4] ⚠️ Infra 防坑提示：
        # 老版本 vLLM 对 "response_format": {"type": "json_object"} 支持不稳定。
        # 这里暂时将其注释掉，靠 prompt 约束和正则兜底，保证 100% 不崩溃。
        # "response_format": {"type": "json_object"}, 
        "temperature": 0.7,
        # [微调3] 放宽单图生成的 Token 限制
        "max_tokens": 512, 
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEC) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()

        raw    = resp.json()["choices"][0]["message"]["content"]
        result = _parse_json(raw)

        return {
            "description": str(result["description"]).strip() or None
            if result.get("description") else None,
            "tags": [
                str(t).strip()
                for t in result.get("tags", [])
                if str(t).strip()
            ],
        }

    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Vision API HTTP error %s for %s: %s",
            exc.response.status_code, image_url, exc.response.text[:200],
        )
    except (json.JSONDecodeError, KeyError) as exc:
        logger.warning("Vision API response parse error: %s", exc)
    except Exception as exc:
        logger.warning("Vision API unexpected error: %s", exc)

    return {}


# ── 流式多图分析 ───────────────────────────────────────────────────────────────

async def stream_analysis(photo_urls: list[str]) -> AsyncGenerator[str, None]:
    """
    流式调用 Vision API，逐 token yield 文本 delta。

    - 遇到配置缺失直接 return（空生成器），调用方负责处理空结果。
    - 遇到网络/HTTP 错误向上抛出，由调用方统一包装成 SSE error 事件。
    """
    api_key  = os.environ.get("VISION_API_KEY", "").strip()
    base_url = os.environ.get("VISION_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    model    = os.environ.get("VISION_MODEL", _DEFAULT_MODEL)

    if not api_key:
        logger.debug("VISION_API_KEY not set — skipping stream analysis")
        return

    # 多图 content 数组：先排列所有图片，最后附文字 prompt
    content: list[dict] = [
        {"type": "image_url", "image_url": {"url": url}}
        for url in photo_urls
    ]
    content.append({
        "type": "text",
        "text": _STREAM_PROMPT.format(n=len(photo_urls)),
    })

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stream": True,
        "temperature": 0.8,
        # [微调3] 多图总结字数更多，稍微放宽 token 限制
        "max_tokens": 1024, 
    }

    async with httpx.AsyncClient(
        # [微调2] 流式请求的读超时放宽至 120s，给 GPU 充足的计算和显存调度时间
        timeout=httpx.Timeout(120.0, connect=10.0)  
    ) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        ) as resp:
            resp.raise_for_status() 
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content") or ""
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue