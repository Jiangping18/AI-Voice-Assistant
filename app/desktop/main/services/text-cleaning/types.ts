/**
 * 文本清洗模块类型定义
 *
 * @module text-cleaning/types
 */

import type { TextCleaningConfig } from '../asr/types';

export type { TextCleaningConfig };

/** 文本清洗操作记录 */
export interface CleaningOperation {
  /** 操作名称，如 "remove_filler", "add_punctuation", "format_number" */
  name: string;
  /** 操作描述 */
  description: string;
  /** 操作前的原文 */
  before: string;
  /** 操作后的结果 */
  after: string;
}

/** 文本清洗结果 */
export interface CleaningResult {
  /** 清洗后的文本 */
  text: string;
  /** 所有清洗操作记录 */
  operations: CleaningOperation[];
}
