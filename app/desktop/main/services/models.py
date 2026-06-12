"""
数据模型定义 -- 对应 SQLite 五张表的 Python 数据类

为智能体4(语义分析)、智能体6(提醒触达)、智能体7(图谱可视化) 提供类型安全的交互载体。
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
from .database import utc_now


def _new_id() -> str:
    """生成简易 UUID v4（生产环境建议换用 uuid4）"""
    import uuid
    return str(uuid.uuid4())


# 1. Conversation -- 对话会话

@dataclass
class Conversation:
    """对话会话"""
    id: str = field(default_factory=_new_id)
    title: str = ""
    start_time: str = field(default_factory=utc_now)
    end_time: Optional[str] = None
    participant_ids: list = field(default_factory=list)
    summary: str = ""
    status: str = "active"
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        import json
        d = asdict(self)
        d["participant_ids"] = json.dumps(self.participant_ids, ensure_ascii=False) if isinstance(self.participant_ids, list) else self.participant_ids
        return d

    @classmethod
    def from_row(cls, row: dict) -> "Conversation":
        import json
        row = dict(row)
        row["participant_ids"] = json.loads(row.get("participant_ids", "[]"))
        return cls(**row)


# 2. Person -- 说话人 / 参与者

@dataclass
class Person:
    """说话人 / 参与者"""
    id: str = field(default_factory=_new_id)
    name: str = ""
    role: str = "speaker"
    voice_print: Optional[str] = None
    meta_info: dict = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        import json
        d = asdict(self)
        d["meta_info"] = json.dumps(self.meta_info, ensure_ascii=False) if isinstance(self.meta_info, dict) else self.meta_info
        return d

    @classmethod
    def from_row(cls, row: dict) -> "Person":
        import json
        row = dict(row)
        row["meta_info"] = json.loads(row.get("meta_info", "{}"))
        return cls(**row)


# 3. Event -- 从对话中提取的事件

@dataclass
class Event:
    """从对话中提取的事件"""
    id: str = field(default_factory=_new_id)
    conversation_id: str = ""
    type: str = "note"
    content: str = ""
    timestamp: Optional[str] = None
    source_segment_id: Optional[str] = None
    involved_person_ids: list = field(default_factory=list)
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        import json
        d = asdict(self)
        d["involved_person_ids"] = json.dumps(self.involved_person_ids, ensure_ascii=False) if isinstance(self.involved_person_ids, list) else self.involved_person_ids
        return d

    @classmethod
    def from_row(cls, row: dict) -> "Event":
        import json
        row = dict(row)
        row["involved_person_ids"] = json.loads(row.get("involved_person_ids", "[]"))
        return cls(**row)


# 4. Reminder -- 待办 / 提醒

@dataclass
class Reminder:
    """待办 / 提醒"""
    id: str = field(default_factory=_new_id)
    event_id: Optional[str] = None
    title: str = ""
    content: str = ""
    due_time: Optional[str] = None
    status: str = "pending"
    priority: int = 3
    trigger_conditions: dict = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        import json
        d = asdict(self)
        d["trigger_conditions"] = json.dumps(self.trigger_conditions, ensure_ascii=False) if isinstance(self.trigger_conditions, dict) else self.trigger_conditions
        return d

    @classmethod
    def from_row(cls, row: dict) -> "Reminder":
        import json
        row = dict(row)
        row["trigger_conditions"] = json.loads(row.get("trigger_conditions", "{}"))
        return cls(**row)


# 5. Segment -- 音频 / 转录片段

@dataclass
class Segment:
    """音频 / 转录片段"""
    id: str = field(default_factory=_new_id)
    conversation_id: str = ""
    person_id: Optional[str] = None
    start_time: float = 0.0
    end_time: Optional[float] = None
    text: str = ""
    embedding: Optional[bytes] = None
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["embedding"] = None
        return d

    @classmethod
    def from_row(cls, row: dict) -> "Segment":
        row = dict(row)
        return cls(**row)
