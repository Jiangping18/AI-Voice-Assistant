"""智能体6 — 提醒服务快速验证 (13组测试)"""
import os, sys
os.environ["MEMORY_DATA_DIR"] = "/tmp/ai_test"
os.makedirs("/tmp/ai_test", exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.database import DatabaseManager, utc_now
from services.models import Reminder
from services.reminder_repo import ReminderRepository

PASS, FAIL = 0, 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  OK {label}")
    else:
        FAIL += 1; print(f"  FAIL {label} {detail}")

db = DatabaseManager.get_instance()
db.initialize_tables()
conn = db.get_connection()
conn.execute("DELETE FROM reminders")
conn.commit()
print("环境就绪\n")

from datetime import datetime, timezone, timedelta
future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

# 1. CRUD
print("【1】CRUD")
repo = ReminderRepository()
rid = repo.insert(Reminder(title="测试", content="内容", due_time=future, priority=4))
check("创建ID", len(rid) > 0)
check("查询", repo.find_by_id(rid) is not None)
check("pending列表", len(repo.find_pending()) >= 1)
check("标记完成", repo.mark_completed(rid))
check("状态completed", repo.find_by_id(rid).status == "completed")
repo.delete(rid)

# 2. 过期查询
print("\n【2】过期查询")
rid2 = repo.insert(Reminder(title="过期", content="x", due_time="2020-01-01T00:00:00Z"))
check("过期待办", rid2 in [r.id for r in repo.find_overdue()])
repo.delete(rid2)

# 3. 状态流转
print("\n【3】状态流转")
rid3 = repo.insert(Reminder(title="流转", content="x", due_time=future, status="pending"))
repo.mark_triggered(rid3); check("pending->triggered", repo.find_by_id(rid3).status == "triggered")
repo.mark_completed(rid3); check("triggered->completed", repo.find_by_id(rid3).status == "completed")
repo.delete(rid3)

# 4. 校验逻辑
print("\n【4】校验逻辑")
from services.reminder.reminder_service import ReminderService, ReminderValidationError
svc = ReminderService()
item = {"content": "开会", "assignee": "张三", "deadline": future, "confidence": 0.95}
rem = svc._validate_and_build(item)
check("负责人前缀", rem.title.startswith("[张三]"))
check("高优先级", rem.priority == 5)
try:
    svc._validate_and_build({"content": "", "deadline": future})
    check("空内容异常", False)
except ReminderValidationError: check("空内容拦截", True)
try:
    svc._validate_and_build({"content": "x", "deadline": "2020-01-01T00:00:00Z"})
    check("过去时间异常", False)
except ReminderValidationError: check("过去时间拦截", True)

# 5. 分析结果入库
print("\n【5】分析结果入库")
f1 = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
f2 = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
res = svc.schedule_from_analysis({"reminders": [
    {"content": "周报", "assignee": "我", "deadline": f1, "confidence": 0.9},
    {"content": "邮件", "assignee": "", "deadline": f2, "confidence": 0.7},
]})
check("全部接受", res["accepted"] == 2)
res2 = svc.schedule_from_analysis({"reminders": [
    {"content": "有效", "deadline": f1},
    {"content": "", "deadline": f1},
]})
check("部分接受", res2["accepted"] == 1 and res2["rejected"] == 1)

# 6. 直接添加
print("\n【6】直接添加")
rid6 = svc.add_reminder(content="直接添加", deadline=future, assignee="测")
check("返回ID", len(rid6) > 0)
check("查询", svc.get_reminder_by_id(rid6) is not None)
repo.delete(rid6)

# 7. 推送接口
print("\n【7】推送接口")
from services.reminder.notification_push import NotificationPushService, ReminderPushPayload
pushed = []
ps = NotificationPushService(send_fn=lambda p: (pushed.append(p), True)[1])
check("推送成功", ps.push(ReminderPushPayload(id="t1", content="测试",
    deadline="2026-06-15T14:00:00+08:00", lead_minutes=15)))
check("回调触发", len(pushed) == 1)

# 8. 离线队列
print("\n【8】离线队列")
ps2 = NotificationPushService()
pl2 = ReminderPushPayload(id="o1", content="离线", deadline="2026-06-15T14:00:00+08:00", lead_minutes=30)
check("无send_fn失败", not ps2.push(pl2))
ps2.enqueue_offline(pl2); check("队列1", ps2.offline_queue_size == 1)
ps2.set_send_fn(lambda p: True)
check("补推成功", ps2.flush_offline_queue() == 1)
check("队列0", ps2.offline_queue_size == 0)

# 9. 状态变更
print("\n【9】状态变更处理")
received = []
ps3 = NotificationPushService(on_status_change=lambda r: received.append(r))
check("完成处理", ps3.handle_status_report(
    {"type":"reminder_status","payload":{"id":"u1","status":"completed"}}))
check("回调触发", len(received) == 1)
check("非法拒绝", not ps3.handle_status_report(
    {"type":"reminder_status","payload":{"id":"u1","status":"unknown"}}))

# 10. 状态管理
print("\n【10】状态管理")
from services.reminder.state_manager import ReminderStateManager
mgr = ReminderStateManager()
rid10 = repo.insert(Reminder(title="状态测试", content="x", due_time=future, status="pending"))
check("标记完成", mgr.mark_completed(rid10))
check("状态completed", repo.find_by_id(rid10).status == "completed")
rid10b = repo.insert(Reminder(title="取消测试", content="x", due_time=future, status="pending"))
check("标记取消", mgr.mark_cancelled(rid10b))
check("状态cancelled", repo.find_by_id(rid10b).status == "cancelled")
repo.delete(rid10); repo.delete(rid10b)

# 11. 归档与汇总
print("\n【11】归档与汇总")
# 直接插入过期待办（绕过 add_reminder 的未来时间校验）
rid11 = repo.insert(Reminder(title="过期任务", content="已过期",
    due_time="2020-01-01T00:00:00Z", status="pending"))
check("归档", mgr.archive_overdue() >= 1)
archived = mgr.get_archived(since_days=3650)
check("过期已标记", len([r for r in archived if r.status == "expired"]) >= 1)
summary = mgr.generate_daily_summary()
check("汇总date", "date" in summary)
check("汇总pending", "pending" in summary)
repo.delete(rid11)

# 12. 调度器
print("\n【12】调度器")
from services.reminder.scheduler import ReminderScheduler
sch = ReminderScheduler(lead_times=[15, 30])
check("初始未运行", not sch.is_running)
future24 = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
sch.schedule_reminder("test-id", future24)
check("注册成功", sch.registered_count > 0)
sch.cancel_schedule("test-id")
check("取消后0", sch.registered_count == 0)

# 13. 统一接口
print("\n【13】统一接口")
from services.reminder import scheduleReminders
uf = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
ures = scheduleReminders({"reminders": [{"content": "接口测试", "assignee": "测",
    "deadline": uf, "confidence": 0.85}]})
check("接受", ures["accepted"] == 1)
check("有ID", len(ures["reminder_ids"]) > 0)

# 清理
conn.execute("DELETE FROM reminders"); conn.commit()
db.close_connection()
import shutil; shutil.rmtree("/tmp/ai_test", ignore_errors=True)
print(f"\n结果: {PASS} PASS, {FAIL} FAIL")
if FAIL == 0: print("全部通过!")
