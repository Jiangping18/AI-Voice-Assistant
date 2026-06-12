/**
 * 文本清洗规则定义
 *
 * 包含三个维度：
 * 1. 语气词过滤规则（filler words）
 * 2. 标点补全规则
 * 3. 数字格式化规则
 *
 * @module text-cleaning/rules
 */

// ===================== 语气词过滤 =====================

/**
 * 中文常见语气词列表
 * 这些词在 ASR 识别中经常出现但无实际语义
 *
 * 注意：部分词在特定语境下有意义（如"嗯"表示肯定），
 * 此处采用保守策略：仅过滤重复出现或独立出现的语气词
 */
export const DEFAULT_FILLERS: string[] = [
  // 犹豫/思考类
  '嗯', '呃', '啊', '哦', '呐', '嘛',
  // 重复填充
  '这个', '那个', '那个那个', '然后', '就是',
  '就是说', '也就是说', '那那个',
  // 语气填充
  '哎呀', '哎哟', '唉', '哟', '呵',
  '哈哈', '呵呵', '嘿嘿',
];

/**
 * 语气词过滤规则条目
 */
export interface FillerRule {
  /** 正则模式 */
  pattern: RegExp;
  /** 替换字符串 */
  replacement: string;
  /** 是否为单字语气词 */
  isSingleChar: boolean;
}

/**
 * 构造语气词过滤规则列表
 *
 * 策略：
 * - 单字语气词（嗯/呃/啊/哦等）：直接全局移除（ASR 中几乎无语义）
 *   同时匹配连续重复（嗯嗯 → 移除）
 * - 多字填充词（然后/就是/这个等）：使用边界匹配（前后为空白或标点），
 *   避免破坏"这个月"、"就是说"等正常词语
 */
export function buildFillerPatterns(fillers: string[] = DEFAULT_FILLERS): FillerRule[] {
  // 按长度降序排列以优先匹配长词
  const sorted = [...fillers].sort((a, b) => b.length - a.length);
  const rules: FillerRule[] = [];

  for (const word of sorted) {
    if (word.length === 1) {
      // 单字语气词：直接全局移除（不含捕获组，替换为空字符串）
      rules.push({
        pattern: new RegExp(`${escapeRegExp(word)}+`, 'g'),
        replacement: '',
        isSingleChar: true,
      });
    } else {
      // 多字填充词：保留前置边界字符（捕获组 $1），移除填充词
      rules.push({
        pattern: new RegExp(`(^|[\\s，。！？、；：])${escapeRegExp(word)}(?=[\\s，。！？、；：]|$)`, 'g'),
        replacement: '$1',
        isSingleChar: false,
      });
    }
  }

  return rules;
}

/** 正则转义 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===================== 标点补全 =====================

/**
 * 标点补全规则
 *
 * ASR 输出的文本通常没有标点或标点不全，
 * 通过规则和模式匹配进行补全。
 */
export interface PunctuationRule {
  /** 匹配模式（正则） */
  pattern: RegExp;
  /** 替换文本 */
  replacement: string;
  /** 规则描述 */
  description: string;
}

/**
 * 默认标点补全规则列表
 */
export const DEFAULT_PUNCTUATION_RULES: PunctuationRule[] = [
  // 句末补句号
  {
    pattern: /([^。！？\.\!\?])\s*$/,
    replacement: '$1。',
    description: '句末无标点补句号',
  },
  // 语气词结尾补感叹号
  {
    pattern: /(吧|吗|呢|啊|呀|哦)([^，。！？\w])?$/,
    replacement: '$1？',
    description: '疑问语气词结尾补问号',
  },
  // "吗"结尾补问号
  {
    pattern: /(吗)([^。！？])?$/,
    replacement: '吗？',
    description: '吗结尾补问号',
  },
  // 连续标点去重
  {
    pattern: /([，。！？、；：]){2,}/g,
    replacement: '$1',
    description: '连续标点去重',
  },
  // "然后"、"但是"前补逗号（句首除外）
  {
    pattern: /(?<=[一-鿿])(然后|但是|不过|然而|而且|并且|或者|因为|所以|虽然|但是|如果|那么)/g,
    replacement: '，$1',
    description: '关联词前补逗号',
  },
  // 句号后如果缺少空格或换行，保持紧凑（不额外处理）
];

// ===================== 数字格式化 =====================

/**
 * 中文数字映射表
 * 将中文数字转为阿拉伯数字
 */
export const CN_NUM_MAP: Record<string, string> = {
  '零': '0',
  '一': '1',
  '二': '2',
  '三': '3',
  '四': '4',
  '五': '5',
  '六': '6',
  '七': '7',
  '八': '8',
  '九': '9',
  '十': '10',
};

/**
 * 数字格式化规则列表
 */
export const DEFAULT_NUMBER_RULES = [
  // 百分数：百分之X → X%
  {
    pattern: /百分之([一二三四五六七八九十百千万亿\d\.]+)/g,
    replacement: (match: string, num: string) => {
      const arabic = cnNumberToArabic(num);
      return `${arabic}%`;
    },
    description: '百分之X → X%',
  },
  // 序数：第X → 第X（保留中文数字，只转换纯数字）
  {
    pattern: /第([一二三四五六七八九十]+)/g,
    replacement: (match: string, num: string) => {
      return `第${cnNumberToArabic(num)}`;
    },
    description: '中文序数转阿拉伯数字',
  },
  // 中文数字（多位）→ 阿拉伯数字
  {
    pattern: /(?<=[\s，。！？、；：]|^)([一二三四五六七八九十百千万亿]+)(?=[\s，。！？、；：]|$)/g,
    replacement: (match: string) => cnNumberToArabic(match),
    description: '独立中文数字转阿拉伯数字',
  },
  // 数量词：三十个 → 30个
  {
    pattern: /([一二三四五六七八九十百千万亿]+)([个只条匹块座间家次回遍趟番])/g,
    replacement: (match: string, num: string, unit: string) => {
      return `${cnNumberToArabic(num)}${unit}`;
    },
    description: '数量词数字格式化',
  },
] as const;

// ===================== 辅助函数 =====================

/**
 * 中文数字转阿拉伯数字
 *
 * 支持：零一二三四五六七八九十百千万亿
 *
 * @example
 * cnNumberToArabic('一百二十三')      // '123'
 * cnNumberToArabic('三千五百六十')     // '3560'
 * cnNumberToArabic('十二')            // '12'
 */
export function cnNumberToArabic(cnNum: string): string {
  const chnNumChar: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
  };
  const chnUnit: Record<string, { factor: number; isUnit: boolean }> = {
    '十': { factor: 10, isUnit: false },
    '百': { factor: 100, isUnit: false },
    '千': { factor: 1000, isUnit: false },
    '万': { factor: 10000, isUnit: true },
    '亿': { factor: 100000000, isUnit: true },
  };

  let result = 0;
  let current = 0;
  let lastUnit = 1;

  for (let i = 0; i < cnNum.length; i++) {
    const char = cnNum[i];
    const num = chnNumChar[char];
    const unit = chnUnit[char];

    if (num !== undefined) {
      current = num;
    } else if (unit) {
      if (unit.isUnit) {
        // 万/亿：累加当前值乘以单位，重置
        result = (result + current) * unit.factor;
        current = 0;
        lastUnit = unit.factor;
      } else {
        // 十/百/千
        if (current === 0) current = 1; // "十二" → 1*10 + 2
        result += current * unit.factor;
        current = 0;
        lastUnit = unit.factor;
      }
    }
  }

  result += current;

  return String(result || (chnNumChar[cnNum] !== undefined ? chnNumChar[cnNum] : 0));
}
