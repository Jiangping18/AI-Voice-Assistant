"""补充测试"""
import os, sys
os.environ["MEMORY_DATA_DIR"] = "/tmp/ai_test"
os.makedirs("/tmp/ai_test", exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.database import DatabaseManager, utc_now
from services.models import Reminder
from services.reminder_repo import ReminderRepository
from services.reminder.state_manager import ReminderStateManager

db = DatabaseManager.get_instance()
db.initialize_tables()
conn = db.get_connection()
conn.execute("DELETE FROM reminders")
conn.commit()

PASS, FAIL = 0, 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  OK {label}")
    else:
        FAIL += 1; print(f"  FAIL {label} {detail}")

# 过期归档 - 使用 repo 直接插入
print("【归档测试】")
repo = ReminderRepository()
rid = repo.insert(Reminder(title="过期任务", content="已过期",
                           due_time="2020-01-01T00:00:00Z", status="pending"))
check("插入过期待办", len(rid) > 0)

mgr = ReminderStateManager()
count = mgr.archive_overdue()
check("归档", count >= 1)

archived = mgr.get_archived(since_days=3650)
expired = [r for r in archived if r.status == "expired"]
check("过期待办已归档", len(expired) >= 1)

# 每日汇总
summary = mgr.generate_daily_summary()
check("汇总包含date", "date" in summary)
check("汇总包含pending", "pending" in summary)
check("汇总包含items", isinstance(summary["items"], list))
print(f"  今日汇总: pending={summary['pending']} completed_today={summary['completed_today']}")

conn.execute("DELETE FROM reminders"); conn.commit()
db.close_connection()
import shutil; shutil.rmtree("/tmp/ai_test", ignore_errors=True)

print(f"\n结果: {PASS} PASS, {FAIL} FAIL")
if FAIL == 0: print("全部通过!")
