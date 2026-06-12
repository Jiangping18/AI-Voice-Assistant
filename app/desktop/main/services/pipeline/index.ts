/**
 * ASR 全流程编排器
 *
 * 将 ASR（语音识别）+ 说话人分离 + 文本清洗 串联为完整的处理流水线。
 * 输入完整音频文件路径，输出严格符合 JSON Schema 的识别结果。
 *
 * 流程:
 *   Audio File → ASR → 文本清洗 → Diarization → 时间线融合 → JSON 输出
 *
 * @module pipeline
 */

import type { ASRConfig, ASRSegment, ASRResult } from '../asr/types';
import type { PipelineConfig, PipelineCallbacks, PipelineStats } from './types';
import { PipelineState } from './types';
import { ASRService } from '../asr/index';
import { TextCleaner } from '../text-cleaning/index';
import { DiarizationService } from '../diarization/index';
import { DEFAULT_PIPELINE_CONFIG } from '../asr/config';

export type { ASRConfig, ASRSegment, ASRResult, PipelineConfig, PipelineCallbacks, PipelineStats };
export { PipelineState };

/**
 * ASR Pipeline 服务
 *
 * 完整的语音识别+说话人分离+文本清洗流水线。
 *
 * @example
 * ```ts
 * const pipeline = new ASRPipeline();
 * await pipeline.initialize();
 *
 * const result = await pipeline.processFile('F:/recordings/meeting.wav');
 * // [
 * //   { speaker: "speaker_0", text: "今天开会主要讨论一下项目进度。", start: 0.0, end: 5.2 },
 * //   { speaker: "speaker_1", text: "好的我先汇报一下。",           start: 5.5, end: 8.0 },
 * // ]
 *
 * console.log(pipeline.getStats());
 * pipeline.release();
 * ```
 */
export class ASRPipeline {
  private asrService: ASRService;
  private textCleaner: TextCleaner;
  private diarizationService: DiarizationService;
  private config: PipelineConfig;
  private callbacks: PipelineCallbacks;
  private state: PipelineState = PipelineState.IDLE;
  private stats: PipelineStats | null = null;

  constructor(
    config: Partial<PipelineConfig> = {},
    callbacks: PipelineCallbacks = {}
  ) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.callbacks = callbacks;
    this.asrService = new ASRService(this.config.asr);
    this.textCleaner = new TextCleaner(this.config.textCleaning);
    this.diarizationService = new DiarizationService(this.config.diarization);
  }

  /**
   * 初始化所有服务（加载模型）
   * 建议在应用启动或首次使用前调用
   */
  async initialize(): Promise<void> {
    this.setState(PipelineState.IDLE, '正在加载模型...');

    // 并行加载模型
    await Promise.all([
      this.asrService.initialize(),
      this.diarizationService.initialize(),
    ]);

    console.log('[Pipeline] 所有服务初始化完成');
  }

  /**
   * 处理单个完整的音频文件
   *
   * @param audioFilePath - 音频文件绝对路径
   * @param options - 可选参数
   * @returns 带顶层包装的识别结果
   */
  async processFile(
    audioFilePath: string,
    options?: {
      /** 说话人分离分段窗长（秒），默认 1.5 */
      diarizationWindow?: number;
      /** 自定义音频标识；缺省时由文件名自动生成 */
      audioId?: string;
    }
  ): Promise<ASRResult> {
    const startTime = Date.now();
    const perf: { asr?: number; diar?: number; clean?: number } = {};
    const audioId = options?.audioId || this.generateAudioId(audioFilePath);
    const durationS = this.estimateAudioDuration(audioFilePath);

    try {
      // ===== 阶段 1：ASR 识别 =====
      this.setState(PipelineState.ASR, '正在执行语音识别...');
      this.emitProgress(10, '正在加载音频...');

      const asrStart = Date.now();
      const asrRaw = await this.asrService.transcribeFile(audioFilePath, audioId);
      const asrSegments = asrRaw.segments;
      perf.asr = Date.now() - asrStart;

      if (asrSegments.length === 0) {
        throw new Error('ASR 识别未产生任何文本结果');
      }

      this.emitProgress(40, '语音识别完成');

      // ===== 阶段 2：说话人分离 =====
      this.setState(PipelineState.DIARIZATION, '正在分离说话人...');
      const diarStart = Date.now();
      const diarResult = await this.diarizationService.diarizeFile(audioFilePath);
      perf.diar = Date.now() - diarStart;

      this.emitProgress(70, '说话人分离完成');

      // ===== 阶段 3：融合 ASR 与 Diarization 结果 =====
      this.setState(PipelineState.MERGING, '正在融合识别结果...');
      const mergedSegments = this.mergeASRWithDiarization(asrSegments, diarResult);

      // ===== 阶段 4：文本清洗 =====
      this.setState(PipelineState.TEXT_CLEANING, '正在清洗文本...');
      const cleanStart = Date.now();

      const cleanedSegments = mergedSegments.map((seg) => ({
        ...seg,
        text: this.textCleaner.cleanQuick(seg.text),
      }));

      perf.clean = Date.now() - cleanStart;

      // ===== 构造最终结果 =====
      const fullText = cleanedSegments
        .map((seg) => `${seg.speaker}：${seg.text}`)
        .join('');

      const finalResult: ASRResult = {
        audio_id: audioId,
        duration: durationS,
        segments: cleanedSegments,
        full_text: fullText,
      };

      // ===== 完成 =====
      const totalTime = Date.now() - startTime;

      this.stats = {
        audioDurationSec: durationS,
        asrTimeMs: perf.asr || 0,
        diarizationTimeMs: perf.diar || 0,
        textCleaningTimeMs: perf.clean || 0,
        totalTimeMs: totalTime,
        segmentCount: cleanedSegments.length,
        speakerCount: new Set(cleanedSegments.map((s) => s.speaker)).size,
      };

      this.setState(PipelineState.COMPLETED, `处理完成，共 ${cleanedSegments.length} 个片段`);
      this.emitProgress(100, '处理完成');

      if (this.callbacks.onComplete) {
        this.callbacks.onComplete(finalResult);
      }

      // 输出性能日志
      console.log('[Pipeline] 性能统计:', {
        audio_id: audioId,
        音频时长: `${durationS.toFixed(1)}s`,
        ASR耗时: `${perf.asr}ms`,
        说话人分离: `${perf.diar}ms`,
        文本清洗: `${perf.clean}ms`,
        总计: `${totalTime}ms`,
        片段数: cleanedSegments.length,
      });

      return finalResult;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.setState(PipelineState.ERROR, error.message);

      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }

      throw error;
    }
  }

  /**
   * 获取 pipeline 执行统计
   */
  getStats(): PipelineStats | null {
    return this.stats;
  }

  /**
   * 获取当前状态
   */
  getState(): PipelineState {
    return this.state;
  }

  /**
   * 释放所有服务资源
   */
  release(): void {
    this.asrService.release();
    this.diarizationService.release();
    this.state = PipelineState.IDLE;
    console.log('[Pipeline] 所有服务已释放');
  }

  // ===================== 内部方法 =====================

  /**
   * 将 ASR 结果与说话人分离结果融合
   *
   * 策略：
   * 1. 说话人分离结果作为"粗粒度"时间线
   * 2. ASR 分段作为"细粒度"文本片段
   * 3. 根据时间戳重叠将说话人标签赋给 ASR 段
   */
  private mergeASRWithDiarization(
    asrSegments: ASRSegment[],
    diarSegments: Array<{ speaker: string; start: number; end: number }>
  ): ASRSegment[] {
    if (diarSegments.length === 0) {
      // 无说话人分离结果，全部标为 unknown
      return asrSegments.map((s) => ({ ...s, speaker: 'unknown' }));
    }

    if (asrSegments.length === 0) {
      return [];
    }

    return asrSegments.map((asrSeg) => {
      // 找到与 ASR 段重叠最多的 diarization 段
      let bestSpeaker = 'unknown';
      let maxOverlap = 0;

      for (const diarSeg of diarSegments) {
        const overlapStart = Math.max(asrSeg.start, diarSeg.start);
        const overlapEnd = Math.min(asrSeg.end, diarSeg.end);
        const overlap = Math.max(0, overlapEnd - overlapStart);

        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestSpeaker = diarSeg.speaker;
        }
      }

      return {
        ...asrSeg,
        speaker: bestSpeaker,
      };
    });
  }

  /**
   * 从文件路径自动生成 audio_id
   */
  private generateAudioId(filePath: string): string {
    const path = require('path');
    const basename = path.basename(filePath, path.extname(filePath));
    return basename.replace(/[^a-zA-Z0-9_一-鿿\-]/g, '_').slice(0, 64) || `audio_${Date.now()}`;
  }

  /**
   * 估算音频文件时长
   */
  private estimateAudioDuration(filePath: string): number {
    try {
      const { execSync } = require('child_process');
      // 使用 ffprobe 获取时长
      const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
      const output = execSync(cmd, { timeout: 5000 }).toString().trim();
      return parseFloat(output) || 0;
    } catch {
      // 无法获取时返回 0
      return 0;
    }
  }

  /**
   * 更新状态并触发回调
   */
  private setState(state: PipelineState, detail?: string): void {
    this.state = state;
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(state, detail);
    }
  }

  /**
   * 发送进度回调
   */
  private emitProgress(percent: number, message: string): void {
    if (this.callbacks.onProgress) {
      this.callbacks.onProgress(percent, message);
    }
  }
}

/**
 * 便捷函数：一键处理音频文件
 *
 * @param audioFilePath - 音频文件路径
 * @returns ASR 识别结果
 *
 * @example
 * ```ts
 * import { transcribeAudio } from '../services/pipeline';
 *
 * const result = await transcribeAudio('F:/recordings/meeting.wav');
 * console.log(JSON.stringify(result, null, 2));
 * ```
 */
export async function transcribeAudio(audioFilePath: string): Promise<ASRResult> {
  const pipeline = new ASRPipeline();
  await pipeline.initialize();
  try {
    return await pipeline.processFile(audioFilePath);
  } finally {
    pipeline.release();
  }
}
