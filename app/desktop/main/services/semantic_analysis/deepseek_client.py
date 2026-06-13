"""
DeepSeek V4 API 客户端

职责:
    1. 调用 DeepSeek Chat API（兼容 OpenAI API 格式）
    2. 使用 response_format: json_object 强制 JSON 输出
    3. 实现指数退避重试（网络超时 / JSON 解析失败）
    4. 异常时返回最简结构化结果，不阻塞下游

API 规范:
    接口: POST https://api.deepseek.com/v1/chat/completions
    模型: deepseek-chat
    Key:  从 config/deepseek_key.txt 读取

重试策略:
    - 网络超时（URLError / HTTPError）: 最多 3 次，指数退避
    - JSON 解析失败（JSONDecodeError）: 最多 3 次，指数退避
    - 全部失败后返回最简结果
"""

import json
import os
import logging
import time
import urllib.error
import urllib.request
from typing import Any

# 启动时强制清除代理环境变量
for _key in ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']:
    os.environ.pop(_key, None)

from .models import AnalysisResult

logger = logging.getLogger(__name__)

DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_TIMEOUT = 60
MAX_RETRIES = 3
INITIAL_BACKOFF = 2.0

_CONFIG_FILE_CANDIDATES = [
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), *([".."] * 5), "config", "deepseek_key.txt")
    ),
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), *([".."] * 5), "config", "deepseek_key.example.txt")
    ),
    os.environ.get("DEEPSEEK_KEY_PATH", ""),
]

_API_KEY: str | None = None


def _load_api_key() -> str:
    """从配置文件读取 DeepSeek API Key（带缓存，只读一次文件）"""
    global _API_KEY
    if _API_KEY:
        return _API_KEY

    for path in _CONFIG_FILE_CANDIDATES:
        if not path:
            continue
        if os.path.isfile(path):
            # 尝试多种编码读取 Key 文件
            for enc in ["utf-8", "utf-16", "gbk", "gb2312", "latin-1"]:
                try:
                    with open(path, "r", encoding=enc) as f:
                        key = f.read().strip()
                    if key:
                        _API_KEY = key
                        logger.info(f"已加载 DeepSeek API Key: {path} (编码: {enc})")
                        return key
                except (UnicodeDecodeError, OSError):
                    continue

    raise FileNotFoundError(
        "DeepSeek API Key 未配置。请创建 config/deepseek_key.txt "
        "并写入你的 DeepSeek API Key（格式: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx）"
    )


def _call_api(payload: dict) -> str:
    """发起一次 DeepSeek API 请求"""
    import urllib.request
    import urllib.error

    api_key = _load_api_key()

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    # 和 test_api.py 一样，直接用 urlopen，不加任何 ProxyHandler
    with urllib.request.urlopen(req, timeout=DEEPSEEK_TIMEOUT) as resp:
        raw = resp.read().decode("utf-8")
        logger.debug(f"API 响应原始大小: {len(raw)} bytes")
        return raw


def call_with_retry(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    """
    带重试和容错的 DeepSeek API 调用

    参数:
        system_prompt: System prompt（分析指令 + JSON Schema）
        user_prompt:   User prompt（含历史上下文和当前对话文本）

    返回:
        解析后的 JSON 字典（AnalysisResult 的原始数据）

    容错行为:
        - 网络超时 → 指数退避重试，最多 3 次
        - JSON 解析失败 → 记录原始响应并重试，最多 3 次
        - 全部失败 → 返回最简 fallback 结果
    """
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }

    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(f"DeepSeek API 调用 (attempt {attempt}/{MAX_RETRIES})")
            raw = _call_api(payload)

            # 解析 API 顶层 JSON
            api_response = json.loads(raw)

            # 提取 message.content
            choices = api_response.get("choices", [])
            if not choices:
                raise ValueError("API 返回的 choices 为空")
            content_str = choices[0].get("message", {}).get("content", "")
            if not content_str:
                raise ValueError("API 返回的 message.content 为空")

            # 解析 content 中的分析结果 JSON
            analysis = json.loads(content_str)

            # 验证解析结果为 dict 类型（API 可能返回 null 或非对象类型）
            if not isinstance(analysis, dict):
                raise ValueError(f"API 返回的不是 JSON 对象: {type(analysis).__name__}")

            logger.info(f"DeepSeek API 调用成功 (attempt {attempt})")
            return analysis

        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(
                f"JSON 解析失败 (attempt {attempt}/{MAX_RETRIES}): {e}\\n"
                f"原始响应前 500 字: {raw[:500]}"
            )
            if attempt < MAX_RETRIES:
                _backoff(attempt)
            continue

        except (ValueError, KeyError) as e:
            last_error = e
            logger.warning(
                f"响应格式异常 (attempt {attempt}/{MAX_RETRIES}): {e}"
            )
            if attempt < MAX_RETRIES:
                _backoff(attempt)
            continue

        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            last_error = e
            logger.warning(
                f"网络请求失败 (attempt {attempt}/{MAX_RETRIES}): {type(e).__name__}: {e}"
            )
            if attempt < MAX_RETRIES:
                _backoff(attempt)
            continue

    logger.error(f"DeepSeek API 调用全部失败（{MAX_RETRIES} 次）: {last_error}")
    return _fallback_raw()


def _backoff(attempt: int):
    """指数退避等待"""
    delay = INITIAL_BACKOFF * (2 ** (attempt - 1))
    logger.info(f"等待 {delay:.1f} 秒后重试...")
    time.sleep(delay)


def _fallback_raw() -> dict[str, Any]:
    """返回最简降级结果，不阻塞下游"""
    return AnalysisResult.fallback(
        "语义分析服务暂时无法获取结果，请检查 DeepSeek API 配置或网络连接。"
    ).to_dict()
