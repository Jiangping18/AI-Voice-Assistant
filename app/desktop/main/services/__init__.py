"""
记忆存储与检索服务 — 智能体5

提供给 智能体4(语义分析/RAG)、智能体6(智能提醒)、智能体7(知识图谱) 的统一数据访问层。

使用方式:
    from services import (
        QueryService,
        ConversationRepository,
        PersonRepository,
        EventRepository,
        ReminderRepository,
        SegmentRepository,
        VectorStore,
        GraphStore,
        DatabaseManager,
    )

    # 1. 启动时初始化数据库
    db = DatabaseManager.get_instance()
    db.initialize_tables()

    # 2. 创建查询服务
    qs = QueryService()

    # 3. 统一检索
    result = qs.search(query="开会讨论了预算", filters={"type": "action_item"}, top_k=5)
"""

from .database import DatabaseManager, utc_now
from .models import Conversation, Person, Event, Reminder, Segment
from .conversation_repo import ConversationRepository
from .person_repo import PersonRepository
from .event_repo import EventRepository
from .reminder_repo import ReminderRepository
from .segment_repo import SegmentRepository
from .vector_store import VectorStore
from .graph_store import GraphStore
from .query_service import QueryService

__all__ = [
    # 数据库管理
    "DatabaseManager",
    "utc_now",

    # 数据模型
    "Conversation",
    "Person",
    "Event",
    "Reminder",
    "Segment",

    # 仓库层 CRUD
    "ConversationRepository",
    "PersonRepository",
    "EventRepository",
    "ReminderRepository",
    "SegmentRepository",

    # 扩展存储（预留接口）
    "VectorStore",
    "GraphStore",

    # 统一查询入口
    "QueryService",
]
