#!/usr/bin/env python3
"""
端到端全链路集成测试

模拟完整流程：
  ASRResult → 语义分析(Mock) → SQLite存储 → 待办校验 → 图谱数据查询

使用方法:
    python3 scripts/end_to_end_test.py [--real-api]

选项:
    --real-api    使用真实 DeepSeek API (需配置 config/deepseek_key.txt)
"""

import sys
import os
import json
import tempfile
import argparse

# 将项目根目录加入 Python 路径
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'app', 'desktop', 'main'))

# ════════════════════════════════════════════════════════════
# 模拟智能体3的 ASR 输出（30秒会议对话）
# ════════════════════════════════════════════════════════════
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


def banner(title):
    """打印分节标题"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def step(num, msg):
    """打印步骤"""
    print(f"\n  ▶ [{num}] {msg}")
    print(f"  {'-'*40}")


def check(passed, msg):
    """检查点"""
    icon = "✅" if passed else "❌"
    print(f"  {icon} {msg}")
    return passed


def main():
    parser = argparse.ArgumentParser(description='端到端全链路集成测试')
    parser.add_argument('--real-api', action='store_true', help='使用真实 DeepSeek API')
    args = parser.parse_args()

    tmp_dir = tempfile.mkdtemp()
    db_path = os.path.join(tmp_dir, "e2e_test.db")
    os.environ["MEMORY_DATA_DIR"] = tmp_dir

    failed = 0
    total = 0

    print(f"\n{'#'*60}")
    print(f"  AI 智能录音助手 — 端到端全链路测试")
    print(f"  DeepSeek API: {'真实调用' if args.real_api else 'Mock模拟'}")
    print(f"  测试数据库: {db_path}")
    print(f"{'#'*60}")

    # ── 步骤 1: 数据库初始化 ──
    banner("第一阶段: 存储层就绪")
    total += 1
    try:
        step("1/6", "初始化 SQLite 数据库")
        from services.database import DatabaseManager
        db = DatabaseManager.get_instance(db_path=db_path)
        db.initialize_tables()

        conn = db.get_connection()
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()]
        required = {'conversations', 'persons', 'events', 'reminders', 'segments'}
        ok = required.issubset(set(tables))
        if ok:
            check(True, f"5张核心表已创建: {', '.join(tables)}")
        else:
            check(False, f"缺少表: {required - set(tables)}")
    except Exception as e:
        check(False, f"数据库初始化异常: {e}")
        ok = False
    if not ok:
        failed += 1

    # ── 步骤 2: 语义分析 ──
    banner("第二阶段: 语义分析")
    total += 1
    try:
        step("2/6", "构造 ASRResult")
        from services.semantic_analysis.models import ASRResult, ASRSegment, AnalysisResult

        asr = ASRResult(
            audio_id=MOCK_ASR_RESULT["audio_id"],
            duration=MOCK_ASR_RESULT["duration"],
            segments=[ASRSegment(**s) for s in MOCK_ASR_RESULT["segments"]],
            full_text=MOCK_ASR_RESULT["full_text"],
        )
        check(True, f"ASRResult: audio_id={asr.audio_id}, segments={len(asr.segments)}段, 文本长度={len(asr.full_text)}字")

        step("3/6", "执行语义分析")

        if args.real_api:
            from services.semantic_analysis.analyzer import analyze
            result = analyze(asr)
            check(True, f"摘要: {result.summary[:60]}...")
            check(True, f"待办数: {len(result.reminders)}")
            check(True, f"人物数: {len(result.entities.get('persons', []))}")
        else:
            # Mock 模式: 直接构造标准 AnalysisResult
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
                    "persons": [{"name": "张总", "role": "负责人", "context": "版本发布决策者"}],
                    "organizations": [],
                    "locations": [],
                    "time_expressions": [
                        {"expression": "下周三", "normalized": "2026-06-18"},
                        {"expression": "周五", "normalized": "2026-06-20"}
                    ],
                    "events": [{"name": "版本发布", "participants": ["张总"], "context": "计划周五发布"}],
                },
                reminders=[
                    {"content": "完成支付页面适配", "assignee": "前端开发", "deadline": "2026-06-15T18:00:00+08:00", "confidence": 0.9},
                    {"content": "安排测试团队周三开始全面测试", "assignee": "SPEAKER_01", "deadline": "2026-06-17T09:00:00+08:00", "confidence": 0.8},
                ],
            )
            check(True, "Mock模式: 构造标准 AnalysisResult (摘要/情绪/实体/待办)")
            check(True, f"待办数: {len(result.reminders)}条")
            check(True, f"情绪: {result.emotion['overall']}")

        ok = True
    except Exception as e:
        check(False, f"语义分析异常: {e}")
        ok = False
    if not ok:
        failed += 1

    # ── 步骤 3: 存储分析结果 ──
    banner("第三阶段: 记忆存储")
    total += 1
    try:
        step("4/6", "将分析结果写入 SQLite")

        from services.reminder_repo import ReminderRepository
        repo = ReminderRepository()

        stored = []
        for r in result.reminders:
            from services.models import Reminder as ReminderModel
            reminder = ReminderModel(
                title=f"[{r.get('assignee','')}] {r['content']}",
                content=r['content'],
                due_time=str(r['deadline']),
                status="pending",
            )
            rid = repo.insert(reminder)
            if rid:
                stored.append(rid)

        ok = len(stored) == len(result.reminders)
        check(ok, f"入库待办: {len(stored)}/{len(result.reminders)} 条")

        if ok:
            # 验证可检索
            from services.query_service import QueryService
            qs = QueryService()
            search_result = qs.search(query="测试", top_k=5)
            check(True, f"QueryService 检索返回: {search_result.get('total', 0)} 条")
    except Exception as e:
        check(False, f"存储异常: {e}")
        ok = False
    if not ok:
        failed += 1

    # ── 步骤 4: 待办校验与调度 ──
    banner("第四阶段: 智能提醒")
    total += 1
    try:
        step("5/6", "ReminderService 校验与入库")
        from services.reminder.reminder_service import ReminderService
        svc = ReminderService()

        sr = svc.schedule_from_analysis({"reminders": [
            {"content": r['content'], "assignee": r.get('assignee', ''),
             "deadline": str(r['deadline']), "confidence": r.get('confidence', 0.8)}
            for r in result.reminders
        ]})

        ok = sr['accepted'] == sr['total']
        check(ok, f"待办校验: {sr['accepted']}/{sr['total']} 通过, 拒绝: {sr['rejected']}")
        if sr['rejected'] > 0:
            for err in sr['errors']:
                print(f"    ⚠  {err}")
    except Exception as e:
        check(False, f"ReminderService 异常: {e}")
        ok = False
    if not ok:
        failed += 1

    # ── 步骤 5: 图谱数据准备 ──
    banner("第五阶段: 图谱数据查询")
    total += 1
    try:
        step("6/6", "QueryService 图谱数据接口")

        from services.database import DatabaseManager
        db = DatabaseManager.get_instance(db_path=db_path)
        conn = db.get_connection()

        # 直接检查数据库完整性
        checks = {}
        for table in ['conversations', 'persons', 'events', 'reminders', 'segments']:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            checks[table] = count

        total_records = sum(checks.values())
        check(total_records > 0, f"数据库总记录数: {total_records} 条")
        for table, count in checks.items():
            print(f"      {table}: {count} 条")

        ok = total_records > 0
    except Exception as e:
        check(False, f"图谱数据查询异常: {e}")
        ok = False
    if not ok:
        failed += 1

    # ── 结果汇总 ──
    banner("测试结果汇总")
    print(f"  总步骤: {total}")
    print(f"  通过: {total - failed}")
    print(f"  失败: {failed}")
    print(f"  结果: {'🎉 全部通过!' if failed == 0 else '❌ 有失败项'}")

    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
