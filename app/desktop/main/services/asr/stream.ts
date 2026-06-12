/**
 * 流式解码模块
 *
 * 实现边接收音频边输出识别结果的功能。
 * 基于 Sherpa-ONNX OnlineRecognizer，支持：
 * - 逐帧输入 PCM 音频数据
 * - 实时输出中间（partial）识别结果
 * - 端点检测自动分段（endpoint）
 * - 段级别最终结果回调
 *
 * @module asr/stream
 */

import type { ASRSegment, ASRResult, StreamCallbacks } from './types';
import { StreamState } from './types';
import { createOnlineEngine, OfflineEngine } from './engine';
import type { OnlineASRConfig } from './types';

// ===================== 时间戳估算常量 =====================

/** 每帧的样本数（Sherpa-ONNX 默认帧移） */
const FRAME_SHIFT_SAMPLES = 160; // 10ms at 16kHz
/** 每帧时长（秒） */
const FRAME_DURATION_S = FRAME_SHIFT_SAMPLES / 16000;

// ===================== 流式解码器 =====================

/**
 * 流式解码器
 *
 * 用法:
 * ```ts
 * const decoder = new StreamingDecoder(config, {
 *   onPartialResult: (text) => console.log('中间结果:', text),
 *   onFinalResult: (seg) => console.log('最终结果:', seg),
 * });
 * await decoder.start();
 * decoder.feed(pcmChunk);        // 逐帧喂入音频
 * decoder.feed(nextChunk);
 * decoder.finish();               // 通知解码完成
 * const result = decoder.getResult();  // 取所有结果
 * ```
 */
export class StreamingDecoder {
  private recognizer: any = null;
  private stream: any = null;
  private config: OnlineASRConfig;
  private callbacks: StreamCallbacks;
  private state: StreamState = StreamState.IDLE;
  private audioId: string;

  /** 已收到的总样本数 */
  private totalSamples = 0;
  /** 当前段的起始样本偏移 */
  private segmentStartSample = 0;
  /** 已完成的段 */
  private segments: ASRSegment[] = [];
  /** 当前段的累积文本 */
  private currentSegmentText = '';
  /** 当前段是否已开始 */
  private segmentActive = false;
  /** 当前说话人（由外部 diarization 赋值） */
  private currentSpeaker = 'unknown';

  constructor(
    config: OnlineASRConfig,
    callbacks: StreamCallbacks = {},
    audioId?: string
  ) {
    this.config = config;
    this.callbacks = callbacks;
    this.audioId = audioId || `stream_${Date.now()}`;
  }

  /**
   * 初始化并启动流式识别
   */
  async start(): Promise<void> {
    this.setState(StreamState.LISTENING);

    // 创建在线识别引擎
    this.recognizer = await createOnlineEngine(this.config);

    // 创建一个识别流
    this.stream = this.recognizer.createStream();

    console.log('[StreamingDecoder] 流式解码器已启动');
  }

  /**
   * 喂入 PCM 音频数据（16kHz、单声道、float32）
   *
   * @param samples - PCM float32 音频片段
   */
  feed(samples: Float32Array): void {
    if (this.state === StreamState.FINISHED || this.state === StreamState.ERROR) {
      return;
    }

    if (!this.stream || !this.recognizer) {
      throw new Error('解码器未启动，请先调用 start()');
    }

    // 将音频数据送入流
    this.stream.acceptWaveform({
      samples,
      sampleRate: 16000,
    });

    this.totalSamples += samples.length;
    this.recognizer.decode(this.stream);

    // 检查是否有 endpoint
    const isEndpoint = this.recognizer.isEndpoint(this.stream);

    // 获取当前解码文本
    const text = this.stream.result.text as string;
    const cleanedText = this.cleanSenseVoiceOutput(text);

    if (cleanedText) {
      if (!this.segmentActive) {
        // 新段开始
        this.segmentActive = true;
        this.segmentStartSample = this.totalSamples - samples.length;
        this.currentSpeaker = 'unknown';
      }
      this.currentSegmentText = cleanedText;

      // 触发中间结果回调
      if (this.callbacks.onPartialResult) {
        const startTime = this.samplesToSeconds(this.segmentStartSample);
        this.callbacks.onPartialResult(cleanedText, startTime, this.samplesToSeconds(this.totalSamples));
      }
    }

    if (isEndpoint && this.segmentActive) {
      this.finalizeSegment();
      this.recognizer.reset(this.stream);
      this.setState(StreamState.ENDPOINT);
    }
  }

  /**
   * 通知解码器音频输入完成，最终确定最后一段
   */
  finish(): void {
    if (this.segmentActive) {
      this.finalizeSegment();
    }

    this.setState(StreamState.FINISHED);

    // 清理流和识别器
    if (this.stream) {
      try {
        this.stream.free();
      } catch {
        // ignore
      }
      this.stream = null;
    }
    if (this.recognizer) {
      try {
        this.recognizer.release();
      } catch {
        // ignore
      }
      this.recognizer = null;
    }

    console.log(`[StreamingDecoder] 解码完成，共 ${this.segments.length} 个片段`);
  }

  /**
   * 设置当前段的说话人标签
   * 由外部说话人分离模块在识别过程中调用
   */
  setSpeaker(speaker: string): void {
    if (speaker !== this.currentSpeaker) {
      const oldSpeaker = this.currentSpeaker;
      this.currentSpeaker = speaker;

      if (this.callbacks.onSpeakerChange) {
        this.callbacks.onSpeakerChange(speaker, this.samplesToSeconds(this.totalSamples));
      }

      // 说话人变更时，如果当前段已有文本则结束当前段开始新段
      if (this.segmentActive && this.currentSegmentText) {
        this.finalizeSegment();
        this.segmentStartSample = this.totalSamples;
        this.currentSpeaker = speaker;
        this.segmentActive = true;
      }
    }
  }

  /**
   * 获取所有已完成的识别结果（建议在 finish() 调用后获取完整结果）
   *
   * @returns 带顶层包装的识别结果（duration 在 finish() 前可能为估算值）
   */
  getResult(): ASRResult {
    const duration = this.samplesToSeconds(this.totalSamples);
    return {
      audio_id: this.audioId,
      duration,
      segments: [...this.segments],
      full_text: this.buildFullText(this.segments),
    };
  }

  /**
   * 获取当前解码器状态
   */
  getState(): StreamState {
    return this.state;
  }

  // ===================== 内部方法 =====================

  /**
   * 最终确定当前段
   */
  private finalizeSegment(): void {
    if (!this.currentSegmentText) return;

    const segment: ASRSegment = {
      speaker: this.currentSpeaker,
      text: this.currentSegmentText,
      start: this.samplesToSeconds(this.segmentStartSample),
      end: this.samplesToSeconds(this.totalSamples),
    };

    this.segments.push(segment);

    if (this.callbacks.onFinalResult) {
      this.callbacks.onFinalResult(segment);
    }

    // 重置当前段
    this.currentSegmentText = '';
    this.segmentActive = false;
  }

  /**
   * 样本数转秒数
   */
  private samplesToSeconds(samples: number): number {
    return samples / 16000;
  }

  /**
   * 更新状态并触发回调
   */
  private setState(newState: StreamState): void {
    this.state = newState;
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(newState);
    }
  }

  /**
   * 拼接完整对话文本
   */
  private buildFullText(segments: ASRSegment[]): string {
    return segments
      .map((seg) => `${seg.speaker}：${seg.text}`)
      .join('');
  }

  /**
   * 清洗 SenseVoice 输出的特殊标签
   */
  private cleanSenseVoiceOutput(text: string): string {
    if (!text) return '';

    return text
      .replace(/<\|(zh|en|ja|ko|yue)\|>/g, '')
      .replace(/<\|(NEUTRAL|HAPPY|SAD|ANGRY|FRIGHTENED)\|>/g, '')
      .replace(/<\|[^>]+\|>/g, '')
      .replace(/\|/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
