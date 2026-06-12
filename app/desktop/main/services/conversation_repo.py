"""
对话会话仓库 (ConversationRepository)

提供给智能体4(语义分析/RAG) 和智能体7(知识图谱) 使用。
"""

from typing import Optional
from .base_repository import BaseRepository
from .models import Conversation


class ConversationRepository(BaseRepository):
    """对话会话 CRUD"""

    _TABLE = "conversations"
    _ROW_CLS = Conversation
    _PK = "id"

    # ── 业务查询 ────────────────────────────────────────────────

    def find_active(self, limit: int = 20) -> list[Conversation]:
        """查询所有活跃中的对话"""
        return self.find_by("status", "active", limit)

    def find_completed(self, limit: int = 20) -> list[Conversation]:
        """查询已完成的对话"""
        return self.find_by("status", "completed", limit)

    def find_by_time_range(self, start: str, end: str, limit: int = 50) -> list[Conversation]:
        """按时间范围查询"""
        sql = "SELECT * FROM conversations WHERE start_time >= ? AND start_time <= ? ORDER BY start_time DESC LIMIT ?"
        rows = self._conn().execute(sql, (start, end, limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_participant(self, person_id: str, limit: int = 50) -> list[Conversation]:
        """查找包含某人的所有对话（JSON 数组模糊匹配）"""
        sql = "SELECT * FROM conversations WHERE participant_ids LIKE ? ORDER BY start_time DESC LIMIT ?"
        rows = self._conn().execute(sql, (f"%{person_id}%", limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def mark_completed(self, conversation_id: str, summary: str = "") -> bool:
        """标记对话为已完成"""
        from .database import utc_now
        fields = {
            "status": "completed",
            "end_time": utc_now(),
            "updated_at": utc_now(),
        }
        if summary:
            fields["summary"] = summary
        return self.update_fields(conversation_id, **fields)
