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

# [人物结构约束] 用于所有 Prompt，彻底解决人物幻觉
_FAMILY_CONTEXT = """\
[重要参考信息]：相册中常出现的年长女性是“姥姥”，常出现的年长男性是“姥爷”；年长男性极少出现“爷爷”，没有“奶奶”。
识别老年人请以此关系为优先。若有年轻宝宝，请根据其与长辈的互动进行精准推断人物（如爸爸、妈妈、舅舅、姨妈等）。严格遵守此结构，不要编造不在此结构内的人物（如奶奶）。"""

# 单图批量分析（后台任务用）
_PROMPT = f"""\
你是“星月日记数字档案馆”的 AI Vision 助手。你擅长用温暖、细腻感性的中文描述家人间的珍贵瞬间，能完美捕捉画面中的情感，并严格避免通用和机械化。

{_FAMILY_CONTEXT}

**严格指令**：
1. 分析这张照片的人物与场景。
2. 随机选择一种叙事风格（如：细腻幽默、感性诗意、日常写实、捕捉动作）生成文案。文案中不要直接出现“一家三口”这种通用的词，要更具体。
3. 如果画面的光线是人造灯光（比如屏幕光），不要描述成“阳光透过窗户洒在他们身上”，要忠实于视觉事实。
4. 严格按以下 JSON 格式回复（不要包含任何其他内容）：
{{
  "description": "一段 20-60 字的叙事性温馨情感文案",
  "tags": ["3-5 个具体标签，包括人物关系（如：姥姥与宝宝）、场景描述（如：屏幕灯光、抓拍动作）"]
}}"""

# 多图流式分析（用户主动触发，打字机效果）
_STREAM_PROMPT = """\
你是“星月日记数字档案馆”的 AI Vision 助手。你擅长将多张家庭照片串联成一个有情感、有故事感的温馨日记。

{family_context}

**严格指令**：
1. 综合分析以下 {{n}} 张照片。
2. 捕捉这一组照片的整体基调和故事情节（例如：一次聚餐、一次户外出游、一次人物对比成长、姥姥姥爷与宝宝的互动）。
3. 随机选择一种叙事风格（细腻文学、写实记录、幽默生动），写一段 40-80 字的温馨日记文案。
4. 严格拒绝通用、幻觉（不要编造画面没有的东西）。

写完文案后，另起一行，严格输出以下分隔符（单独占一行）：
---TAGS---
再另起一行，以 JSON 数组输出 3-5 个具体、精准的关系与场景标签，例如：["姥姥姥爷聚首", "宝宝抓拍", "温馨聚餐", "互动时间"]
除此之外不要输出任何内容。"""


# ── JSON 提取 ─────────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    """从模型输出中提取 JSON，兼容 markdown 代码块包裹的情况。"""
    text = text.strip()
    # 完美绕过前端 Markdown 解析器截断 Bug
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
        # "response_format": {"type": "json_object"}, 
        "temperature": 0.8, # [优化] 提高变数，增加输出的多样性
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
    # [优化] 将家庭上下文和流式 Prompt 拼接
    content.append({
        "type": "text",
        "text": _STREAM_PROMPT.format(n=len(photo_urls), family_context=_FAMILY_CONTEXT),
    })

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stream": True,
        "temperature": 0.8, # [优化] 提高变数，增加输出的多样性
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