"""
AI Vision 模块 — 基于 OpenAI 兼容格式的多模态大模型客户端。
"""

import json
import logging
import os
import re
from typing import AsyncGenerator

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1"
_DEFAULT_MODEL    = "qwen-vl-7b"
_TIMEOUT_SEC      = 60 

# ── Prompts ───────────────────────────────────────────────────────────────────

# [终极防幻觉人物约束]
_FAMILY_CONTEXT = """\
【极其重要的防幻觉指令（务必严格遵守）】
1. 绝对忠实画面：画面里有谁才写谁！如果照片里只有宝宝，绝不能凭空捏造“姥姥姥爷在旁边”。照片中没出现的人物、阳光、微风等绝对不要写。
2. 身份映射：只有当你确切看到画面中有“年长女性”时，才称呼为“姥姥”；确切看到“年长男性”时，才称呼为“姥爷”（极少有爷爷，没有奶奶）。
3. 拒绝瞎认亲：绝对不要把照片里的毛绒玩具、电视机里的人（如名人和政要）、路人强行认成家人！"""

# 单图批量分析（后台任务用）
_PROMPT = f"""\
你是“星月日记数字档案馆”的视觉分析专家。
{_FAMILY_CONTEXT}

请分析这张照片，严格按以下 JSON 格式返回，不要包含任何前缀或后缀问候语，不要加粗，不要输出多余符号：
{{
  "description": "20-60字的客观温馨描述。再次强调，只描述画面中真实存在的实体。",
  "tags": ["标签1", "标签2", "标签3"]
}}"""

# 多图流式分析（用户主动触发，打字机效果）
_STREAM_PROMPT = """\
你是“星月日记数字档案馆”的视觉分析专家。

{family_context}

请综合分析以下 {{n}} 张照片，写一段 40-80 字的日记文案。
写完文案后，另起一行，严格输出以下分隔符（必须单独占一行，绝对不要加粗，不要加冒号）：
---TAGS---
再另起一行，以 JSON 数组输出 3-5 个客观的标签，例如：["宝宝抓拍", "玩具小熊"]
不要输出任何其他内容。"""


# ── JSON 提取 (强化版) ────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    """极其强力的 JSON 提取器，无视大模型的废话和各种符号干扰"""
    text = text.strip()
    # 直接用正则在全文中硬抠被 {} 包裹的字典内容
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception as e:
            logger.warning(f"正则提取JSON后解析失败: {e}")
            pass
    
    # 如果实在抠不出来，兜底返回，避免前端报错
    return {
        "description": text.replace("---TAGS---", ""), 
        "tags": ["AI解析异常"]
    }


# ── 主函数 ────────────────────────────────────────────────────────────────────

async def analyze_image(image_url: str) -> dict:
    api_key  = os.environ.get("VISION_API_KEY", "").strip()
    base_url = os.environ.get("VISION_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    model    = os.environ.get("VISION_MODEL", _DEFAULT_MODEL)

    if not api_key:
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
        "temperature": 0.4, # [降温] 从0.8降到0.4，降低模型的发散性，强迫它更写实
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
            "description": str(result.get("description", "")).strip() or None,
            "tags": [str(t).strip() for t in result.get("tags", []) if str(t).strip()],
        }

    except httpx.HTTPStatusError as exc:
        logger.warning(f"Vision API HTTP error {exc.response.status_code}")
    except Exception as exc:
        logger.warning(f"Vision API unexpected error: {exc}")

    return {}


# ── 流式多图分析 ───────────────────────────────────────────────────────────────

async def stream_analysis(photo_urls: list[str]) -> AsyncGenerator[str, None]:
    api_key  = os.environ.get("VISION_API_KEY", "").strip()
    base_url = os.environ.get("VISION_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")
    model    = os.environ.get("VISION_MODEL", _DEFAULT_MODEL)

    if not api_key:
        return

    content: list[dict] = [
        {"type": "image_url", "image_url": {"url": url}}
        for url in photo_urls
    ]
    content.append({
        "type": "text",
        "text": _STREAM_PROMPT.format(n=len(photo_urls), family_context=_FAMILY_CONTEXT),
    })

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stream": True,
        "temperature": 0.4, # 同样降温，防止多图瞎编乱造
        "max_tokens": 1024, 
    }

    async with httpx.AsyncClient(
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