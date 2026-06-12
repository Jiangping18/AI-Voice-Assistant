"""
历史记忆检索模块

职责:
    1. 调用智能体5的 QueryService.search() 检索相关历史对话
    2. 将检索结果格式化为 Prompt 可用的 {history_context} 字符串

注意:
    - QueryService 在函数内部延迟导入，兼容子包和独立模块两种使用场景
    - 当向量索引未就绪时自动降级为 SQL LIKE 搜索
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_TOP_K = 5
_HISTORY_INJECT_COUNT = 3


def _get_query_service():
    """获取 QueryService 实例（延迟导入，避免模块加载时的相对导入冲突）"""
    try:
        from ..query_service import QueryService
    except ImportError:
        from services.query_service import QueryService
    return QueryService()


def retrieve_history(
    query: str,
    filters: dict | None = None,
    top_k: int = _DEFAULT_TOP_K,
) -> list[dict[str, Any]]:
    """
    检索历史记忆

    调用智能体5的 QueryService 统一检索接口，
    从 segments / events / conversations 等表中搜索。

    参数:
        query:   检索关键词（由 key_extractor 生成）
        filters: 过滤条件（可选）
        top_k:   返回结果上限

    返回:
        历史记录列表，每条包含 text / speaker / timestamp / score / type / id
    """
    filters = filters or {}
    history: list[dict[str, Any]] = []

    try:
        qs = _get_query_service()
        result = qs.search(query=query, filters=filters, top_k=top_k)

        for item in result.get("results", []):
            data = item.get("data", {})
            history.append({
                "text": data.get("text", data.get("content", data.get("summary", ""))),
                "speaker": data.get("name", data.get("speaker", "")),
                "timestamp": data.get("created_at", data.get("start_time", "")),
                "score": item.get("score", 0.0),
                "type": item.get("type", "unknown"),
                "id": item.get("id", ""),
            })

        logger.info(f'历史检索完成: query="{query}", 命中 {len(history)} 条')

    except Exception as e:
        logger.warning(f"历史记忆检索失败（将跳过上下文注入）: {e}")

    return history


def format_history_context(
    history: list[dict[str, Any]],
    top_n: int = _HISTORY_INJECT_COUNT,
) -> str:
    """
    将历史记忆格式化为 Prompt 上下文文本

    按照 score 降序排列后取 Top N 条，
    格式化为易读的时间戳 + 说话人 + 内容。
    """
    if not history:
        return "暂无相关历史对话记录。"

    sorted_history = sorted(history, key=lambda x: -x.get("score", 0.0))

    lines: list[str] = []
    for item in sorted_history[:top_n]:
        timestamp = item.get("timestamp", "") or "未知时间"
        speaker = item.get("speaker", "") or "未知说话人"
        text = (item.get("text", "") or "")[:200]
        lines.append(f"- [{timestamp}] {speaker}: {text}")

    return "\n".join(lines)


def retrieve_and_format(text: str, filters: dict | None = None) -> str:
    """一键完成检索 + 格式化的便捷函数"""
    from .key_extractor import build_search_query
    query = build_search_query(text)
    history = retrieve_history(query, filters=filters)
    return format_history_context(history)
