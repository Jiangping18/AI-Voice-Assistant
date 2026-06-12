"""
语义分析数据模型

定义:
    ASRResult:     上游输入（来自智能体3 - ASR 输出）
    AnalysisResult: 下游输出（分析结果 JSON 的 Python 封装）

设计目标:
    所有模型均为 dataclass，支持 to_dict() 序列化，
    与智能体5的 models.py 保持一致的编码风格。
"""

from dataclasses import dataclass, field, asdict
from typing import Optional


# ═══════════════════════════════════════════════════════════════
# 上游输入：来自智能体3（ASR 识别引擎）
# ═══════════════════════════════════════════════════════════════

@dataclass
class ASRSegment:
    """
    单段语音识别结果

    字段:
        speaker: 说话人标签，如 "SPEAKER_01"
        text:    识别文本
        start:   起始时间（秒）
        end:     结束时间（秒）
    """
    speaker: str = ""
    text: str = ""
    start: float = 0.0
    end: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ASRResult:
    """
    完整音频识别结果（智能体3输出 → 智能体4输入）

    字段:
        audio_id:  音频文件唯一标识
        duration:  音频总时长（秒）
        segments:  分段识别列表
        full_text: 完整对话文本（含说话人前缀拼接）
    """
    audio_id: str = ""
    duration: float = 0.0
    segments: list = field(default_factory=list)   # list[ASRSegment]
    full_text: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ═══════════════════════════════════════════════════════════════
# 下游输出：语义分析结果（符合 JSON Schema 规范）
# ═══════════════════════════════════════════════════════════════

@dataclass
class AnalysisResult:
    """
    语义分析结果

    字段说明:
        summary:    对话摘要（2-3 句概括核心内容）
        emotion:    情绪分析，格式为
                    {"overall": "积极/中性/消极",
                     "speakers": {"说话人标签": "情绪描述"}}
        entities:   实体提取结果，包含人物/组织/地点/时间/事件
        reminders:  待办事项列表
        raw_response: 原始 API 响应文本（仅调试用，不对外暴露）
    """
    summary: str = ""
    emotion: dict = field(default_factory=lambda: {
        "overall": "中性",
        "speakers": {},
    })
    entities: dict = field(default_factory=lambda: {
        "persons": [],
        "organizations": [],
        "locations": [],
        "time_expressions": [],
        "events": [],
    })
    reminders: list = field(default_factory=list)  # list[dict]
    raw_response: Optional[str] = None

    def to_dict(self) -> dict:
        """序列化为字典（不含 raw_response 字段）"""
        d = asdict(self)
        d.pop("raw_response", None)
        return d

    @classmethod
    def fallback(cls, message: str = "") -> "AnalysisResult":
        """
        创建一个最简降级结果，用于 API 不可用时的容错返回
        保证下游（智能体6提醒、智能体7图谱）不因语义分析失败而阻塞
        """
        return cls(
            summary=message or "语义分析服务暂不可用，请稍后重试。",
            emotion={"overall": "中性", "speakers": {}},
            entities={
                "persons": [],
                "organizations": [],
                "locations": [],
                "time_expressions": [],
                "events": [],
            },
            reminders=[],
        )
