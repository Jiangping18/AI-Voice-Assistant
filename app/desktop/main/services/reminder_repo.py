"""
提醒仓库 (ReminderRepository)

提供给智能体6(智能提醒与触达) 使用，负责提醒项的增删改查与状态流转。
"""

from typing import Optional
from .base_repository import BaseRepository
from .models import Reminder


class ReminderRepository(BaseRepository):
    """提醒 CRUD"""

    _TABLE = "reminders"
    _ROW_CLS = Reminder
    _PK = "id"

    def find_pending(self, limit: int = 50) -> list[Reminder]:
        """查询待触发的提醒"""
        return self.find_by("status", "pending", limit)

    def find_overdue(self, limit: int = 50) -> list[Reminder]:
        """查询已过期的 pending 提醒"""
        from .database import utc_now
        now = utc_now()
        sql = "SELECT * FROM reminders WHERE status = 'pending' AND due_time IS NOT NULL AND due_time < ? ORDER BY due_time ASC LIMIT ?"
        rows = self._conn().execute(sql, (now, limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_priority(self, min_priority: int = 3, limit: int = 50) -> list[Reminder]:
        """按优先级筛选"""
        sql = "SELECT * FROM reminders WHERE priority >= ? AND status = 'pending' ORDER BY priority DESC, due_time ASC LIMIT ?"
        rows = self._conn().execute(sql, (min_priority, limit)).fetchall()
        return [self._row_to_model(r) for r in rows]

    def find_by_event(self, event_id: str) -> list[Reminder]:
        """按关联事件查询"""
        return self.find_by("event_id", event_id)

    def mark_triggered(self, reminder_id: str) -> bool:
        """标记为已触发"""
        from .database import utc_now
        return self.update_fields(reminder_id, status="triggered", updated_at=utc_now())

    def mark_completed(self, reminder_id: str) -> bool:
        """标记为已完成"""
        from .database import utc_now
        return self.update_fields(reminder_id, status="completed", updated_at=utc_now())

    def mark_dismissed(self, reminder_id: str) -> bool:
        """标记为已忽略"""
        from .database import utc_now
        return self.update_fields(reminder_id, status="dismissed", updated_at=utc_now())
