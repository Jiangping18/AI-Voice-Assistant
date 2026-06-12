"""
事件仓库 (EventRepository)

提供给智能体4(语义分析/RAG)、智能体6(提醒触达)、智能体7(知识图谱) 使用。
"""

from typing import Optional
from .base_repository import BaseRepository
from .models import Event


class EventRepository(BaseRepository):
    """事件 CRUD"""

    _TABLE = "events"
    _ROW_CLS = Event
    _PK = "id"

    # ── 业务查询 ────────────────────────────────────────────────

    def find_by_conversation(self, conversation_id: str) -> list[Event]:
        """按对话查询所有事件"""
        return self.find_by("conversation_id", conversation_id)

    def find_by_type(self, event_type: str, limit: int = 50) -> list[Event]:
        """按事件类型筛选"""
        return self.find_by("type", event_type, limit)

    def find_recent(self, limit: int = 20) -> list[Event]:
        """最近创建的事件"""
        sql = "SELECT * FROM events ORDER BY created_at DESC LIMIT ?"
        rows = self._conn().execute(sql, (limit,)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_person_involved(self, person_id: str, limit: int = 50) -> list[Event]:
        """查找涉及某人的事件"""
        sql = "SELECT * FROM events WHERE involved_person_ids LIKE ? ORDER BY created_at DESC LIMIT ?"
        rows = self._conn().execute(sql, (f"%{person_id}%", limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def delete_by_conversation(self, conversation_id: str) -> int:
        """级联删除某个对话的所有事件"""
        sql = "DELETE FROM events WHERE conversation_id = ?"
        cursor = self._conn().execute(sql, (conversation_id,))
        self._conn().commit()
        return cursor.rowcount
