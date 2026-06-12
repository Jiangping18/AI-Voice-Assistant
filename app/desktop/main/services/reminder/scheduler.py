"""
提醒调度器 — 基于 APScheduler 的定时任务

职责:
  1. 注册定时任务，周期性扫描即将到期的待办
  2. 支持提前 15/30/60 分钟触发提醒（用户可配置）
  3. 触发时调用 NotificationPushService 推送到手机端

设计:
    - 启动时扫描所有 pending 的待办，为每条待办注册一次性触发器
    - 同时运行轮询循环（兜底），每分钟检查是否有到期未触发的待办
    - 支持动态添加/取消/重调度
"""

import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

# 兼容两种导入方式：作为 services 子包 vs 独立运行
try:
    from ..database import DatabaseManager, utc_now
    from ..reminder_repo import ReminderRepository
except ImportError:
    import sys, os
    _SERVICES_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _SERVICES_DIR not in sys.path:
        sys.path.insert(0, _SERVICES_DIR)
    from database import DatabaseManager, utc_now
    from reminder_repo import ReminderRepository

logger = logging.getLogger("reminder.scheduler")


class ReminderScheduler:
    """
    提醒调度器 — PC 端主调度

    基于 APScheduler 的 BackgroundScheduler，支持:
        - 提醒提前量: 15/30/60 分钟（可配置）
        - 轮询兜底: 每分钟检查到期待办
        - 动态添加/取消调度

    用法:
        scheduler = ReminderScheduler(push_service=push_service)
        scheduler.start()
        # ... 应用运行 ...
        scheduler.stop()
    """

    # ── 默认提前提醒时间配置（分钟） ──────────────────────────────
    DEFAULT_LEAD_TIMES = [15, 30, 60]

    def __init__(
        self,
        push_service=None,           # NotificationPushService 实例
        lead_times: Optional[list[int]] = None,
        poll_interval: int = 60,     # 轮询间隔（秒）
    ):
        """
        参数:
            push_service: NotificationPushService 实例（用于推送）
            lead_times:   提前提醒时间列表（分钟），默认 [15, 30, 60]
            poll_interval: 轮询兜底间隔（秒）
        """
        self._push_service = push_service
        self._lead_times = lead_times or self.DEFAULT_LEAD_TIMES
        self._poll_interval = max(10, poll_interval)  # 最少 10 秒
        self._repo = ReminderRepository()

        # APScheduler
        self._scheduler = None
        self._poll_job = None

        # 已注册的 job_id 集合，防止重复注册
        self._registered_jobs: set[str] = set()
        self._lock = threading.Lock()

        # 已触发的记录（job_id → set(lead_minutes)）
        self._triggered: dict[str, set[int]] = {}

    # ═══════════════════════════════════════════════════════════════
    # 启动 / 停止
    # ═══════════════════════════════════════════════════════════════

    def start(self):
        """启动调度器（首次注册所有已有待办 + 启动轮询）"""
        if self._scheduler and self._scheduler.running:
            logger.warning("调度器已在运行")
            return

        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.date import DateTrigger
        except ImportError:
            logger.error(
                "APScheduler 未安装，请执行: pip install apscheduler --break-system-packages"
            )
            # 降级：纯轮询模式（无需 APScheduler）
            self._start_polling_only()
            return

        self._scheduler = BackgroundScheduler(timezone=timezone.utc)
        self._scheduler.start()
        logger.info("APScheduler 已启动")

        # 注册已有待办
        self._reschedule_all()

        # 启动轮询兜底
        self._start_polling()

    def stop(self):
        """停止调度器"""
        if self._scheduler and self._scheduler.running:
            self._scheduler.shutdown(wait=False)
            logger.info("APScheduler 已停止")

        self._stop_polling()

    def _start_polling_only(self):
        """降级模式：仅轮询（无 APScheduler）"""
        self._scheduler = None
        self._start_polling()
        logger.info("调度器以降级模式运行（轮询仅兜底）")

    # ═══════════════════════════════════════════════════════════════
    # 待办注册
    # ═══════════════════════════════════════════════════════════════

    def schedule_reminder(self, reminder_id: str, due_time_str: str):
        """
        为一条待办注册所有提前提醒触发器

        参数:
            reminder_id:  reminders 表主键
            due_time_str: ISO 8601 截止时间
        """
        if reminder_id in self._registered_jobs:
            logger.debug("待办已注册，跳过: %s", reminder_id)
            return

        try:
            dt = datetime.fromisoformat(due_time_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError) as e:
            logger.error("解析截止时间失败: id=%s time=%s error=%s",
                         reminder_id, due_time_str, e)
            return

        now = datetime.now(timezone.utc)
        triggered_minutes: set[int] = set()

        for lead in sorted(self._lead_times, reverse=True):
            trigger_time = dt - timedelta(minutes=lead)
            if trigger_time <= now:
                # 如果提醒时间已经过去，不注册（轮询会兜底处理）
                logger.debug(
                    "提前 %d 分钟提醒已过期: id=%s trigger=%s",
                    lead, reminder_id, trigger_time.isoformat(),
                )
                continue

            if self._scheduler:
                from apscheduler.triggers.date import DateTrigger
                job_id = f"reminder_{reminder_id}_{lead}"
                try:
                    self._scheduler.add_job(
                        self._on_trigger,
                        trigger=DateTrigger(run_date=trigger_time),
                        args=[reminder_id, lead],
                        id=job_id,
                        replace_existing=False,
                        name=f"提醒-{reminder_id[:8]}-提前{lead}min",
                    )
                    triggered_minutes.add(lead)
                    logger.info(
                        "注册提醒触发器: id=%s lead=%dmin trigger_at=%s",
                        reminder_id, lead, trigger_time.isoformat(),
                    )
                except Exception as e:
                    logger.error("注册触发器失败: id=%s lead=%d error=%s",
                                 reminder_id, lead, e)

        with self._lock:
            self._registered_jobs.add(reminder_id)
            self._triggered[reminder_id] = triggered_minutes

    def cancel_schedule(self, reminder_id: str):
        """
        取消一条待办的所有触发器

        参数:
            reminder_id: reminders 表主键
        """
        if self._scheduler:
            for lead in self._lead_times:
                job_id = f"reminder_{reminder_id}_{lead}"
                try:
                    self._scheduler.remove_job(job_id)
                except Exception:
                    pass  # job 可能不存在

        with self._lock:
            self._registered_jobs.discard(reminder_id)
            self._triggered.pop(reminder_id, None)

        logger.info("已取消待办调度: id=%s", reminder_id)

    def reschedule_all(self):
        """重新注册所有 pending 待办（启动时及每日汇总后调用）"""
        self._reschedule_all()

    def _reschedule_all(self):
        """批量注册所有 pending 待办"""
        pending = self._repo.find_pending(limit=200)
        count = 0
        for rem in pending:
            if rem.due_time:
                self.schedule_reminder(rem.id, rem.due_time)
                count += 1
        logger.info("批量注册待办: %d 条", count)

    # ═══════════════════════════════════════════════════════════════
    # 轮询兜底
    # ═══════════════════════════════════════════════════════════════

    def _start_polling(self):
        """启动轮询线程"""
        self._polling_active = True
        self._poll_thread = threading.Thread(
            target=self._poll_loop,
            name="reminder-poll",
            daemon=True,
        )
        self._poll_thread.start()
        logger.info("轮询兜底已启动 (interval=%ds)", self._poll_interval)

    def _stop_polling(self):
        self._polling_active = False
        logger.info("轮询兜底已停止")

    def _poll_loop(self):
        """轮询线程主循环"""
        while getattr(self, "_polling_active", False):
            try:
                self._check_overdue()
            except Exception as e:
                logger.error("轮询异常: %s", e)
            threading.Event().wait(self._poll_interval)

    def _check_overdue(self):
        """
        检查已过期但尚未触发/完成的待办

        [提醒触发规则]
        到达截止时间时触发一次提醒（lead_minutes=0）。
        也处理已过期但尚未标记的待办。
        """
        overdue = self._repo.find_overdue(limit=50)
        for rem in overdue:
            # 标记为已触发
            self._repo.mark_triggered(rem.id)
            # 推送
            if self._push_service:
                from .notification_push import ReminderPushPayload
                payload = ReminderPushPayload(
                    id=rem.id,
                    content=rem.content or rem.title,
                    deadline=rem.due_time or "",
                    lead_minutes=0,
                )
                success = self._push_service.push(payload)
                if not success:
                    self._push_service.enqueue_offline(payload)

            logger.info("轮询触发过期待办: id=%s content=%s",
                        rem.id, (rem.content or rem.title)[:30])

    # ═══════════════════════════════════════════════════════════════
    # 回调
    # ═══════════════════════════════════════════════════════════════

    def _on_trigger(self, reminder_id: str, lead_minutes: int):
        """
        APScheduler 触发器回调

        参数:
            reminder_id: 待办 ID
            lead_minutes: 提前分钟数
        """
        rem = self._repo.find_by_id(reminder_id)
        if not rem:
            logger.warning("触发器回调: 待办不存在 id=%s", reminder_id)
            return

        # 避免重复推送（同一 id + 同一 lead 只推送一次）
        with self._lock:
            triggered_set = self._triggered.setdefault(reminder_id, set())
            if lead_minutes in triggered_set:
                logger.debug("已推送过，跳过: id=%s lead=%d", reminder_id, lead_minutes)
                return
            triggered_set.add(lead_minutes)

        if rem.status != "pending":
            logger.debug("待办状态非 pending，跳过推送: id=%s status=%s",
                         reminder_id, rem.status)
            return

        # 标记为已触发
        self._repo.mark_triggered(reminder_id)

        # 推送
        if self._push_service:
            from .notification_push import ReminderPushPayload
            payload = ReminderPushPayload(
                id=rem.id,
                content=rem.content or rem.title,
                deadline=rem.due_time or "",
                lead_minutes=lead_minutes,
                assignee="",
            )
            success = self._push_service.push(payload)
            if not success:
                self._push_service.enqueue_offline(payload)

        logger.info(
            "定时触发提醒: id=%s lead=%dmin content=%s",
            reminder_id, lead_minutes, (rem.content or rem.title)[:30],
        )

    # ═══════════════════════════════════════════════════════════════
    # 状态与配置
    # ═══════════════════════════════════════════════════════════════

    @property
    def is_running(self) -> bool:
        """调度器是否在运行"""
        return bool(self._scheduler and self._scheduler.running) or \
            getattr(self, "_polling_active", False)

    @property
    def registered_count(self) -> int:
        """已注册的待办数量"""
        return len(self._registered_jobs)

    def set_lead_times(self, lead_times: list[int]):
        """
        更新提前提醒时间（下次启动生效）

        参数:
            lead_times: 提前分钟数列表，如 [10, 30, 60]
        """
        self._lead_times = sorted(set(lead_times))
        logger.info("提前提醒时间已更新: %s", self._lead_times)
