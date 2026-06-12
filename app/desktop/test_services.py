"""
快速验证脚本 -- 测试记忆存储模块全部功能

运行方式:
    cd app/desktop/
    MEMORY_DATA_DIR=/tmp python test_services.py
"""

import os
import sys
MAIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main")
if MAIN_DIR not in sys.path:
    sys.path.insert(0, MAIN_DIR)

from services.database import DatabaseManager, utc_now
from services.models import Conversation, Person, Event, Reminder, Segment
from services.conversation_repo import ConversationRepository
from services.person_repo import PersonRepository
from services.event_repo import EventRepository
from services.reminder_repo import ReminderRepository
from services.segment_repo import SegmentRepository
from services.query_service import QueryService

PASS = 0
FAIL = 0

def check(label: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [OK] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label}  {detail}")

def test_01_database_init():
    print("\n=== [01] 数据库初始化 ===")
    db = DatabaseManager.get_instance()
    db.initialize_tables()
    check("数据库文件已创建", os.path.exists(db.db_path))
    conn = db.get_connection()
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = [t["name"] for t in tables]
    for tbl in ["conversations", "events", "persons", "reminders", "segments"]:
        check(f"表 {tbl} 已创建", tbl in table_names)
    indexes = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    check(f"索引已创建 (共 {len(indexes)} 个)", len(indexes) >= 7)
    # conn closed by cleanup

def test_02_crud_conversations():
    print("\n=== [02] 对话 CRUD ===")
    repo = ConversationRepository()
    conv = Conversation(
        title="Q2 产品规划会",
        start_time=utc_now(),
        participant_ids=["p1", "p2"],
        summary="讨论了 Q2 产品路线图",
    )
    cid = repo.insert(conv)
    check("Create: 返回 ID", len(cid) > 0)
    found = repo.find_by_id(cid)
    check("Read: 按 ID 查询", found is not None)
    check("标题匹配", found.title == "Q2 产品规划会")
    check("参与人解析", "p1" in found.participant_ids)
    repo.update_fields(cid, status="completed")
    after = repo.find_by_id(cid)
    check("部分更新 status", after.status == "completed")
    repo.find_active()
    repo.find_completed()
    check("业务查询正常", True)
    repo.delete(cid)
    check("Delete: 删除成功", repo.find_by_id(cid) is None)

def test_03_crud_persons():
    print("\n=== [03] 说话人 CRUD ===")
    repo = PersonRepository()
    p = Person(name="张三", role="speaker", meta_info={"department": "技术部"})
    pid = repo.insert(p)
    check("Create person", len(pid) > 0)
    found = repo.find_by_name("张三")
    check("Read: 按姓名", found is not None)
    fuzzy = repo.search_by_name("张")
    check("搜索: 模糊匹配", len(fuzzy) >= 1)
    repo.delete(pid)
    check("Delete person", repo.find_by_id(pid) is None)

def test_04_crud_events():
    print("\n=== [04] 事件 CRUD ===")
    evt_repo = EventRepository()
    conv_repo = ConversationRepository()
    conv = Conversation(title="事件测试对话")
    cid = conv_repo.insert(conv)
    evt = Event(
        conversation_id=cid,
        type="action_item",
        content="张三负责完成前端原型设计",
        involved_person_ids=["p1", "p2"],
    )
    eid = evt_repo.insert(evt)
    check("Create event", len(eid) > 0)
    check("按对话查询", len(evt_repo.find_by_conversation(cid)) >= 1)
    check("按类型查询", len(evt_repo.find_by_type("action_item")) >= 1)
    evt_repo.delete(eid)
    conv_repo.delete(cid)

def test_05_crud_reminders():
    print("\n=== [05] 提醒 CRUD ===")
    repo = ReminderRepository()
    rem = Reminder(title="提醒张三交原型", content="周五前完成",
                   due_time="2026-06-15T18:00:00", priority=4)
    rid = repo.insert(rem)
    check("Create reminder", len(rid) > 0)
    check("查询 pending 提醒", len(repo.find_pending()) >= 1)
    repo.mark_completed(rid)
    done = repo.find_by_id(rid)
    check("标记完成", done.status == "completed")
    repo.delete(rid)
    check("Delete reminder", repo.find_by_id(rid) is None)

def test_06_crud_segments():
    print("\n=== [06] 音频片段 CRUD ===")
    repo = SegmentRepository()
    conv_repo = ConversationRepository()
    person_repo = PersonRepository()
    conv = Conversation(title="片段测试对话")
    cid = conv_repo.insert(conv)
    person = Person(name="发言人A")
    pid = person_repo.insert(person)
    seg = Segment(
        conversation_id=cid,
        person_id=pid,
        start_time=0.0,
        end_time=3.5,
        text="大家好，今天我们来讨论Q2的产品规划。",
    )
    sid = repo.insert(seg)
    check("Create segment", len(sid) > 0)
    check("按对话查询片段", len(repo.find_by_conversation(cid)) >= 1)
    check("文本模糊搜索", len(repo.find_by_text_like("产品规划")) >= 1)
    repo.delete(sid)
    person_repo.delete(pid)
    conv_repo.delete(cid)

def test_07_query_service():
    print("\n=== [07] 统一查询服务 ===")
    conv_repo = ConversationRepository()
    seg_repo = SegmentRepository()
    evt_repo = EventRepository()
    conv = Conversation(title="测试会议", status="active")
    cid = conv_repo.insert(conv)
    seg = Segment(conversation_id=cid, text="今天讨论数据库设计方案")
    sid = seg_repo.insert(seg)
    evt = Event(conversation_id=cid, type="decision", content="决定使用 SQLite")
    eid = evt_repo.insert(evt)
    qs = QueryService()
    result = qs.search(query="数据库设计", top_k=5)
    check("统一检索返回 dict", isinstance(result, dict))
    check("results 是列表", isinstance(result.get("results"), list))
    check("有搜索结果", result["total"] > 0)
    seg_repo.delete(sid)
    evt_repo.delete(eid)
    conv_repo.delete(cid)

def test_08_stub_vector_graph():
    print("\n=== [08] 预留接口（向量/图）===")
    from services.vector_store import VectorStore
    from services.graph_store import GraphStore
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
    print("\n=== [09] 聚合计数 ===")
    repo = ConversationRepository()
    check("count() 返回整数", isinstance(repo.count(), int))
    check("count(status=active) 返回整数", isinstance(repo.count("status", "active"), int))

def cleanup():
    db = DatabaseManager.get_instance()
    # connection stays open for subsequent tests
    if os.path.exists(db.db_path):
        os.remove(db.db_path)

if __name__ == "__main__":
    print("=" * 60)
    print("  AI 录音助手 -- 记忆存储模块 快速验证")
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
        print("  所有测试通过！")
    else:
        print(f"  有 {FAIL} 个测试失败，请检查。")
    cleanup()
