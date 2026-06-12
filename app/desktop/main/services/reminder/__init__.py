"""
智能提醒与触达 — 智能体6

对外统一接口:
    scheduleReminders(analysisResult) => dict

    接收智能体4（语义分析）输出的 AnalysisResult，
    提取 reminders 列表，校验入库后注册定时调度，
    通过智能体2（通信层）推送到手机端。

使用方式:
    from services.reminder import (
        scheduleReminders,
        ReminderService,
        ReminderScheduler,
        NotificationPushService,
        ReminderStateManager,
        ReminderPushPayload,
    )

    # 1. 创建各组件
    service = ReminderService()
    push_service = NotificationPushService(send_fn=my_send_fn)
    scheduler = ReminderScheduler(push_service=push_service)
    state_mgr = ReminderStateManager(push_service=push_service)

    # 2. 启动调度器
    scheduler.start()

    # 3. 从智能体4的分析结果注册待办
    result = scheduleReminders(analysis_result,
                                service=service,
                                scheduler=scheduler)

    # 4. 状态管理
    state_mgr.mark_completed("some-uuid")

    # 5. 停止调度器（应用退出时）
    scheduler.stop()

模块结构:
    reminder_service.py    -- 待办校验与入库
    scheduler.py           -- APScheduler 定时调度 + 轮询兜底
    notification_push.py   -- 通过智能体2推送到手机端
    state_manager.py       -- 待办状态管理 + 过期归档 + 每日汇总
"""

import logging

from .reminder_service import ReminderService, ReminderValidationError
from .scheduler import ReminderScheduler
from .notification_push import (
    NotificationPushService,
    ReminderPushPayload,
    ReminderStatusReport,
)
from .state_manager import ReminderStateManager

logger = logging.getLogger("reminder")

# ── 默认全局实例（方便快速使用） ────────────────────────────────
_default_service: ReminderService = None
_default_scheduler: ReminderScheduler = None
_default_push_service: NotificationPushService = None
_default_state_manager: ReminderStateManager = None


def _ensure_defaults():
    """惰性初始化全局默认实例"""
    global _default_service, _default_scheduler, _default_push_service, _default_state_manager
    if _default_service is None:
        _default_service = ReminderService()
    if _default_push_service is None:
        _default_push_service = NotificationPushService()
    if _default_scheduler is None:
        _default_scheduler = ReminderScheduler(push_service=_default_push_service)
    if _default_state_manager is None:
        _default_state_manager = ReminderStateManager(push_service=_default_push_service)


# ═══════════════════════════════════════════════════════════════════
# 对外统一接口：scheduleReminders(analysisResult) => void
# ═══════════════════════════════════════════════════════════════════


def scheduleReminders(analysis_result, service=None, scheduler=None) -> dict:
    """
    对外统一入口：从智能体4的分析结果中提取 reminders 并注册调度

    参数:
        analysis_result: AnalysisResult 对象或 dict（含 reminders 列表）
        service:    ReminderService 实例（可选，默认使用全局实例）
        scheduler:  ReminderScheduler 实例（可选，默认使用全局实例）

    返回:
        {
            "total": 3,
            "accepted": 2,
            "rejected": 1,
            "errors": ["第2条: deadline 是过去时间"],
            "reminder_ids": ["uuid1", "uuid2"]
        }

    示例:
        >>> from services.semantic_analysis.models import AnalysisResult
        >>> result = AnalysisResult(reminders=[...])
        >>> scheduleReminders(result)
        {"total": 3, "accepted": 2, ...}
    """
    _ensure_defaults()

    svc = service or _default_service
    sch = scheduler or _default_scheduler

    # 1. 校验并入库
    outcome = svc.schedule_from_analysis(analysis_result)

    # 2. 注册定时调度
    if sch and outcome["accepted"] > 0:
        for rid in outcome["reminder_ids"]:
            rem = svc.get_reminder_by_id(rid)
            if rem and rem.due_time:
                sch.schedule_reminder(rid, rem.due_time)

    logger.info(
        "scheduleReminders 完成: total=%d accepted=%d rejected=%d",
        outcome["total"], outcome["accepted"], outcome["rejected"],
    )
    return outcome


# ═══════════════════════════════════════════════════════════════════
# 便捷函数
# ═══════════════════════════════════════════════════════════════════


def start_scheduler(lead_times: list[int] = None):
    """启动全局调度器"""
    _ensure_defaults()
    if lead_times:
        _default_scheduler.set_lead_times(lead_times)
    _default_scheduler.start()
    logger.info("全局调度器已启动")


def stop_scheduler():
    """停止全局调度器"""
    if _default_scheduler:
        _default_scheduler.stop()
        logger.info("全局调度器已停止")


def get_daily_summary() -> dict:
    """获取每日待办汇总"""
    _ensure_defaults()
    return _default_state_manager.generate_daily_summary()


def archive_overdue() -> int:
    """归档过期待办"""
    _ensure_defaults()
    return _default_state_manager.archive_overdue()


# ── 导出清单 ─────────────────────────────────────────────────────

__all__ = [
    # 统一入口
    "scheduleReminders",

    # 类
    "ReminderService",
    "ReminderScheduler",
    "NotificationPushService",
    "ReminderStateManager",

    # 数据类
    "ReminderPushPayload",
    "ReminderStatusReport",
    "ReminderValidationError",

    # 便捷函数
    "start_scheduler",
    "stop_scheduler",
    "get_daily_summary",
    "archive_overdue",
]
