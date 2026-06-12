"""
语义分析服务 — 智能体4 (Semantic Analysis / RAG)

对外暴露单一入口:
    >>> from services.semantic_analysis import analyze
    >>> result = analyze(asr_result)

依赖:
    - 智能体3 (ASR): 接收 ASRResult（含 audio_id / segments / full_text）
    - 智能体5 (记忆存储): 通过 QueryService 检索相关历史对话
    - DeepSeek V4 API: 调用大模型进行结构化语义分析

模块结构:
    models.py          数据模型（ASRResult / AnalysisResult）
    preprocessor.py    文本脱敏与截断
    key_extractor.py   关键词提取（用于历史检索）
    history_retriever.py  历史记忆检索与上下文格式化
    prompt_builder.py  Prompt 模板构造
    deepseek_client.py DeepSeek API 调用（含重试与容错）
    analyzer.py        主编排器：组装完整分析流水线
"""

from .analyzer import analyze
from .models import ASRResult, AnalysisResult, ASRSegment

__all__ = [
    "analyze",
    "ASRResult",
    "AnalysisResult",
    "ASRSegment",
]
