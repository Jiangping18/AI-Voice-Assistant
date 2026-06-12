"""
智能体6 — 智能提醒调度服务 快速验证脚本

运行方式:
    cd app/desktop/main/
    python test_reminder_all.py

说明:
    使用临时目录存放测试数据库，不影响项目现有数据。
"""

import os
import sys
import json

# ── 使用临时目录存放测试数据库 ──────────────────────────────────
TEST_DB_DIR = "/tmp/ai_assistant_test"
os.makedirs(TEST_DB_DIR, exist_ok=True)
os.environ["MEMORY_DATA_DIR"] = TEST_DB_DIR

# 清除 DatabaseManager 的单例缓存（避免旧连接干扰）
if "services.database" in sys.modules:
    del sys.modules["services.database"]

MAIN_DIR = os.path.dirname(os.path.abspath(__file__))
if MAIN_DIR not in sys.path:
    sys.path.insert(0, MAIN_DIR)

from services.database import DatabaseManager, utc_now
from services.models import Reminder
from services.reminder_repo import ReminderRepository

PASS = 0
FAIL = 0


def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✓ {label}")
    else:
        FAIL += 1
        print(f"  ✗ {label}  {detail}")


def setup():
    db = DatabaseManager.get_instance()
    db.initialize_tables()
    conn = db.get_connection()
    conn.execute("DELETE FROM reminders")
    conn.commit()
    print(f"测试环境已初始化 (DB: {db.db_path})\n")


def cleanup():
    db = DatabaseManager.get_instance()
    conn = db.get_connection()
    conn.execute("DELETE FROM reminders")
    conn.commit()
    db.close_connection()
    print("\n  测试数据库已清理")


# ═══════════════════════════════════════════════════════════════════
# 测试用例
# ═══════════════════════════════════════════════════════════════════

def test_01_reminder_repo():
    """测试 reminders CRUD"""
    print("\n【01】ReminderRepository CRUD")
    repo = ReminderRepository()

    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    rem = Reminder(title="测试提醒", content="下午三点开会", due_time=future, priority=4)
    rid = repo.insert(rem)
    check("创建提醒返回 ID", len(rid) > 0)

    found = repo.find_by_id(rid)
    check("按 ID 查询", found is not None and found.title == "测试提醒")

    pending = repo.find_pending()
    check("查询 pending 列表", len(pending) >= 1)

    marked = repo.mark_completed(rid)
    check("标记完成", marked)
    done = repo.find_by_id(rid)
    check("状态变为 completed", done.status == "completed")

    repo.delete(rid)
    check("删除成功", repo.find_by_id(rid) is None)


def test_02_reminder_overdue():
    """测试过期查询"""
    print("\n【02】过期待办查询")
    repo = ReminderRepository()

    past = "2020-01-01T00:00:00Z"
    rem = Reminder(title="过期待办", content="已过期", due_time=past)
    rid = repo.insert(rem)

    overdue = repo.find_overdue()
    overdue_ids = [r.id for r in overdue]
    check("过期待办被查出", rid in overdue_ids)

    repo.delete(rid)


def test_03_state_transition():
    """测试状态流转"""
    print("\n【03】状态流转")
    repo = ReminderRepository()

    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    rem = Reminder(title="待办A", content="A内容", due_time=future, status="pending")
    rid = repo.insert(rem)

    repo.mark_triggered(rid)
    r = repo.find_by_id(rid)
    check("pending -> triggered", r.status == "triggered")

    repo.mark_completed(rid)
    r = repo.find_by_id(rid)
    check("triggered -> completed", r.status == "completed")

    repo.delete(rid)


def test_04_validation():
    """测试提醒校验逻辑"""
    print("\n【04】提醒校验逻辑")
    from services.reminder.reminder_service import ReminderService, ReminderValidationError

    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    # 合法待办
    item = {
        "content": "下午三点和客户开会",
        "assignee": "张三",
        "deadline": future,
        "confidence": 0.95,
    }
    reminder = svc._validate_and_build(item)
    check("title 包含负责人", reminder.title.startswith("[张三]"))
    check("content 保留原文", "下午三点和客户开会" in reminder.content)
    check("priority 高（confidence≥0.8=5）", reminder.priority == 5)
    check("status 为 pending", reminder.status == "pending")

    # 空内容
    try:
        svc._validate_and_build({"content": "", "deadline": future})
        check("空内容应抛出异常", False)
    except ReminderValidationError as e:
        check("空内容正确拦截", "content 不能为空" in str(e))

    # 过去时间
    try:
        svc._validate_and_build({"content": "测试", "deadline": "2020-01-01T00:00:00Z"})
        check("过去时间应抛出异常", False)
    except ReminderValidationError as e:
        check("过去时间正确拦截", "过去时间" in str(e))

    # 非法格式
    for bad in ["not-a-date", "2026-06-15", "2026/06/15T14:00:00"]:
        try:
            svc._validate_and_build({"content": "测试", "deadline": bad})
            check(f"非法格式正确拦截: {bad}", False)
        except ReminderValidationError:
            check(f"非法格式正确拦截: {bad}", True)


def test_05_schedule_from_analysis():
    """测试 schedule_from_analysis"""
    print("\n【05】分析结果入库")
    from services.reminder.reminder_service import ReminderService

    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future1 = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    future2 = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()

    # 全合法
    result = svc.schedule_from_analysis({
        "summary": "测试会议",
        "reminders": [
            {"content": "准备周报", "assignee": "我", "deadline": future1, "confidence": 0.9},
            {"content": "回复邮件", "assignee": "", "deadline": future2, "confidence": 0.7},
        ],
    })
    check("全部接受", result["accepted"] == 2, str(result))
    check("无拒绝", result["rejected"] == 0, str(result))
    check("返回 2 个 ID", len(result["reminder_ids"]) == 2)

    # 部分合法
    result2 = svc.schedule_from_analysis({
        "reminders": [
            {"content": "有效待办", "assignee": "", "deadline": future1, "confidence": 0.8},
            {"content": "", "assignee": "", "deadline": future1, "confidence": 0.5},
        ],
    })
    check("1 条接受", result2["accepted"] == 1, str(result2))
    check("1 条拒绝", result2["rejected"] == 1, str(result2))
    check("有错误信息", len(result2["errors"]) > 0)


def test_06_add_reminder():
    """测试直接添加"""
    print("\n【06】直接添加待办")
    from services.reminder.reminder_service import ReminderService

    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    rid = svc.add_reminder(content="直接添加测试", deadline=future, assignee="测试")
    check("返回 ID", len(rid) > 0)

    found = svc.get_reminder_by_id(rid)
    check("查询存在", found is not None)
    check("优先级默认 3", found.priority == 3)

    ReminderRepository().delete(rid)


def test_07_notification_push():
    """测试通知推送"""
    print("\n【07】通知推送")
    from services.reminder.notification_push import (
        NotificationPushService, ReminderPushPayload,
    )

    pushed = []
    def mock_send(payload):
        pushed.append(payload)
        return True

    ps = NotificationPushService(send_fn=mock_send)
    payload = ReminderPushPayload(
        id="test-id", content="测试推送",
        deadline="2026-06-15T14:00:00+08:00", lead_minutes=15,
    )
    result = ps.push(payload)
    check("推送成功", result)
    check("回调被调用", len(pushed) == 1)

    # 离线队列
    ps2 = NotificationPushService()
    payload2 = ReminderPushPayload(
        id="offline", content="离线",
        deadline="2026-06-15T14:00:00+08:00", lead_minutes=30,
    )
    result = ps2.push(payload2)
    check("无 send_fn 时推送失败", not result)
    ps2.enqueue_offline(payload2)
    check("离线队列长度=1", ps2.offline_queue_size == 1)

    ps2.set_send_fn(lambda p: True)
    count = ps2.flush_offline_queue()
    check("补推成功", count == 1)
    check("队列已清空", ps2.offline_queue_size == 0)


def test_08_status_report():
    """测试手机端状态变更"""
    print("\n【08】手机端状态变更")
    from services.reminder.notification_push import NotificationPushService

    received = []
    def on_change(report):
        received.append(report)

    ps = NotificationPushService(on_status_change=on_change)
    result = ps.handle_status_report({
        "type": "reminder_status",
        "payload": {"id": "test-uuid-123", "status": "completed"},
    })
    check("处理成功", result)
    check("回调被触发", len(received) == 1)
    check("ID 正确", received[0].id == "test-uuid-123")
    check("状态正确", received[0].status == "completed")

    # 非法状态
    result = ps.handle_status_report({
        "type": "reminder_status",
        "payload": {"id": "test-uuid", "status": "unknown"},
    })
    check("非法状态返回 False", not result)


def test_09_state_manager():
    """测试状态管理器"""
    print("\n【09】状态管理器")
    from services.reminder.state_manager import ReminderStateManager
    repo = ReminderRepository()

    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    mgr = ReminderStateManager()

    # completed
    rem = Reminder(title="状态测试", content="测试", due_time=future, status="pending")
    rid = repo.insert(rem)
    result = mgr.mark_completed(rid)
    check("标记完成", result)
    r = repo.find_by_id(rid)
    check("状态 completed", r.status == "completed")
    result = mgr.mark_completed(rid)
    check("重复标记仍 True", result)

    # cancelled
    rem2 = Reminder(title="取消测试", content="测试", due_time=future, status="pending")
    rid2 = repo.insert(rem2)
    result = mgr.mark_cancelled(rid2)
    check("标记取消", result)
    r2 = repo.find_by_id(rid2)
    check("状态 cancelled", r2.status == "cancelled")

    repo.delete(rid)
    repo.delete(rid2)


def test_10_daily_summary_and_archive():
    """测试每日汇总与过期归档"""
    print("\n【10】每日汇总与过期归档")
    from services.reminder.state_manager import ReminderStateManager
    from services.reminder.reminder_service import ReminderService

    repo = ReminderRepository()

    # 插入过期待办
    svc = ReminderService()
    svc.add_reminder(content="已过期任务", deadline="2020-01-01T00:00:00Z")

    # 归档
    mgr = ReminderStateManager()
    count = mgr.archive_overdue()
    check("有归档待办", count >= 1)

    archived = mgr.get_archived(since_days=3650)
    expired = [r for r in archived if r.status == "expired"]
    check("过期待办已归档", len(expired) >= 1)

    # 每日汇总
    summary = mgr.generate_daily_summary()
    check("汇总包含 date", "date" in summary)
    check("汇总包含 pending", "pending" in summary)
    check("汇总包含 items", isinstance(summary["items"], list))
    print(f"  今日汇总: pending={summary['pending']} "
          f"completed={summary['completed_today']} "
          f"overdue={summary['overdue']} "
          f"total={summary['total']}")

    for e in expired:
        repo.delete(e.id)


def test_11_scheduler():
    """测试调度器"""
    print("\n【11】调度器")
    from services.reminder.scheduler import ReminderScheduler

    scheduler = ReminderScheduler(lead_times=[15, 30])
    check("初始未运行", not scheduler.is_running)
    check("注册数为 0", scheduler.registered_count == 0)

    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    scheduler.schedule_reminder("test-schedule-id", future)
    check("注册成功", scheduler.registered_count > 0)

    scheduler.cancel_schedule("test-schedule-id")
    check("取消后注册数为 0", scheduler.registered_count == 0)


def test_12_unified_interface():
    """测试统一接口 scheduleReminders"""
    print("\n【12】统一接口")
    from services.reminder import scheduleReminders
    from datetime import datetime, timezone, timedelta

    future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
    result = scheduleReminders({
        "reminders": [
            {"content": "统一接口测试", "assignee": "测试", "deadline": future, "confidence": 0.85},
        ],
    })
    check("接受待办", result["accepted"] == 1, str(result))
    check("返回 ID", len(result["reminder_ids"]) > 0)


if __name__ == "__main__":
    print("=" * 60)
    print("  智能体6 — 智能提醒调度服务 验证 (16 项测试)")
    print("=" * 60)

    setup()

    test_01_remin