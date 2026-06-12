"""
语义分析模块单元测试

测试范围:
    1. preprocessor: 脱敏正则、截断逻辑
    2. key_extractor: 关键词提取、检索查询构建
    3. history_retriever: 历史格式化（不依赖 QueryService 实际连接）
    4. prompt_builder: Prompt 模板填充
    5. models: 数据模型序列化、降级回退
    6. deepseek_client: API Key 加载（mock）、重试逻辑（mock）

运行方式:
    cd app/desktop/main/services/
    python -m pytest semantic_analysis/test_semantic_analysis.py -v
    或直接:
    python semantic_analysis/test_semantic_analysis.py
"""

import json
import logging
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

_SERVICES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _SERVICES_DIR not in sys.path:
    sys.path.insert(0, _SERVICES_DIR)


class TestPreprocessor(unittest.TestCase):
    """文本预处理与脱敏测试"""

    def setUp(self):
        from semantic_analysis.preprocessor import desensitize, truncate, preprocess, MAX_TEXT_LENGTH
        self.desensitize = desensitize
        self.truncate = truncate
        self.preprocess = preprocess
        self.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH

    def test_desensitize_phone(self):
        text = "请联系我13800138000，谢谢。"
        result = self.desensitize(text)
        self.assertNotIn("13800138000", result)
        self.assertIn("[手机号已脱敏]", result)

    def test_desensitize_multiple_phones(self):
        text = "我的电话是13912345678，他的是15898765432。"
        result = self.desensitize(text)
        self.assertEqual(result.count("[手机号已脱敏]"), 2)

    def test_desensitize_id_card(self):
        text = "身份证号110101199001011234。"
        result = self.desensitize(text)
        self.assertNotIn("110101199001011234", result)
        self.assertIn("[身份证号已脱敏]", result)

    def test_desensitize_id_card_x(self):
        text = "证件号11010119900101123X。"
        result = self.desensitize(text)
        self.assertIn("[身份证号已脱敏]", result)

    def test_desensitize_email(self):
        text = "我的邮箱是test@example.com。"
        result = self.desensitize(text)
        self.assertNotIn("test@example.com", result)
        self.assertIn("[邮箱已脱敏]", result)

    def test_desensitize_mixed(self):
        text = (
            "用户: 张三，电话: 13900001111，身份证: 110101199001011234，"
            "邮箱: zhangsan@test.com。"
        )
        result = self.desensitize(text)
        self.assertIn("[手机号已脱敏]", result)
        self.assertIn("[身份证号已脱敏]", result)
        self.assertIn("[邮箱已脱敏]", result)

    def test_desensitize_clean(self):
        text = "今天天气真好，我们去公园散步吧。"
        result = self.desensitize(text)
        self.assertEqual(result, text)

    def test_desensitize_empty(self):
        self.assertEqual(self.desensitize(""), "")

    def test_truncate_within_limit(self):
        text = "你好" * 100
        result = self.truncate(text, max_length=500)
        self.assertEqual(result, text)

    def test_truncate_exceed_limit(self):
        text = "你好" * 5000
        result = self.truncate(text, max_length=100)
        self.assertLessEqual(len(result), 100 + 20)
        self.assertIn("已截断", result)

    def test_preprocess_full(self):
        text = "我手机号是13812345678，今天下午3点开会。" + "a" * 10000
        result = self.preprocess(text)
        self.assertIn("[手机号已脱敏]", result)
        self.assertIn("已截断", result)
        self.assertLess(len(result), 8100)

    def test_preprocess_empty(self):
        self.assertEqual(self.preprocess(""), "")


class TestKeyExtractor(unittest.TestCase):
    """关键词提取测试"""

    def setUp(self):
        from semantic_analysis.key_extractor import extract_keywords, build_search_query
        self.extract_keywords = extract_keywords
        self.build_search_query = build_search_query

    def test_extract_basic(self):
        text = "今天开会讨论了项目进度和预算分配问题"
        keywords = self.extract_keywords(text, max_keywords=5)
        self.assertGreater(len(keywords), 0)
        for kw in keywords:
            self.assertNotEqual(kw, "了")
            self.assertNotEqual(kw, "和")

    def test_extract_empty(self):
        self.assertEqual(self.extract_keywords(""), [])
        self.assertEqual(self.extract_keywords("   "), [])

    def test_extract_stopwords_only(self):
        text = "了 的 和 就 吧"
        self.assertEqual(self.extract_keywords(text), [])

    def test_build_search_query_with_keywords(self):
        text = "服务器部署方案和数据库迁移计划讨论"
        query = self.build_search_query(text)
        self.assertIsInstance(query, str)
        self.assertGreater(len(query), 0)

    def test_build_search_query_empty(self):
        self.assertGreater(len(self.build_search_query("")), 0)


class TestHistoryRetriever(unittest.TestCase):
    """历史记忆检索测试（仅测试格式化逻辑，不依赖DB）"""

    def setUp(self):
        from semantic_analysis.history_retriever import format_history_context
        self.format = format_history_context

    def test_format_empty(self):
        result = self.format([])
        self.assertIn("暂无相关历史对话记录", result)

    def test_format_single(self):
        history = [
            {"text": "讨论了预算方案", "speaker": "张三", "timestamp": "2024-01-15", "score": 0.9},
        ]
        result = self.format(history, top_n=1)
        self.assertIn("张三", result)
        self.assertIn("讨论了预算方案", result)
        self.assertIn("2024-01-15", result)

    def test_format_multiple_sorted(self):
        history = [
            {"text": "次要内容", "speaker": "A", "timestamp": "", "score": 0.3},
            {"text": "重要内容", "speaker": "B", "timestamp": "", "score": 0.9},
        ]
        result = self.format(history, top_n=2)
        pos_important = result.index("重要内容")
        pos_minor = result.index("次要内容")
        self.assertLess(pos_important, pos_minor)


class TestPromptBuilder(unittest.TestCase):
    """Prompt 模板构造测试"""

    def setUp(self):
        from semantic_analysis.prompt_builder import SYSTEM_PROMPT, build_user_prompt, build_debug_prompt
        self.SYSTEM_PROMPT = SYSTEM_PROMPT
        self.build_user_prompt = build_user_prompt
        self.build_debug_prompt = build_debug_prompt

    def test_system_prompt_contains_schema(self):
        self.assertIn("summary", self.SYSTEM_PROMPT)
        self.assertIn("emotion", self.SYSTEM_PROMPT)
        self.assertIn("entities", self.SYSTEM_PROMPT)
        self.assertIn("reminders", self.SYSTEM_PROMPT)

    def test_user_prompt_contains_text(self):
        text = "今天讨论项目进度"
        prompt = self.build_user_prompt(text)
        self.assertIn(text, prompt)

    def test_user_prompt_with_history(self):
        text = "当前对话"
        history = "历史记录1\n历史记录2"
        prompt = self.build_user_prompt(text, history)
        pos_history = prompt.index("历史记录1")
        pos_current = prompt.index("当前对话")
        self.assertLess(pos_history, pos_current)

    def test_user_prompt_without_history(self):
        text = "当前对话"
        prompt = self.build_user_prompt(text)
        self.assertIn("当前对话", prompt)
        self.assertNotIn("相关历史对话", prompt)

    def test_debug_prompt_contains_both(self):
        prompt = self.build_debug_prompt("测试文本")
        self.assertIn("=== SYSTEM ===", prompt)
        self.assertIn("=== USER ===", prompt)


class TestModels(unittest.TestCase):
    """数据模型测试"""

    def setUp(self):
        from semantic_analysis.models import ASRResult, ASRSegment, AnalysisResult
        self.ASRResult = ASRResult
        self.ASRSegment = ASRSegment
        self.AnalysisResult = AnalysisResult

    def test_asr_result_defaults(self):
        r = self.ASRResult()
        self.assertEqual(r.audio_id, "")
        self.assertEqual(r.full_text, "")
        self.assertEqual(r.segments, [])

    def test_asr_result_with_data(self):
        seg = self.ASRSegment(speaker="SPEAKER_01", text="你好", start=0.0, end=2.0)
        r = self.ASRResult(audio_id="test001", duration=30.0, segments=[seg], full_text="你好")
        self.assertEqual(r.audio_id, "test001")
        self.assertEqual(len(r.segments), 1)

    def test_asr_result_to_dict(self):
        r = self.ASRResult(audio_id="t1", full_text="测试")
        d = r.to_dict()
        self.assertEqual(d["audio_id"], "t1")

    def test_analysis_result_defaults(self):
        r = self.AnalysisResult()
        self.assertEqual(r.summary, "")
        self.assertEqual(r.emotion["overall"], "中性")
        self.assertEqual(r.reminders, [])

    def test_analysis_result_to_dict_excludes_raw(self):
        r = self.AnalysisResult(summary="测试摘要", raw_response="debug info")
        d = r.to_dict()
        self.assertNotIn("raw_response", d)

    def test_analysis_result_fallback(self):
        r = self.AnalysisResult.fallback("服务不可用")
        self.assertEqual(r.summary, "服务不可用")
        self.assertEqual(r.emotion["overall"], "中性")

    def test_asr_segment_to_dict(self):
        s = self.ASRSegment(speaker="SPEAKER_02", text="测试", start=1.0, end=2.5)
        d = s.to_dict()
        self.assertEqual(d["speaker"], "SPEAKER_02")


class TestDeepSeekClient(unittest.TestCase):
    """DeepSeek API 客户端测试（mock）"""

    def setUp(self):
        from semantic_analysis.deepseek_client import call_with_retry, _load_api_key, _fallback_raw
        self.call_with_retry = call_with_retry
        self._load_api_key = _load_api_key
        self._fallback_raw = _fallback_raw

    @patch("semantic_analysis.deepseek_client._call_api")
    def test_call_with_retry_success(self, mock_call_api):
        mock_call_api.return_value = json.dumps({
            "choices": [{
                "message": {
                    "content": json.dumps({
                        "summary": "测试摘要",
                        "emotion": {"overall": "积极", "speakers": {"A": "高兴"}},
                        "entities": {"persons": [], "organizations": [], "locations": [],
                                      "time_expressions": [], "events": []},
                        "reminders": [],
                    })
                }
            }]
        })
        result = self.call_with_retry("sys", "user")
        self.assertEqual(result["summary"], "测试摘要")

    @patch("semantic_analysis.deepseek_client._call_api")
    def test_retry_on_json_error(self, mock_call_api):
        """JSON 解析失败应重试"""
        mock_call_api.side_effect = [
            'invalid json',
            '{"choices": [{"message": {"content": "null"}}]}',
            json.dumps({
                "choices": [{
                    "message": {
                        "content": json.dumps({
                            "summary": "重试成功",
                            "emotion": {"overall": "中性", "speakers": {}},
                            "entities": {"persons": [], "organizations": [], "locations": [],
                                          "time_expressions": [], "events": []},
                            "reminders": [],
                        })
                    }
                }]
            }),
        ]
        # 确保 API key 缓存已设置
        import semantic_analysis.deepseek_client as dc
        dc._API_KEY = "sk-test-fake-key-for-testing"
        result = self.call_with_retry("sys", "user")
        self.assertEqual(result["summary"], "重试成功")
        self.assertEqual(mock_call_api.call_count, 3)

    @patch("semantic_analysis.deepseek_client._call_api")
    def test_all_retries_fail(self, mock_call_api):
        mock_call_api.side_effect = ConnectionError("网络不可达")
        result = self.call_with_retry("sys", "user")
        self.assertIn("summary", result)
        self.assertEqual(mock_call_api.call_count, 3)

    def test_fallback_raw_contains_required_fields(self):
        fb = self._fallback_raw()
        self.assertIn("summary", fb)
        self.assertIn("emotion", fb)
        self.assertIn("entities", fb)
        self.assertIn("reminders", fb)

    @patch("semantic_analysis.deepseek_client._CONFIG_FILE_CANDIDATES",
           ["/nonexistent/path/to/key.txt"])
    def test_load_api_key_file_not_found(self):
        # 清除 API Key 缓存以确保重新读取配置
        import semantic_analysis.deepseek_client as dc
        dc._API_KEY = None
        with self.assertRaises(FileNotFoundError) as ctx:
            self._load_api_key()
        self.assertIn("deepseek_key.txt", str(ctx.exception))


class TestAnalyzer(unittest.TestCase):
    """主编排器测试（mock API 调用）"""

    def setUp(self):
        from semantic_analysis.analyzer import analyze
        self.analyze = analyze

    @patch("semantic_analysis.analyzer.call_with_retry")
    def test_analyze_normal(self, mock_api):
        from semantic_analysis.models import ASRResult, ASRSegment

        mock_api.return_value = {
            "summary": "讨论了项目进度",
            "emotion": {"overall": "积极", "speakers": {"A": "正常"}},
            "entities": {
                "persons": [{"name": "张三", "role": "项目经理", "context": "负责跟进"}],
                "organizations": [],
                "locations": [],
                "time_expressions": [],
                "events": [],
            },
            "reminders": [{"content": "完成报告", "assignee": "张三", "deadline": "", "confidence": 0.8}],
        }

        seg = ASRSegment(speaker="A", text="项目进度如何", start=0.0, end=2.0)
        asr = ASRResult(audio_id="test001", duration=10.0, segments=[seg], full_text="项目进度如何今天开会讨论后续计划")
        result = self.analyze(asr)

        self.assertEqual(result.summary, "讨论了项目进度")
        self.assertEqual(result.emotion["overall"], "积极")
        self.assertEqual(len(result.entities["persons"]), 1)
        self.assertEqual(len(result.reminders), 1)

    @patch("semantic_analysis.analyzer.call_with_retry")
    def test_analyze_empty_text(self, mock_api):
        from semantic_analysis.models import ASRResult
        asr = ASRResult(audio_id="test_empty", full_text="")
        result = self.analyze(asr)
        self.assertIn("为空", result.summary)
        mock_api.assert_not_called()

    @patch("semantic_analysis.analyzer.call_with_retry")
    def test_analyze_api_failure(self, mock_api):
        from semantic_analysis.models import ASRResult
        mock_api.return_value = {
            "summary": "语义分析服务暂时无法获取结果",
            "emotion": {"overall": "中性", "speakers": {}},
            "entities": {"persons": [], "organizations": [], "locations": [],
                          "time_expressions": [], "events": []},
            "reminders": [],
        }
        asr = ASRResult(audio_id="test_fail", full_text="今天开会讨论内容")
        result = self.analyze(asr)
        self.assertIsNotNone(result.summary)

    def test_analyze_none_input(self):
        result = self.analyze(None)
        self.assertIn("为空", result.summary)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    unittest.main(verbosity=2)
