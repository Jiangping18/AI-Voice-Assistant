/**
 * Pipeline 编排器类型定义
 *
 * @module pipeline/types
 */

import type { ASRSegment, ASRResult, PipelineConfig } from '../asr/types';

export type { ASRSegment, ASRResult, PipelineConfig };

/**
 * pipeline 执行状态
 */
export enum PipelineState {
  IDLE = 'idle',
  LOADING_AUDIO = 'loading_audio',
  ASR = 'asr',
  DIARIZATION = 'diarization',
  TEXT_CLEANING = 'text_cleaning',
  MERGING = 'merging',
  COMPLETED = 'completed',
  ERROR = 'error',
}

/**
 * Pipeline 执行进度回调
 */
export interface PipelineCallbacks {
  onStateChange?: (state: PipelineState, detail?: string) => void;
  onProgress?: (percent: number, message: string) => void;
  onSegment?: (segment: ASRSegment) => void;
  onError?: (error: Error) => void;
  onComplete?: (result: ASRResult) => void;
}

/**
 * Pipeline 执行统计
 */
export interface PipelineStats {
  /** 音频时长（秒） */
  audioDurationSec: number;
  /** ASR 耗时（毫秒） */
  asrTimeMs: number;
  /** 说话人分离耗时（毫秒） */
  diarizationTimeMs: number;
  /** 文本清洗耗时（毫秒） */
  textCleaningTimeMs: number;
  /** 总计耗时（毫秒） */
  totalTimeMs: number;
  /** 识别片段数 */
  segmentCount: number;
  /** 说话人数量 */
  speakerCount: number;
}
