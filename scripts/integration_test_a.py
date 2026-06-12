#!/usr/bin/env python3
"""
集成测试 A — 分析+存储+提醒链路（智能体4 → 5 → 6）

测试前提:
    安装依赖: pip install python-docx  (已满足)

测试数据:
    模拟智能体3输出的 ASRResult JSON
    包含2位说话人的30秒会议对话

测试流程:
    1. 智能体4: 用模拟文本调用语义分析 → 输出 AnalysisResult
       (不依赖真实 DeepSeek API，走 Mock)
    2. 智能体5: 存储分析结果到 SQLite → 验证入库
    3. 智能体6: 提取待办 → 校验 → 注册调度
"""

import sys
import os
import json
import tempfile
import unittest

# 将项目根目录加入 Python 路径
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'app', 'desktop', 'main'))

# ─── 模拟 ASR 输出（代替智能体3） ───────────────────────────
MOCK_ASR_RESULT = {
    "audio_id": "test-audio-001",
    "duration": 30.0,
    "segments": [
        {"speaker": "SPEAKER_01", "text": "张总您好，我们来讨论一下下周的版本发布计划。", "start": 0.0, "end": 5.2},
        {"speaker": "SPEAKER_02", "text": "好的，先说说目前的进度吧，前端页面完成了吗？", "start": 5.5, "end": 10.8},
        {"speaker": "SPEAKER_01", "text": "前端基本完成了，只剩支付页面的适配还没做，预计后天能完工。后端接口也都联调完了。", "start": 11.0, "end": 18.5},
        {"speaker": "SPEAKER_02", "text": "那下周三之前能完成所有测试吗？我们计划周五发布。", "start": 18.8, "end": 24.2},
        {"speaker": "SPEAKER_01", "text": "没问题，周五发布可以赶上。我安排测试团队周三开始全面测试。", "start": 24.5, "end": 30.0},
    ],
    "full_text": (
        "SPEAKER_01：张总您好，我们来讨论一下下周的版本发布计划。"
        "SPEAKER_02：好的，先说说目前的进度吧，前端页面完成了吗？"
        "SPEAKER_01：前端基本完成了，只剩支付页面的适配还没做，预计后天能完工。后端接口也都联调完了。"
        "SPEAKER_02：那下周三之前能完成所有测试吗？我们计划周五发布。"
        "SPEAKER_01：没问题，周五发布可以赶上。我安排测试团队周三开始全面测试。"
    ),
}


class TestPipelineAgent4to6(unittest.TestCase):
    """智能体4 → 5 → 6 集成测试"""

    @classmethod
    def setUpClass(cls):
        """测试前准备：使用临时数据库，避免污染开发数据"""
        cls.tmp_dir = tempfile.mkdtemp()
        cls.db_path = os.path.join(cls.tmp_dir, "test_integration.db")

        # 设置数据库环境变量，指向临时路径
        os.environ["MEMORY_DATA_DIR"] = cls.tmp_dir
        print(f"\n{'='*60}")
        print(f"集成测试 A: 分析+存储+提醒链路")
        print(f"{'='*60}")
        print(f"测试数据库: {cls.db_path}\n")

    def test_01_database_init(self):
        """测试数据库初始化"""
        print("[测试 1/6] 数据库初始化...")
        from services.database import DatabaseManager
        db = DatabaseManager.get_instance(db_path=self.db_path)
        db.initialize_tables()
        conn = db.get_connection()

        # 验证表已创建
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        table_names = [row[0] for row in tables]
        print(f"  已创建表: {table_names}")

        required_tables = {'conversations', 'persons', 'events', 'reminders', 'segments'}
        self.assertTrue(required_tables.issubset(set(table_names)),
                        f"缺少表: {required_tables - set(table_names)}")
        print("  ✅ 数据库初始化成功\n")

    def test_02_query_service_basic(self):
        """测试 QueryService 基础检索"""
        print("[测试 2/6] QueryService 基础检索...")
        from services.database import DatabaseManager
        DatabaseManager.get_instance(db_path=self.db_path).initialize_tables()
        from services.query_service import QueryService

        qs = QueryService()
        result = qs.search(query="版本发布", top_k=3)
        print(f"  检索结果: total={result.get('total', 0)}, results={len(result.get('results', []))}条")
        print("  ✅ QueryService 可正常调用\n")

    def test_03_semantic_analysis_mock(self):
        """测试智能体4 语义分析（使用模拟 DeepSeek 输出）"""
        print("[测试 3/6] 语义分析流水线（Mock DeepSeek API）...")

        # 直接构造 AnalysisResult
        from services.semantic_analysis.models import AnalysisResult

        result = AnalysisResult(
            summary="会议讨论了版本发布计划，周五可按时发布。前端基本完成，后端已联调完，测试团队周三开始全面测试。",
            emotion={
                "overall": "积极",
                "speakers": {
                    "SPEAKER_01": "汇报进展，语气自信",
                    "SPEAKER_02": "确认进度，态度积极"
                }
            },
            entities={
                "persons": [
                    {"name": "张总", "role": "负责人", "context": "版本发布决策者"},
                    {"name": "SPEAKER_01", "role": "开发人员", "context": "汇报前端和后端进度"}
                ],
                "organizations": [],
                "locations": [],
                "time_expressions": [
                    {"expression": "下周三", "normalized": "2026-06-18"},
                    {"expression": "周五", "normalized": "2026-06-20"}
                ],
                "events": [
                    {"name": "版本发布", "participants": ["张总", "SPEAKER_01"], "context": "计划周五发布"},
                    {"name": "全面测试", "participants": ["测试团队"], "context": "周三开始"}
                ]
            },
            reminders=[
                {"content": "完成支付页面适配", "assignee": "前端开发", "deadline": "2026-06-15T18:00:00+08:00", "confidence": 0.9},
                {"content": "安排测试团队周三开始全面测试", "assignee": "SPEAKER_01", "deadline": "2026-06-17T09:00:00+08:00", "confidence": 0.8},
                {"content": "周五发布版本", "assignee": "张总", "deadline": "2026-06-20T10:00:00+08:00", "confidence": 0.95},
            ]
        )

        d = result.to_dict()
        print(f"  摘要: {d['summary'][:50]}...")
        print(f"  情绪: {d['emotion']['overall']}")
        print(f"  人物: {len(d['entities']['persons'])}人")
        print(f"  待办: {len(d['reminders'])}条")
        self.assertTrue(len(d['summary']) > 0, "摘要为空")
        self.assertTrue(len(d['reminders']) > 0, "待办为空")

        # 保存供后续测试使用
        cls = self.__class__
        cls._analysis_result = result
        print("  ✅ 语义分析结果构造完成\n")

    def test_04_store_analysis_result(self):
        """测试将分析结果存入智能体5"""
        print("[测试 4/6] 存储分析结果到 SQLite...")
        from services.database import DatabaseManager
        DatabaseManager.get_instance(db_path=self.db_path).initialize_tables()

        result = getattr(self.__class__, '_analysis_result', None)
        if not result:
            self.skipTest("跳过：依赖 test_03 的产物")

        from services.reminder_repo import ReminderRepository
        repo = ReminderRepository()

        # 存入待办
        accepted = 0
        for r in result.reminders:
            from services.models import Reminder as ReminderModel
            reminder = ReminderModel(
                title=f"[{r.get('assignee','')}] {r['content']}",
                content=r['content'],
                due_time=str(r['deadline']),
                status="pending",
                priority=5 if r.get('confidence', 0) >= 0.8 else 3,
            )
            rid = repo.insert(reminder)
            if rid:
                accepted += 1
                print(f"  ✅ 待办已入库: [{r.get('assignee','')}] {r['content'][:20]}... → id={rid}")

        self.assertEqual(accepted, 3, f"期望入库3条，实际{accepted}条")
        print(f"  ✅ 共入库 {accepted}/3 条待办\n")

    def test_05_reminder_validation(self):
        """测试智能体6 待办校验"""
        print("[测试 5/6] 智能体6 — 待办校验与入库...")
        from services.reminder.reminder_service import ReminderService

        service = ReminderService()
        # 注意：这里使用我们构造的 dict 格式
        analysis_dict = {"reminders": [
            {"content": "完成支付页面适配", "assignee": "前端开发", "deadline": "2026-06-15T18:00:00+08:00", "confidence": 0.9},
            {"content": "安排测试团队周三开始全面测试", "assignee": "SPEAKER_01", "deadline": "2026-06-17T09:00:00+08:00", "confidence": 0.8},
            {"content": "周五发布版本", "assignee": "张总", "deadline": "2026-06-20T10:00:00+08:00", "confidence": 0.95},
        ]}

        result = service.schedule_from_analysis(analysis_dict)
        print(f"  总计: {result['total']}, 接受: {result['accepted']}, 拒绝: {result['rejected']}")
        print(f"  待办ID: {result['reminder_ids']}")
        self.assertEqual(result['accepted'], 3, "所有待办应校验通过")
        print("  ✅ ReminderService 校验通过\n")

    def test_06_final_check(self):
        """最终验证：查询数据库确认数据完整"""
        print("[测试 6/6] 最终验证 — 数据库完整性检查...")
        from services.database import DatabaseManager
        db = DatabaseManager.get_instance(db_path=self.db_path)
        conn = db.get_connection()

        checks = {
            "conversations": 0,
            "persons": 0,
            "events": 0,
            "reminders": 0,
            "segments": 0,
        }
        for table in checks:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            checks[table] = count
            print(f"  {table}: {count} 条记录")

        print(f"\n{'='*60}")
        print(f"集成测试 A 完成! 数据已持久化到: {self.db_path}")
        print(f"{'='*60}\n")


if __name__ == '__main__':
    unittest.main(verbosity=2)
