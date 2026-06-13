"""
提醒调度服务核心模块 — 智能体6

职责:
  1. 解析智能体4输出的 AnalysisResult.reminders 列表
  2. 校验每条待办的合法性（内容非空、deadline 为未来时间、ISO 8601 格式正确）
  3. 写入 SQLite reminders 表，初始状态 pending

与智能体4（语义分析）的交互:
    schedule_from_analysis(analysis_result: AnalysisResult) -> list[dict]

与智能体5（存储层）的交互:
    ReminderRepository.insert() -> 写入 reminders 表
"""

import re
import logging
from datetime import datetime, timezone
from typing import Optional

# 兼容两种导入方式：作为 services 子包 vs 独立运行
try:
    from ..database import DatabaseManager, utc_now
    from ..models import Reminder
    from ..reminder_repo import ReminderRepository
except ImportError:
    import sys, os
    _SERVICES_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _SERVICES_DIR not in sys.path:
        sys.path.insert(0, _SERVICES_DIR)
    from database import DatabaseManager, utc_now
    from models import Reminder
    from reminder_repo import ReminderRepository

logger = logging.getLogger("reminder.service")

# ISO 8601 正则（支持带时区偏移 +-HH:MM 或 Z）
ISO8601_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
)


class ReminderValidationError(ValueError):
    """待办校验失败"""
    pass


class ReminderService:
    """
    提醒服务 — 待办校验与入库
    """

    def __init__(self):
        self._repo = ReminderRepository()
        self._db = DatabaseManager.get_instance()

    def schedule_from_analysis(self, analysis_result) -> dict:
        """
        从语义分析结果中提取 reminders 列表，校验后写入数据库

        参数:
            analysis_result: AnalysisResult 对象或 dict

        返回:
            {"total": N, "accepted": N, "rejected": N, "errors": [], "reminder_ids": []}
        """
        raw_list = self._extract_reminder_list(analysis_result)
        if not raw_list:
            return {"total": 0, "accepted": 0, "rejected": 0,
                    "errors": [], "reminder_ids": []}

        accepted, rejected, errors = [], [], []
        for idx, item in enumerate(raw_list):
            try:
                reminder = self._validate_and_build(item)
                rid = self._repo.insert(reminder)
                accepted.append(rid)
                logger.info("待办已入库: id=%s content=%s deadline=%s",
                            rid, reminder.title, reminder.due_time)
            except ReminderValidationError as e:
                rejected.append(idx)
                errors.append(f"第{idx + 1}条: {e}")
                logger.warning("待办校验失败 [%d]: %s", idx, e)

        return {
            "total": len(raw_list),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "errors": errors,
            "reminder_ids": accepted,
        }

    def add_reminder(self, content: str, deadline: str,
                     assignee: Optional[str] = None,
                     priority: int = 3,
                     event_id: Optional[str] = None) -> str:
        """直接添加一条待办"""
        reminder = self._validate_and_build({
            "content": content,
            "assignee": assignee or "",
            "deadline": deadline,
            "confidence": 1.0,
        })
        if assignee:
            reminder.content = f"[{assignee}] {reminder.content}"
        if priority != 3:
            reminder.priority = priority
        if event_id:
            reminder.event_id = event_id

        rid = self._repo.insert(reminder)
        logger.info("直接添加待办: id=%s content=%s", rid, reminder.title)
        return rid

    @staticmethod
    def _extract_reminder_list(analysis_result):
        """从不同输入格式中提取 reminder 列表"""
        if hasattr(analysis_result, "reminders"):
            return analysis_result.reminders or []
        if isinstance(analysis_result, dict):
            return analysis_result.get("reminders", [])
        return []

    @staticmethod
    def _validate_and_build(item: dict) -> Reminder:
        """校验单条 reminder，返回 Reminder 模型对象"""
        # content
        raw_content = item.get("content", "")
        if not raw_content or not raw_content.strip():
            raise ReminderValidationError("content 不能为空")

        # deadline - 空值自动兜底为明天
        deadline = item.get("deadline")
        if not deadline:
            from datetime import timedelta
            fallback = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT23:59:59+00:00")
            deadline = fallback
            logger.warning(f"deadline 为空，自动兜底为: {fallback}")

        deadline_str = str(deadline).strip()
        if not ISO8601_PATTERN.match(deadline_str):
            # 格式不对则兜底为明天
            from datetime import timedelta
            fallback = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT23:59:59+00:00")
            deadline_str = fallback
            logger.warning(f"deadline 格式非法（{deadline_str}），自动兜底为: {fallback}")

        # Python 3.10 不支持 Z 后缀，替换为 +00:00
        normalized = deadline_str
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"

        try:
            dt = datetime.fromisoformat(normalized)
        except (ValueError, TypeError) as e:
            raise ReminderValidationError(f"deadline 解析失败: {e}") from e

        now_utc = datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt_utc = dt.replace(tzinfo=timezone.utc)
        else:
            dt_utc = dt.astimezone(timezone.utc)
        if dt_utc < now_utc:
            from datetime import timedelta
            fallback = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT23:59:59+00:00")
            logger.warning(f"deadline 是过去时间（{deadline_str}），自动兜底为: {fallback}")
            deadline_str = fallback
            normalized = fallback

        # 可选字段
        assignee = item.get("assignee", "")
        confidence = item.get("confidence", 1.0)

        title = raw_content.strip()
        if assignee:
            title = f"[{assignee}] {title}"

        priority = 3
        if isinstance(confidence, (int, float)):
            if confidence >= 0.8:
                priority = 5
            elif confidence >= 0.6:
                priority = 4
            elif confidence <= 0.3:
                priority = 2

        return Reminder(
            title=title,
            content=raw_content.strip(),
            due_time=deadline_str,
            status="pending",
            priority=priority,
        )

    def get_pending_reminders(self, limit: int = 50) -> list:
        return self._repo.find_pending(limit)

    def get_upcoming_reminders(self, minutes: int = 60, limit: int = 50) -> list:
        from datetime import timedelta
        now = utc_now()
        dt_now = datetime.fromisoformat(now)
        dt_end = dt_now + timedelta(minutes=minutes)
        end_str = dt_end.isoformat()
        conn = self._db.get_connection()
        sql = """SELECT * FROM reminders
                 WHERE status = 'pending'
                   AND due_time IS NOT NULL
                   AND due_time >= ?
                   AND due_time <= ?
                 ORDER BY due_time ASC LIMIT ?"""
        rows = conn.execute(sql, (now, end_str, limit)).fetchall()
        from ..models import Reminder as RM
        return [RM.from_row(dict(r)) for r in rows]

    def get_reminder_by_id(self, reminder_id: str) -> Optional[Reminder]:
        return self._repo.find_by_id(reminder_id)
