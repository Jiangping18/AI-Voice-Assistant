"""
快速验证脚本 — 测试记忆存储模块全部功能

运行方式:
    cd app/desktop/main/services/
    python test_services.py

预期输出: 所有测试 PASS
"""

import os
import sys
import json

# ── 确保能找到服务模块 ─────────────────────────────────────────
SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVICES_DIR not in sys.path:
    sys.path.insert(0, SERVICES_DIR)

from database import DatabaseManager, utc_now
from models import Conversation, Person, Event, Reminder, Segment
from conversation_repo import ConversationRepository
from person_repo import PersonRepository
from event_repo import EventRepository
from reminder_repo import ReminderRepository
from segment_repo import SegmentRepository
from query_service import QueryService


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


def test_01_database_init():
    """测试数据库初始化和建表"""
    print("\n【01】数据库初始化")

    db = DatabaseManager.get_instance()
    db.initialize_tables()

    # 验证数据库文件存在
    check("数据库文件已创建", os.path.exists(db.db_path), db.db_path)

    # 验证 5 张表已创建
    conn = db.get_connection()
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t["name"] for t in tables]

    expected = ["conversations", "events", "persons", "reminders", "segments"]
    for tbl in expected:
        check(f"表 {tbl} 已创建", tbl in table_names)

    # 验证索引数量
    indexes = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    check(f"索引已创建 (共 {len(indexes)} 个)", len(indexes) >= 7)
    print(f"    索引列表: {[i['name'] for i in indexes]}")
    db.close_connection()


def test_02_crud_conversations():
    """测试对话 CRUD"""
    print("\n【02】对话 CRUD")
    repo = ConversationRepository()

    # Create
    conv = Conversation(
        title="Q2 产品规划会",
        start_time=utc_now(),
        participant_ids=["p1", "p2"],
        summary="讨论了 Q2 产品路线图",
    )
    cid = repo.insert(conv)
    check("Create: 返回 ID", len(cid) > 0, cid)

    # Read
    found = repo.find_by_id(cid)
    check("Read: 按 ID 查询", found is not None)
    check("   标题匹配", found.title == "Q2 产品规划会")
    check("   参与人解析", "p1" in found.participant_ids)

    # Update
    conv.title = "Q2 产品规划会（更新版）"
    updated = repo.update(conv)
    check("Update: 全量更新", updated)

    # 部分更新
    partial = repo.update_fields(cid, status="completed")
    check("Update: 部分更新 status", partial)
    after = repo.find_by_id(cid)
    check("   status 变为 completed", after.status == "completed")

    # 业务查询
    active = repo.find_active()
    completed = repo.find_completed()
    check("业务查询: find_active", len(active) >= 0)
    check("业务查询: find_completed", len(completed) >= 0)

    # Delete
    deleted = repo.delete(cid)
    check("Delete: 删除成功", deleted)
    gone = repo.find_by_id(cid)
    check("  删除后查询为 None", gone is None)


def test_03_crud_persons():
    """测试说话人 CRUD"""
    print("\n【03】说话人 CRUD")
    repo = PersonRepository()

    p = Person(name="张三", role="speaker", meta_info={"department": "技术部"})
    pid = repo.insert(p)
    check("Create person", len(pid) > 0)

    found = repo.find_by_name("张三")
    check("Read: 按姓名", found is not None and found.name == "张三")

    fuzzy = repo.search_by_name("张")
    check("搜索: 模糊匹配", len(fuzzy) >= 1)

    repo.delete(pid)
    check("Delete person", repo.find_by_id(pid) is None)


def test_04_crud_events():
    """测试事件 CRUD"""
    print("\n【04】事件 CRUD")
    repo = EventRepository()

    evt = Event(
        conversation_id="conv-001",
        type="action_item",
        content="张三负责完成前端原型设计",
        involved_person_ids=["p1", "p2"],
    )
    eid = repo.insert(evt)
    check("Create event", len(eid) > 0)

    by_conv = repo.find_by_conversation("conv-001")
    check("按对话查询", len(by_conv) >= 1)

    by_type = repo.find_by_type("action_item")
    check("按类型查询", len(by_type) >= 1)

    repo.delete(eid)
    check("Delete event", repo.find_by_id(eid) is None)


def test_05_crud_reminders():
    """测试提醒 CRUD"""
    print("\n【05】提醒 CRUD")
    repo = ReminderRepository()

    rem = Reminder(
        title="提醒张三交原型",
        content="周五前完成",
        due_time="2026-06-15T18:00:00",
        priority=4,
    )
    rid = repo.insert(rem)
    check("Create reminder", len(rid) > 0)

    pending = repo.find_pending()
    check("查询 pending 提醒", len(pending) >= 1)

    marked = repo.mark_completed(rid)
    check("标记完成", marked)
    done = repo.find_by_id(rid)
    check("  状态变为 completed", done.status == "completed")

    repo.delete(rid)
    check("Delete reminder", repo.find_by_id(rid) is None)


def test_06_crud_segments():
    """测试音频片段 CRUD"""
    print("\n【06】音频片段 CRUD")
    repo = SegmentRepository()

    seg = Segment(
        conversation_id="conv-001",
        person_id="p1",
        start_time=0.0,
        end_time=3.5,
        text="大家好，今天我们来讨论Q2的产品规划。",
    )
    sid = repo.insert(seg)
    check("Create segment", len(sid) > 0)

    by_conv = repo.find_by_conversation("conv-001")
    check("按对话查询片段", len(by_conv) >= 1)

    by_text = repo.find_by_text_like("产品规划")
    check("文本模糊搜索", len(by_text) >= 1)

    repo.delete(sid)
    check("Delete segment", repo.find_by_id(sid) is None)


def test_07_query_service():
    """测试统一查询服务"""
    print("\n【07】统一查询服务")

    # 先插入一些测试数据
    conv_repo = ConversationRepository()
    seg_repo = SegmentRepository()
    evt_repo = EventRepository()

    conv = Conversation(title="测试会议", status="active")
    cid = conv_repo.insert(conv)

    seg = Segment(conversation_id=cid, text="今天讨论数据库设计方案")
    sid = seg_repo.insert(seg)

    evt = Event(conversation_id=cid, type="decision", content="决定使用 SQLite")
    eid = evt_repo.insert(evt)

    # 统一检索
    qs = QueryService()
    result = qs.search(query="数据库设计", top_k=5)

    check("统一检索返回 dict", isinstance(result, dict))
    check("  results 是列表", isinstance(result.get("results"), list))
    check("  有搜索结果", result["total"] > 0, f"total={result['total']}")

    # 清理
    conv_repo.delete(cid)
    seg_repo.delete(sid)
    evt_repo.delete(eid)


def test_08_stub_vector_graph():
    """测试预留接口（捕获 NotImplementedError）"""
    print("\n【08】预留接口（向量/图）")

    from vector_store import VectorStore
    from graph_store import GraphStore

    vs = VectorStore()
    try:
        vs.search("test")
        check("VectorStore.search 未抛出异常", False)
    except NotImplementedError:
        check("VectorStore.search 正确抛出 NotImplementedError", True)

    gs = GraphStore()
    try:
        gs.add_person_node("p1", "张三")
        check("GraphStore.add_person_node 未抛出异常", False)
    except NotImplementedError:
        check("GraphStore.add_person_node 正确抛出 NotImplementedError", True)


def test_09_count_api():
    """测试聚合计数"""
    print("\n【09】聚合计数")
    repo = ConversationRepository()
    count = repo.count()
    check("count() 返回整数", isinstance(count, int))
    count_active = repo.count("status", "active")
    check("count(status=active) 返回整数", isinstance(count_active, int))


# ── 清理测试数据库 ──────────────────────────────────────────────
def cleanup():
    db = DatabaseManager.get_instance()
    db.close_connection()
    if os.path.exists(db.db_path):
        os.remove(db.db_path)
        print(f"\n  测试数据库已清理: {db.db_path}")


# ── 入口 ────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("  AI 录音助手 — 记忆存储模块 快速验证")
    print("=" * 60)

    test_01_database_init()
    test_02_crud_conversations()
    test_03_crud_persons()
    test_04_crud_events()
    test_05_crud_reminders()
    test_06_crud_segments()
    test_07_query_service()
    test_08_stub_vector_graph()
    test_09_count_api()

    print(f"\n{'=' * 60}")
    print(f"  结果: {PASS} PASS, {FAIL} FAIL")
    print(f"{'=' * 60}")

    if FAIL == 0:
        print("  ✅ 所有测试通过！")
    else:
        print(f"  ❌ 有 {FAIL} 个测试失败，请检查。")

    cleanup()
