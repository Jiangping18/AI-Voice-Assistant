"""
待办状态管理器 — 智能体6

职责:
  1. 标记完成/取消/过期
  2. 状态变更通过智能体2双向同步
  3. 过期待办自动归档，每日生成汇总通知

与智能体2（通信层）的交互:
    - 下行推送: send_reminder_update(reminder_id, status)
    - 上行接收: handle_status_report(raw_dict)

与智能体5（存储层）的交互:
    - ReminderRepository: mark_completed, mark_dismissed, update_fields
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Callable

# 兼容两种导入方式：作为 services 子包 vs 独立运行
try:
    from ..database import utc_now
    from ..reminder_repo import ReminderRepository
except ImportError:
    import sys, os
    _SERVICES_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _SERVICES_DIR not in sys.path:
        sys.path.insert(0, _SERVICES_DIR)
    from database import utc_now
    from reminder_repo import ReminderRepository

from .notification_push import NotificationPushService, ReminderStatusReport

logger = logging.getLogger("reminder.state")


class ReminderStateManager:
    """
    待办状态管理器

    负责:
        - PC 端本地状态变更（完成/取消）
        - 通知 智能体2 同步到手机端
        - 处理手机端上报的状态变更
        - 过期待办自动归档
        - 每日汇总通知

    用法:
        state_mgr = ReminderStateManager(push_service=push_service)
        state_mgr.mark_completed("some-uuid")
        state_mgr.handle_status_report({"id": "uuid", "status": "completed"})
        state_mgr.archive_overdue()
        summary = state_mgr.generate_daily_summary()
    """

    def __init__(
        self,
        push_service: Optional[NotificationPushService] = None,
    ):
        self._repo = ReminderRepository()
        self._push_service = push_service

    # ═══════════════════════════════════════════════════════════════
    # 状态变更（PC 端本地触发）
    # ═══════════════════════════════════════════════════════════════

    def mark_completed(self, reminder_id: str) -> bool:
        """
        标记待办为已完成

        参数:
            reminder_id: 待办 ID

        返回:
            bool: 是否成功
        """
        rem = self._repo.find_by_id(reminder_id)
        if not rem:
            logger.warning("待办不存在: id=%s", reminder_id)
            return False

        if rem.status == "completed":
            logger.debug("待办已为 completed 状态: id=%s", reminder_id)
            return True

        result = self._repo.mark_completed(reminder_id)
        if result:
            logger.info("待办已完成: id=%s content=%s",
                        reminder_id, (rem.content or rem.title)[:30])
            # 双向同步 → 通知手机端
            self._sync_to_mobile(reminder_id, "completed")
        return result

    def mark_cancelled(self, reminder_id: str) -> bool:
        """
        标记待办为已取消

        参数:
            reminder_id: 待办 ID
        """
        rem = self._repo.find_by_id(reminder_id)
        if not rem:
            logger.warning("待办不存在: id=%s", reminder_id)
            return False

        result = self._repo.update_fields(
            reminder_id, status="cancelled", updated_at=utc_now()
        )
        if result:
            logger.info("待办已取消: id=%s", reminder_id)
            self._sync_to_mobile(reminder_id, "cancelled")
        return result

    def mark_dismissed(self, reminder_id: str) -> bool:
        """
        标记待办为已忽略（用户不关心但不取消）

        参数:
            reminder_id: 待办 ID
        """
        result = self._repo.mark_dismissed(reminder_id)
        if result:
            logger.info("待办已忽略: id=%s", reminder_id)
        return result

    # ═══════════════════════════════════════════════════════════════
    # 手机端状态变更上报处理
    # ═══════════════════════════════════════════════════════════════

    def handle_status_report(self, report: ReminderStatusReport) -> bool:
        """
        处理手机端上报的状态变更（由 NotificationPushService 回调）

        参数:
            report: 手机端上报的状态变更

        返回:
            bool: 是否成功处理
        """
        if report.status == "completed":
            return self.mark_completed(report.id)
        elif report.status == "cancelled":
            return self.mark_cancelled(report.id)
        else:
            logger.warning("未知状态: id=%s status=%s", report.id, report.status)
            return False

    # ═══════════════════════════════════════════════════════════════
    # 过期归档
    # ═══════════════════════════════════════════════════════════════

    def archive_overdue(self) -> int:
        """
        将所有已过期且状态仍为 pending/triggered 的待办标记为 expired

        返回:
            int: 归档的待办数量
        """
        overdue = self._repo.find_overdue(limit=200)
        count = 0
        for rem in overdue:
            self._repo.update_fields(
                rem.id, status="expired", updated_at=utc_now()
            )
            count += 1

        if count > 0:
            logger.info("过期归档完成: %d 条已标记为 expired", count)
        return count

    def get_archived(self, since_days: int = 7, limit: int = 100) -> list:
        """
        获取已归档的待办

        参数:
            since_days: 最近多少天的归档
            limit:      最大条数
        """
        from ..database import DatabaseManager
        db = DatabaseManager.get_instance()
        conn = db.get_connection()

        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()

        sql = """SELECT * FROM reminders
                 WHERE status IN ('expired', 'completed', 'cancelled')
                   AND updated_at >= ?
                 ORDER BY updated_at DESC
                 LIMIT ?"""
        rows = conn.execute(sql, (cutoff, limit)).fetchall()
        from ..models import Reminder
        return [Reminder.from_row(dict(r)) for r in rows]

    # ═══════════════════════════════════════════════════════════════
    # 每日汇总
    # ═══════════════════════════════════════════════════════════════

    def generate_daily_summary(self) -> dict:
        """
        生成每日待办汇总

        统计:
            - 今日已完成
            - 今日已取消
            - 待处理（pending）
            - 已过期
            - 总览

        返回:
            {
                "date": "2026-06-13",
                "pending": 5,
                "completed_today": 2,
                "cancelled_today": 1,
                "overdue": 3,
                "total": 11,
                "items": [...]
            }
        """
        from ..database import DatabaseManager
        db = DatabaseManager.get_instance()
        conn = db.get_connection()

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # 统计数字
        pending_count = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE status='pending'"
        ).fetchone()["c"]

        completed_today = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE status='completed' AND updated_at >= ?",
            (today,),
        ).fetchone()["c"]

        cancelled_today = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE status='cancelled' AND updated_at >= ?",
            (today,),
        ).fetchone()["c"]

        overdue_count = conn.execute(
            "SELECT COUNT(*) as c FROM reminders WHERE status='pending' AND due_time IS NOT NULL AND due_time < ?",
            (utc_now(),),
        ).fetchone()["c"]

        total = conn.execute(
            "SELECT COUNT(*) as c FROM reminders"
        ).fetchone()["c"]

        # 今日待办清单
        from ..models import Reminder
        rows = conn.execute(
            """SELECT * FROM reminders
               WHERE status = 'pending'
                  OR (updated_at >= ? AND status IN ('completed', 'cancelled'))
               ORDER BY
                 CASE status
                   WHEN 'pending' THEN 0
                   WHEN 'triggered' THEN 1
                   ELSE 2
                 END,
                 due_time ASC
               LIMIT 50""",
            (today,),
        ).fetchall()
        items = [Reminder.from_row(dict(r)) for r in rows]

        summary = {
            "date": today,
            "pending": pending_count,
            "completed_today": completed_today,
            "cancelled_today": cancelled_today,
            "overdue": overdue_count,
            "total": total,
            "items": [
                {
                    "id": r.id,
                    "title": r.title,
                    "content": r.content,
                    "due_time": r.due_time,
                    "status": r.status,
                    "priority": r.priority,
                }
                for r in items
            ],
        }

        logger.info(
            "每日汇总: date=%s pending=%d completed=%d cancelled=%d overdue=%d",
            today, pending_count, completed_today, cancelled_today, overdue_count,
        )
        return summary

    # ═══════════════════════════════════════════════════════════════
    # 内部方法
    # ═══════════════════════════════════════════════════════════════

    def _sync_to_mobile(self, reminder_id: str, status: str):
        """
        将状态变更同步到手机端（通过智能体2）

        参数:
            reminder_id: 待办 ID
            status:      completed / cancelled
        """
        if not self._push_service:
            logger.debug("未注册 push_service，跳过同步: id=%s status=%s",
                         reminder_id, status)
            return

        from .notification_push import ReminderPushPayload
        payload = ReminderPushPayload(
            id=reminder_id,
            content="",  # 无需内容，仅状态同步
            deadline="",
            lead_minutes=0,
        )
        # 通过 push_service 发送状态变更（复用下行通道）
        if self._push_service._send_fn:
            try:
                success = self._push_service._send_fn(payload)
                if success:
                    logger.info("状态同步成功: id=%s status=%s", reminder_id, status)
                else:
                    logger.warning("状态同步失败: id=%s status=%s", reminder_id, status)
            except Exception as e:
                logger.error("状态同步异常: id=%s status=%s error=%s",
                             reminder_id, status, e)
