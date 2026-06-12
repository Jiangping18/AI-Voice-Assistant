"""
语义分析主编排器（Analyzer Orchestrator）

职责:
    组装完整的语义分析流水线:
    1. 文本预处理与脱敏
    2. 关键词提取
    3. 历史记忆检索（注入 {history_context}）
    4. 构造 Prompt
    5. 调用 DeepSeek API
    6. 包装为 AnalysisResult

对外暴露:
    analyze(asr_result: ASRResult) -> AnalysisResult
"""

import json
import logging
from typing import Any

from .models import ASRResult, AnalysisResult
from .preprocessor import preprocess
from .key_extractor import build_search_query
from .history_retriever import retrieve_history, format_history_context
from .prompt_builder import SYSTEM_PROMPT, build_user_prompt
from .deepseek_client import call_with_retry

logger = logging.getLogger(__name__)


def analyze(asr_result: ASRResult) -> AnalysisResult:
    """
    语义分析入口 —— 编排完整分析流水线

    执行流程:
        1. 文本预处理（脱敏 + 截断）
        2. 关键词提取
        3. 历史记忆检索
        4. 构造 Prompt（含历史上下文）
        5. 调用 DeepSeek API
        6. 包装为 AnalysisResult

    参数:
        asr_result: ASR 识别结果（来自智能体3）

    返回:
        AnalysisResult: 结构化分析结果
                        即使 API 调用全部失败也返回最简结果，不抛出异常
    """
    # ── 0. 参数校验 ─────────────────────────────────────────
    if not asr_result:
        logger.error("asr_result 参数为空")
        return AnalysisResult.fallback("输入参数为空，无法进行分析。")

    audio_id = asr_result.audio_id or "unknown"
    full_text = asr_result.full_text or ""
    logger.info(f"[{audio_id}] 开始语义分析，文本长度: {len(full_text)}")

    # ── 1. 文本预处理与脱敏 ─────────────────────────────────
    cleaned_text = preprocess(full_text)
    logger.info(f"[{audio_id}] 预处理完成，处理后文本长度: {len(cleaned_text)}")

    if not cleaned_text.strip():
        logger.warning(f"[{audio_id}] 预处理后文本为空，返回空结果")
        return AnalysisResult.fallback("对话文本为空，无法进行分析。")

    # ── 2. 关键词提取 ───────────────────────────────────────
    search_query = build_search_query(cleaned_text)
    logger.info(f"[{audio_id}] 检索查询: \"{search_query}\"")

    # ── 3. 历史记忆检索 ─────────────────────────────────────
    history_context = _retrieve_history_context(search_query)
    logger.info(f"[{audio_id}] 历史上下文长度: {len(history_context)}")

    # ── 4. 构造 Prompt ──────────────────────────────────────
    user_prompt = build_user_prompt(cleaned_text, history_context)
    logger.debug(f"[{audio_id}] User Prompt 长度: {len(user_prompt)}")

    # ── 5. 调用 DeepSeek API ────────────────────────────────
    raw_result = call_with_retry(SYSTEM_PROMPT, user_prompt)
    logger.info(f"[{audio_id}] API 返回字段: {list(raw_result.keys())}")

    # ── 6. 包装为 AnalysisResult ─────────────────────────────
    result = _to_analysis_result(raw_result)
    logger.info(f"[{audio_id}] 语义分析完成")
    return result


def _retrieve_history_context(query: str) -> str:
    """历史记忆检索与格式化，失败时静默降级"""
    try:
        history = retrieve_history(query, top_k=5)
        return format_history_context(history, top_n=3)
    except Exception as e:
        logger.warning(f"历史记忆检索异常（跳过）: {e}")
        return ""


def _to_analysis_result(data: dict[str, Any]) -> AnalysisResult:
    """将 API 返回的字典转换为 AnalysisResult，缺失字段使用默认值"""
    entities = data.get("entities", {}) or {}
    reminders = data.get("reminders", []) or []

    return AnalysisResult(
        summary=data.get("summary", ""),
        emotion=data.get("emotion", {"overall": "中性", "speakers": {}}),
        entities={
            "persons": entities.get("persons", []),
            "organizations": entities.get("organizations", []),
            "locations": entities.get("locations", []),
            "time_expressions": entities.get("time_expressions", []),
            "events": entities.get("events", []),
        },
        reminders=reminders,
        raw_response=json.dumps(data, ensure_ascii=False),
    )
