/**
 * 文本清洗模块 - 入口
 *
 * 对 ASR 识别结果进行后处理，包括：
 * 1. 语气词过滤（移除"嗯"、"呃"、重复填充等）
 * 2. 标点补全（补句号、问号、逗号）
 * 3. 数字格式化（中文数字 → 阿拉伯数字）
 *
 * @module text-cleaning
 */

import type { TextCleaningConfig } from './types';
import type { CleaningResult } from './types';
import {
  DEFAULT_FILLERS,
  buildFillerPatterns,
  DEFAULT_PUNCTUATION_RULES,
  DEFAULT_NUMBER_RULES,
} from './rules';
import type { PunctuationRule, FillerRule } from './rules';

export type { TextCleaningConfig, CleaningResult };

/**
 * 默认文本清洗配置
 */
export const DEFAULT_CLEANING_CONFIG: TextCleaningConfig = {
  enablePunctuation: true,
  enableFillerFilter: true,
  enableNumberFormat: true,
};

/**
 * 文本清洗器
 *
 * @example
 * ```ts
 * const cleaner = new TextCleaner();
 * const result = cleaner.clean("嗯嗯 今天天气 真不错 呵呵 三十个人");
 * // result.text === "今天天气真不错。30个人"
 * ```
 */
export class TextCleaner {
  private config: TextCleaningConfig;
  private fillerRules: FillerRule[];
  private punctuationRules: PunctuationRule[];

  constructor(config: TextCleaningConfig = DEFAULT_CLEANING_CONFIG) {
    this.config = config;
    this.fillerRules = buildFillerPatterns(config.customFillers || DEFAULT_FILLERS);
    this.punctuationRules = DEFAULT_PUNCTUATION_RULES;
  }

  /**
   * 执行完整的文本清洗流程
   *
   * @param rawText - ASR 原始输出文本
   * @returns 清洗后的结果（包含操作记录）
   */
  clean(rawText: string): CleaningResult {
    let text = rawText;
    const operations: CleaningResult['operations'] = [];

    // 1. 语气词过滤
    if (this.config.enableFillerFilter) {
      const before = text;
      text = this.removeFillers(text);
      if (text !== before) {
        operations.push({
          name: 'remove_filler',
          description: '过滤语气词/填充词',
          before,
          after: text,
        });
      }
    }

    // 2. 数字格式化
    if (this.config.enableNumberFormat) {
      const before = text;
      text = this.formatNumbers(text);
      if (text !== before) {
        operations.push({
          name: 'format_number',
          description: '中文数字格式化',
          before,
          after: text,
        });
      }
    }

    // 3. 标点补全
    if (this.config.enablePunctuation) {
      const before = text;
      text = this.restorePunctuation(text);
      if (text !== before) {
        operations.push({
          name: 'add_punctuation',
          description: '标点补全',
          before,
          after: text,
        });
      }
    }

    // 4. 最终整理：去除首尾空格、合并多余空格
    text = text.replace(/\s+/g, '').trim();

    return { text, operations };
  }

  /**
   * 快速清洗（不记录操作）
   * 适合批量处理场景
   */
  cleanQuick(rawText: string): string {
    return this.clean(rawText).text;
  }

  // ===================== 内部方法 =====================

  /**
   * 过滤语气词
   */
  private removeFillers(text: string): string {
    let result = text;
    for (const rule of this.fillerRules) {
      result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
  }

  /**
   * 标点补全
   */
  private restorePunctuation(text: string): string {
    let result = text;
    for (const rule of this.punctuationRules) {
      result = result.replace(rule.pattern, rule.replacement);
    }

    // 确保文本以句号或问号结尾
    if (result.length > 0 && !/[。！？\.!\?]/.test(result[result.length - 1])) {
      result = result + '。';
    }

    return result;
  }

  /**
   * 数字格式化
   */
  private formatNumbers(text: string): string {
    let result = text;
    for (const rule of DEFAULT_NUMBER_RULES) {
      result = result.replace(rule.pattern, rule.replacement as unknown as string);
    }
    return result;
  }
}

/**
 * 便捷函数：直接对文本进行清洗
 */
export function cleanText(rawText: string, config?: TextCleaningConfig): string {
  const cleaner = new TextCleaner(config);
  return cleaner.cleanQuick(rawText);
}
