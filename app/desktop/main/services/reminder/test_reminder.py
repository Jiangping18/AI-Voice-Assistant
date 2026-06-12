"""
智能体6 — 智能提醒调度服务 验证脚本

运行方式:
    cd app/desktop/main/
    python -m services.reminder.test_reminder

依赖:
    pip install apscheduler --break-system-packages   （可选，降级运行无需安装）
"""

import os
import sys
import json

# ── 确保能找到服务模块 ─────────────────────────────────────────
SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SERVICES_DIR)  # services/
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

# 现在 services 是包，可以用相对和绝对导入了
from services.database import DatabaseManager, utc_now
from services.models import Reminder
from services.reminder_repo import ReminderRepository
from services.reminder.reminder_service import ReminderService, ReminderValidationError
from services.reminder.scheduler import ReminderScheduler
from services.reminder.state_manager import ReminderStateManager
from services.reminder.notification_push import (
    NotificationPushService,
    ReminderPushPayload,
    ReminderStatusReport,
)
from services.reminder import scheduleReminders

PASS = 0
FAIL = 0


def check(label: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ {label}")
    else:
        FAIL += 1
        print(f"  ❌ {label}  {detail}")


def setup():
    """初始化数据库（隔离测试环境）"""
    db = DatabaseManager.get_instance()
    db.initialize_tables()
    # 清理 reminders 表
    conn = db.get_connection()
    conn.execute("DELETE FROM reminders")
    conn.commit()
    print("测试环境已初始化\n")


def test_01_validate_valid_reminder():
    """测试合法待办校验"""
    print("\n【01】合法待办校验")
    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    item = {
        "content": "下午三点和客户开会",
        "assignee": "张三",
        "deadline": future,
        "confidence": 0.95,
    }
    reminder = svc._validate_and_build(item)
    check("title 包含负责人", reminder.title.startswith("[张三]"))
    check("content 保留原文", "下午三点和客户开会" in reminder.content)
    check("priority 高（confidence≥0.8）", reminder.priority == 5)
    check("status 为 pending", reminder.status == "pending")
    check("id 不为空", len(reminder.id) > 0)


def test_02_validate_missing_content():
    """测试空内容校验失败"""
    print("\n【02】空内容校验")
    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    try:
        svc._validate_and_build({"content": "", "deadline": future})
        check("空内容应抛出异常", False)
    except ReminderValidationError as e:
        check("空内容校验正确拦截", "content 不能为空" in str(e))


def test_03_validate_past_deadline():
    """测试过去时间校验失败"""
    print("\n【03】过去时间校验")
    svc = ReminderService()

    try:
        svc._validate_and_build({
            "content": "测试",
            "deadline": "2020-01-01T00:00:00Z",
        })
        check("过去时间应抛出异常", False)
    except ReminderValidationError as e:
        check("过去时间校验正确拦截", "过去时间" in str(e))


def test_04_validate_bad_iso():
    """测试非法 ISO 8601 格式"""
    print("\n【04】非法 ISO 8601 格式")
    svc = ReminderService()

    for bad_deadline in ["not-a-date", "2026-06-15", "2026/06/15T14:00:00"]:
        try:
            svc._validate_and_build({"content": "测试", "deadline": bad_deadline})
            check(f"非法格式应抛出异常: {bad_deadline}", False)
        except ReminderValidationError:
            check(f"非法格式正确拦截: {bad_deadline}", True)


def test_05_schedule_from_analysis_accepted():
    """测试从 AnalysisResult 提取并入库（全部合法）"""
    print("\n【05】AnalysiResult 提取入库（全部合法）")
    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future1 = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    future2 = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()

    # 模拟 AnalysisResult 风格的 dict
    analysis_dict = {
        "summary": "测试会议",
        "reminders": [
            {"content": "准备周报", "assignee": "我", "deadline": future1, "confidence": 0.9},
            {"content": "回复邮件", "assignee": "", "deadline": future2, "confidence": 0.7},
        ],
    }

    result = svc.schedule_from_analysis(analysis_dict)
    check("全部接受", result["accepted"] == 2, str(result))
    check("无拒绝", result["rejected"] == 0, str(result))
    check("返回 ID 列表长度=2", len(result["reminder_ids"]) == 2, str(result))


def test_06_schedule_from_analysis_partial():
    """测试部分合法/部分非法"""
    print("\n【06】部分合法 + 部分非法")
    svc = ReminderService()
    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()

    analysis_dict = {
        "reminders": [
            {"content": "有效待办", "assignee": "", "deadline": future, "confidence": 0.8},
            {"content": "", "assignee": "", "deadline": future, "confidence": 0.5},
        ],
    }

    result = svc.schedule_from_analysis(analysis_dict)
    check("1 条接受", result["accepted"] == 1, str(result))
    check("1 条拒绝", result["rejected"] == 1, str(result))
    check("有错误信息", len(result["errors"]) > 0)


def test_07_db_persistence():
    """验证数据已写入数据库且可查询"""
    print("\n【07】数据库持久化验证")
    repo = ReminderRepository()
    pending = repo.find_pending()
    check("有 pending 待办", len(pending) >= 2)
    for r in pending[:2]:
        check(f"  待办: id={r.id[:8]} title={r.title[:20]} status={r.status}",
              r.status == "pending")


def test_08_mark_completed():
    """测试标记完成"""
    print("\n【08】标记完成")
    mgr = ReminderStateManager()
    repo = ReminderRepository()
    pending = repo.find_pending()
    if pending:
        rid = pending[0].id
        result = mgr.mark_completed(rid)
        check("标记完成成功", result)
        updated = repo.find_by_id(rid)
        check("状态变为 completed", updated.status == "completed")


def test_09_mark_cancelled():
    """测试标记取消"""
    print("\n【09】标记取消")
    mgr = ReminderStateManager()
    repo = ReminderRepository()
    pending = repo.find_pending()
    if pending:
        rid = pending[0].id
        result = mgr.mark_cancelled(rid)
        check("标记取消成功", result)
        updated = repo.find_by_id(rid)
        check("状态变为 cancelled", updated.status == "cancelled")


def test_10_daily_summary():
    """测试每日汇总"""
    print("\n【10】每日汇总")
    mgr = ReminderStateManager()
    summary = mgr.generate_daily_summary()
    check("汇总包含 date", "date" in summary)
    check("汇总包含 pending 计数", "pending" in summary)
    check("汇总包含 items 列表", isinstance(summary["items"], list))
    print(f"  汇总: {json.dumps(summary, ensure_ascii=False, indent=2)}")


def test_11_archive_overdue():
    """测试过期归档"""
    print("\n【11】过期归档")
    svc = ReminderService()
    # 插入一条已过期待办
    svc.add_reminder(content="过期待办", deadline="2020-01-01T00:00:00Z")

    mgr = ReminderStateManager()
    count = mgr.archive_overdue()
    check("有归档的待办", count >= 1)

    archived = mgr.get_archived(since_days=3650)
    expired = [r for r in archived if r.status == "expired"]
    check("过期待办已归档", len(expired) >= 1)


def test_12_notification_push():
    """测试通知推送接口"""
    print("\n【12】通知推送接口")
    pushed = []

    def mock_send(payload):
        pushed.append(payload)
        return True

    push_service = NotificationPushService(send_fn=mock_send)

    payload = ReminderPushPayload(
        id="test-id",
        content="测试推送内容",
        deadline="2026-06-15T14:00:00+08:00",
        lead_minutes=15,
    )
    result = push_service.push(payload)
    check("模拟推送成功", result)
    check("回调被调用", len(pushed) == 1)
    check("推送内容匹配", pushed[0].content == "测试推送内容")


def test_13_offline_queue():
    """测试离线队列"""
    print("\n【13】离线队列")
    push_service = NotificationPushService()
    payload = ReminderPushPayload(
        id="offline-test",
        content="离线消息",
        deadline="2026-06-15T14:00:00+08:00",
        lead_minutes=30,
    )

    # 模拟推送失败后入队
    result = push_service.push(payload)
    check("推送失败（无 send_fn）", not result)
    push_service.enqueue_offline(payload)
    check("离线队列长度=1", push_service.offline_queue_size == 1)

    # 设置 send_fn 后补推
    push_service.set_send_fn(lambda p: True)
    count = push_service.flush_offline_queue()
    check("补推成功", count == 1)
    check("队列已清空", push_service.offline_queue_size == 0)


def test_14_scheduler_basic():
    """测试调度器基本功能"""
    print("\n【14】调度器基本功能")
    scheduler = ReminderScheduler(lead_times=[15, 30])
    check("初始未运行", not scheduler.is_running)
    check("注册数为 0", scheduler.registered_count == 0)

    from datetime import datetime, timezone, timedelta
    future = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

    scheduler.schedule_reminder("test-schedule-id", future)
    check("注册数增加", scheduler.registered_count > 0)

    scheduler.cancel_schedule("test-schedule-id")
    check("取消后注册数为 0", scheduler.registered_count == 0)


def test_15_scheduleReminders_unified():
    """测试统一接口 scheduleReminders"""
    print("\n【15】统一接口 scheduleReminders")
    from datetime import datetime, timezone, timedelta

    future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()

    result = scheduleReminders({
        "reminders": [
            {"content": "统一接口测试", "assignee": "测试", "deadline": future, "confidence": 0.85},
        ],
    })
    check("统一接口接受", result["accepted"] == 1, str(result))
    check("reminder_ids 非空", len(result["reminder_ids"]) > 0)


def test_16_status_report_handling():
    """测试手机端状态变更处理"""
    print("\n【16】手机端状态变更处理")
    received = []

    def on_change(report):
        received.append(report)

    push_service = NotificationPushService(on_status_change=on_change)

    # 模拟手机端上报
    result = push_service.handle_status_report({
        "type": "reminder_status",
        "payload": {"id": "test-uuid-123", "status": "completed"},
    })
    check("状态变更处理成功", result)
    check("回调被触发", len(received) == 1)
    check("ID 正确", received[0].id == "test-uuid-123")
    check("状态正确", received[0].status == "completed")

    # 测试非法状态
    result = push_service.handle_status_report({
        "type": "reminder_status",
        "payload": {"id": "test-uuid", "status": "unknown"},
    })
    check("非法状态返回 False", not result)


# ── 清理 ─────────────────────────────────────────────────────────
def cleanup():
    db = DatabaseManager.get_instance()
    conn = db.get_connection()
    conn.execute("DELETE FROM reminders")
    conn.commit()
    db.close_connection()
    print(f"\n  测试数据库已清理")


# ── 入口 ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  智能体6 — 智能提醒调度服务 验证")
    print("=" * 60)

    setup()

    test_01_validate_valid_reminder()
    test_02_validate_missing_content()
    test_03_validate_past_deadline()
    test_04_validate_bad_iso()
    test_05_schedule_from_analysis_accepted()
    test_06_schedule_from_analysis_partial()
    test_07_db_persistence()
    test_08_mark_completed()
    test_09_mark_cancelled()
    test_10_daily_summary()
    test_11_archive_overdue()
    test_12_notification_push()
    test_13_offline_queue()
    test_14_scheduler_basic()
    test_15_scheduleReminders_unified()
    test_16_status_report_handling()

    print(f"\n{'=' * 60}")
    print(f"  结果: {PASS} PASS, {FAIL} FAIL")
    print(f"{'=' * 60}")

    if FAIL == 0:
        print("  ✅ 所有测试通过！")
    else:
        print(f"  ❌ 有 {FAIL} 个测试失败，请检查。")

    cleanup()
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      