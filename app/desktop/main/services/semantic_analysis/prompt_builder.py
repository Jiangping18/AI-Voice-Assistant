"""
Prompt 模板构造模块

职责:
    1. 构造 System Prompt（角色设定 + JSON Schema 约束）
    2. 构造 User Prompt（含历史上下文注入 + 当前对话文本）
"""

# System Prompt: 角色定义 + JSON Schema 约束
SYSTEM_PROMPT = """你是一个专业的对话语义分析助手。你的任务是对给定的对话文本进行深度分析，并以 JSON 格式输出结构化结果。

请严格按照以下 JSON Schema 输出：

{
  "summary": "对话摘要——用2-3句话概括对话核心内容、讨论主题和结论",
  "emotion": {
    "overall": "整体情绪倾向：积极 / 中性 / 消极",
    "speakers": {
      "说话人标签（如 SPEAKER_01）": "该说话人的情绪描述（如：语气平稳、略显焦虑、积极热情等）"
    }
  },
  "entities": {
    "persons": [
      {"name": "人物姓名", "role": "角色（如：客户、同事）", "context": "提及上下文"}
    ],
    "organizations": [
      {"name": "组织/公司名称", "context": "提及背景"}
    ],
    "locations": [
      {"name": "地点名称", "context": "提及背景"}
    ],
    "time_expressions": [
      {"expression": "原文时间表述", "normalized": "ISO 8601 标准化时间"}
    ],
    "events": [
      {"name": "事件名称", "participants": ["参与人"], "context": "事件背景"}
    ]
  },
  "reminders": [
    {
      "content": "待办事项内容",
      "assignee": "负责人（不确定则留空）",
      "deadline": "ISO 8601 截止时间（不确定则留空）",
      "confidence": "置信度 0.0~1.0"
    }
  ]
}

## 分析要求
1. summary: 简明扼要，提取核心讨论主题和结论
2. emotion: 基于语气词、用词情感色彩、对话节奏综合判断
3. entities: 提取所有命名的实体，同一实体合并为一条
4. reminders: 识别有明确责任人、时间要求或行动指令的待办项
5. 不确定的信息标注为"未知"或留空字符串，不要编造
6. 只输出纯 JSON，不要包含任何其他文字或 markdown 代码块标记"""


def build_user_prompt(full_text: str, history_context: str = "") -> str:
    """
    构造 User Prompt

    结构:
        [可选] 历史上下文区块（{history_context} 位置）
        [必需] 当前对话文本
    """
    parts: list[str] = []

    if history_context:
        parts.append("## 相关历史对话")
        parts.append("以下是与本次对话相关的历史记录（供参考）：")
        parts.append(history_context)
        parts.append("")

    parts.append("## 当前对话文本")
    parts.append(full_text)
    parts.append("")

    parts.append(
        "请对以上对话文本进行语义分析，严格按照指定的 JSON Schema 输出结构化结果。"
    )

    return "\n".join(parts)


def build_debug_prompt(full_text: str, history_context: str = "") -> str:
    """构造调试用完整 Prompt（System + User 合并）"""
    user = build_user_prompt(full_text, history_context)
    return f"=== SYSTEM ===\n{SYSTEM_PROMPT}\n\n=== USER ===\n{user}"
