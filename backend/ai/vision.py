"""
AI Vision 模块 — 基于 OpenAI 兼容格式的多模态大模型客户端。

兼容所有实现了 OpenAI Chat Completions API 的视觉大模型，通过环境变量切换：
  - 通义千问 Qwen-VL（默认）  https://dashscope.aliyuncs.com/compatible-mode/v1
  - DeepSeek-VL              https://api.deepseek.com/v1
  - GPT-4o-mini              https://api.openai.com/v1

所需环境变量（均在 .env 中配置）：
  VISION_API_KEY   — 必填；留空则跳过 AI 分析，不影响正常发帖
  VISION_BASE_URL  — 选填；默认为 DashScope（通义千问）
  VISION_MODEL     — 选填；默认为 qwen-vl-max
"""

import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL    = "qwen-vl-max"
_TIMEOUT_SEC      = 45

# ── Prompt ───────────────────────────────────────────────────────────────────
# 专门为家庭相册场景设计，引导模型输出温馨的中文情感文案和标签。

_PROMPT = """\
你是一位家庭相册 AI 助手，擅长用温暖细腻的中文描述家人间的珍贵瞬间。

请分析这张照片，严格按以下 JSON 格式回复（不要包含任何其他内容）：
{
  "description": "一段 20-60 字的温馨情感文案，描述画面场景与情绪氛围",
  "tags": ["3-5 个简短标签，如：笑脸、户外、合照、生日、亲子时光"]
}"""


# ── JSON 提取 ─────────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    """从模型输出中提取 JSON，兼容 markdown 代码块包裹的情况。"""
    text = text.strip()
    # 尝试提取 ```json ... ``` 或 ``` ... ```
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
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
        "response_format": {"type": "json_object"},   # Qwen-VL / GPT-4o 支持
        "temperature": 0.7,
        "max_tokens": 300,
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
