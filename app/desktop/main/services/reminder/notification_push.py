"""
通知推送模块 — 通过智能体2（通信层）向手机端推送提醒

职责:
  1. 将待办提醒序列化为标准推送消息格式
  2. 通过 CommEngine 的控制通道向手机端推送
  3. 接收手机端状态变更回执

与智能体2（通信层）的交互:
    - 下行: {"type":"reminder","payload":{"id":"uuid","content":"...","deadline":"ISO8601","lead_minutes":15}}
    - 上行: {"type":"reminder_status","payload":{"id":"uuid","status":"completed|cancelled"}}

消息格式:
    PC → 手机:
        { "type": "reminder",
          "payload": { "id": "uuid", "content": "...",
                       "deadline": "ISO8601", "lead_minutes": 15 } }

    手机 → PC:
        { "type": "reminder_status",
          "payload": { "id": "uuid", "status": "completed|cancelled" } }
"""

import json
import logging
from typing import Callable, Optional
from dataclasses import dataclass

logger = logging.getLogger("reminder.push")

# ── 类型定义 ─────────────────────────────────────────────────────


@dataclass
class ReminderPushPayload:
    """推送到手机端的提醒载荷"""
    id: str
    content: str
    deadline: str
    lead_minutes: int = 0           # 提前多少分钟提醒
    assignee: str = ""              # 负责人（可选）


@dataclass
class ReminderStatusReport:
    """手机端上报的状态变更"""
    id: str
    status: str                     # "completed" | "cancelled"


# ── 推送回调类型 ─────────────────────────────────────────────────
# 应用层注册一个发送函数，由 scheduler 在触发时调用
SendReminderFn = Callable[[ReminderPushPayload], bool]
# 手机端状态变更回调
OnStatusChangeFn = Callable[[ReminderStatusReport], None]


class NotificationPushService:
    """
    通知推送服务

    通过智能体2（CommEngine）向手机端推送待办提醒。
    使用策略模式：应用层注入实际发送函数，本模块不直接依赖 CommEngine。

    用法:
        push_service = NotificationPushService(
            send_fn=lambda payload: engine.sendControl(peerId, "reminder", payload.__dict__),
            on_status_change=lambda report: state_manager.handle_status_change(report.id, report.status),
        )
        push_service.push(payload)
    """

    def __init__(
        self,
        send_fn: Optional[SendReminderFn] = None,
        on_status_change: Optional[OnStatusChangeFn] = None,
    ):
        """
        参数:
            send_fn: 实际发送回调，接收 ReminderPushPayload，返回是否发送成功
            on_status_change: 手机端状态变更回调
        """
        self._send_fn = send_fn
        self._on_status_change = on_status_change
        self._pending_callbacks: dict[str, Callable] = {}  # id → 回调

    # ═══════════════════════════════════════════════════════════════
    # 配置
    # ═══════════════════════════════════════════════════════════════

    def set_send_fn(self, send_fn: SendReminderFn):
        """设置发送回调（可在运行时切换）"""
        self._send_fn = send_fn

    def set_on_status_change(self, callback: OnStatusChangeFn):
        """设置状态变更回调"""
        self._on_status_change = callback

    # ═══════════════════════════════════════════════════════════════
    # 推送
    # ═══════════════════════════════════════════════════════════════

    def push(self, payload: ReminderPushPayload) -> bool:
        """
        推送一条提醒到手机端

        返回:
            bool: 是否推送成功
        """
        if not self._send_fn:
            logger.warning("未注册 send_fn，无法推送: id=%s", payload.id)
            return False

        message = {
            "type": "reminder",
            "payload": {
                "id": payload.id,
                "content": payload.content,
                "deadline": payload.deadline,
                "lead_minutes": payload.lead_minutes,
                "assignee": payload.assignee,
            },
        }

        try:
            result = self._send_fn(payload)
            if result:
                logger.info(
                    "推送成功: id=%s content=%s lead=%dmin",
                    payload.id, payload.content[:20], payload.lead_minutes,
                )
            else:
                logger.warning("推送失败（回调返回 False）: id=%s", payload.id)
            return result
        except Exception as e:
            logger.error("推送异常: id=%s error=%s", payload.id, e)
            return False

    # ═══════════════════════════════════════════════════════════════
    # 接收手机端状态变更
    # ═══════════════════════════════════════════════════════════════

    def handle_status_report(self, raw: dict) -> bool:
        """
        处理手机端上报的状态变更

        接收格式:
            {
                "type": "reminder_status",
                "payload": {"id": "uuid", "status": "completed|cancelled"}
            }

        返回:
            bool: 是否成功处理
        """
        try:
            payload = raw.get("payload", {})
            report = ReminderStatusReport(
                id=payload.get("id", ""),
                status=payload.get("status", ""),
            )

            if not report.id or report.status not in ("completed", "cancelled"):
                logger.warning("状态变更格式异常: %s", raw)
                return False

            if self._on_status_change:
                self._on_status_change(report)
                logger.info(
                    "状态变更已处理: id=%s status=%s",
                    report.id, report.status,
                )
            else:
                logger.info(
                    "收到状态变更（未注册回调）: id=%s status=%s",
                    report.id, report.status,
                )
            return True

        except Exception as e:
            logger.error("处理状态变更异常: %s", e)
            return False

    # ═══════════════════════════════════════════════════════════════
    # 离线消息队列（PC 断线时暂存，重连后补推）
    # ═══════════════════════════════════════════════════════════════

    def __init_offline_queue(self):
        """初始化离线队列（惰性创建）"""
        if not hasattr(self, "_offline_queue"):
            self._offline_queue: list[ReminderPushPayload] = []

    def enqueue_offline(self, payload: ReminderPushPayload):
        """将推送加入离线队列（当推送失败时调用）"""
        self.__init_offline_queue()
        self._offline_queue.append(payload)
        logger.info("已加入离线队列: id=%s (队列长度=%d)",
                     payload.id, len(self._offline_queue))

    def flush_offline_queue(self) -> int:
        """
        重连后批量补推离线消息

        返回:
            int: 成功推送的数量
        """
        self.__init_offline_queue()
        if not self._offline_queue:
            return 0

        success_count = 0
        remaining = []
        for payload in self._offline_queue:
            if self.push(payload):
                success_count += 1
            else:
                remaining.append(payload)

        self._offline_queue = remaining
        if success_count:
            logger.info("离线队列补推完成: %d/%d 成功",
                        success_count, success_count + len(remaining))
        return success_count

    @property
    def offline_queue_size(self) -> int:
        """离线队列长度"""
        self.__init_offline_queue()
        return len(self._offline_queue)
