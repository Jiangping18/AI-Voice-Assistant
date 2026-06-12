"""
关键词提取模块

职责:
    从输入文本中提取代表性关键词，用于历史记忆检索（QueryService）
    提取出的关键词作为 query 参数传递给智能体5的检索接口

实现说明:
    - 使用分词 + 停用词过滤 + 词频统计的轻量方案
    - 纯 Python 标准库实现，不依赖 jieba 等外部包
    - 对中文和英文均有效
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── 基本停用词表（覆盖中文高频虚词、语气词） ────────────────────

_STOPWORDS: set = {
    "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们",
    "它们", "自己", "别人", "大家", "这", "那", "这个", "那个",
    "这些", "那些", "什么", "怎么", "哪", "为什么",
    "就", "也", "还", "又", "再", "才", "都", "只", "很", "太",
    "非常", "比较", "真的", "其实", "当然", "然后", "所以",
    "但是", "可是", "不过", "因为", "所以", "如果", "虽然",
    "而且", "或者", "还是", "就是", "不是", "只是", "但是",
    "吧", "啊", "嗯", "哦", "呢", "呀", "吗", "哈", "啦",
    "喂", "哎", "噢", "喔", "嘛", "呗", "呵", "嗨",
    "现在", "之前", "之后", "以前", "以后", "上面", "下面",
    "里面", "外面", "这里", "那里", "这边", "那边",
    "可以", "应该", "能够", "已经", "没有", "不是", "可能",
    "需要", "知道", "觉得", "看到", "听到", "想到", "认为",
    "进行", "通过", "使用", "利用", "采用", "表示", "说明",
    "一个", "这个", "那个", "时候", "情况", "问题", "东西",
    "方式", "方法", "原因", "结果", "部分", "方面", "内容",
    "信息", "事情",
    # 英语停用词
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can",
    "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after",
    "and", "but", "or", "nor", "not", "so", "yet", "both",
    "either", "neither", "each", "every", "all", "any", "few",
    "more", "most", "other", "some", "such", "no", "only",
    "own", "same", "than", "too", "very", "just", "about",
    "up", "out", "if", "then", "else", "when", "where", "why",
    "how", "which", "who", "whom", "this", "that", "these",
    "those", "it", "its", "we", "you", "they", "them",
}

_MIN_WORD_LENGTH = 2
_DEFAULT_MAX_KEYWORDS = 10
_RETRIEVAL_KEYWORDS = 5


def extract_keywords(text: str, max_keywords: int = _DEFAULT_MAX_KEYWORDS) -> list[str]:
    """
    从文本中提取关键词

    算法:
        1. 按标点和空白切分为 tokens
        2. 过滤停用词和过短词（单字词丢弃）
        3. 按词频降序排列
        4. 返回 Top N

    参数:
        text:        输入文本
        max_keywords: 最大返回关键词数量

    返回:
        关键词列表，按出现频次降序排列
        空文本返回空列表
    """
    if not text or not text.strip():
        logger.debug("输入文本为空，跳过关键词提取")
        return []

    tokens = re.findall(r"[\w一-\u9fff]+", text.lower())

    words = [
        t for t in tokens
        if len(t) >= _MIN_WORD_LENGTH and t not in _STOPWORDS
    ]

    if not words:
        logger.debug("文本过滤后无有效词汇，返回空列表")
        return []

    freq: dict[str, int] = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1

    sorted_words = sorted(freq.items(), key=lambda x: (-x[1], x[0]))
    keywords = [w for w, _ in sorted_words[:max_keywords]]

    logger.debug(f"提取到 {len(keywords)} 个关键词: {keywords}")
    return keywords


def build_search_query(text: str) -> str:
    """
    从文本构建检索查询字符串

    当关键词较多时直接用关键词拼接作为 query，
    当无关键词时 fallback 使用文本前 100 字符。

    参数:
        text: 输入文本

    返回:
        用于 QueryService.search(query=...) 的查询字符串
    """
    keywords = extract_keywords(text, max_keywords=_RETRIEVAL_KEYWORDS)
    if keywords:
        query = " ".join(keywords)
    elif text.strip():
        query = text.strip()[:100]
    else:
        query = "对话"  # 空文本默认查询词
    logger.info(f"搜索查询: \"{query}\"")
    return query
