"""
文本预处理与脱敏模块

职责:
    1. 过滤敏感信息（手机号 / 身份证号 / 邮箱）→ 替换为占位符
    2. 文本长度限制 → 超出 8000 字截断

设计考虑:
    - 正则匹配覆盖中国大陆常见格式
    - 脱敏在前、截断在后，避免脱敏后文本超长
    - 纯正则实现，零外部依赖
"""

import re
import logging

logger = logging.getLogger(__name__)

# ── 敏感信息正则 ─────────────────────────────────────────────────

# 中国大陆手机号：1[3-9] 开头 + 9 位数字
# 中国大陆身份证号：18 位（末位可能是 X）—— 必须在手机号之前执行
# 因为身份证号包含可被手机号正则匹配的子串
ID_CARD_PATTERN = re.compile(
    r"[1-9]\d{5}(?:19|20)\d{2}"
    r"(?:0[1-9]|1[0-2])"
    r"(?:0[1-9]|[12]\d|3[01])"
    r"\d{3}[\dXx]"
)

# 中国大陆手机号：1[3-9] 开头 + 9 位数字
PHONE_PATTERN = re.compile(r"1[3-9]\d{9}")

# 电子邮箱
EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# ── 常量 ─────────────────────────────────────────────────────────

MAX_TEXT_LENGTH = 8000  # 最大文本长度（字符数）


# ── 脱敏 ─────────────────────────────────────────────────────────

def desensitize(text: str) -> str:
    """对文本中的敏感信息进行脱敏替换"""
    original_length = len(text)

    # 先替换身份证号（含可被手机号匹配的子串），再替换手机号
    text = ID_CARD_PATTERN.sub("[身份证号已脱敏]", text)
    text = PHONE_PATTERN.sub("[手机号已脱敏]", text)
    text = EMAIL_PATTERN.sub("[邮箱已脱敏]", text)

    replaced = original_length - len(text)
    if replaced > 0:
        logger.info(f"脱敏处理完成，共替换 {replaced} 字符敏感信息")
    return text


# ── 截断 ─────────────────────────────────────────────────────────

def truncate(text: str, max_length: int = MAX_TEXT_LENGTH) -> str:
    """截断文本至最大长度，超出部分添加截断提示"""
    if len(text) <= max_length:
        return text

    logger.warning(
        f"文本长度 {len(text)} 超过限制 {max_length}，已截断"
    )
    return text[:max_length] + "……（文本过长已截断）"


# ── 统一入口 ─────────────────────────────────────────────────────

def preprocess(text: str) -> str:
    """
    完整预处理流程：先脱敏 → 再截断

    参数:
        text: 原始对话文本

    返回:
        预处理后的安全文本（最长 8000 字符）
    """
    if not text:
        logger.warning("输入文本为空，跳过预处理")
        return ""

    text = desensitize(text)
    text = truncate(text)
    return text
