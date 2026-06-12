/**
 * ASR（自动语音识别）服务模块 - 入口
 *
 * 提供高层 API，供 Electron 主进程或其他模块调用。
 * 支持两种模式：
 *   1. 离线模式：接收完整音频文件路径，返回完整 JSON 结果
 *   2. 流式模式：逐帧输入 PCM 数据，实时输出识别结果
 *
 * @module asr
 */

import { OfflineEngine } from './engine';
import { StreamingDecoder } from './stream';
import type { OnlineASRConfig, ASRSegment, ASRResult, StreamCallbacks } from './types';
import { DEFAULT_ASR_CONFIG } from './config';

export type { OnlineASRConfig, ASRSegment, ASRResult, StreamCallbacks };
export { OfflineEngine, StreamingDecoder };
export { DEFAULT_ASR_CONFIG } from './config';
export * from './types';

// ===================== 高层便捷 API =====================

/**
 * 创建 ASR 服务实例（推荐入口）
 *
 * 使用方式:
 * ```ts
 * import { createASRService } from '../services/asr';
 *
 * const asr = createASRService();
 * const result = await asr.transcribeFile('/path/to/audio.wav');
 * console.log(result);
 * ```
 */
export function createASRService(config?: Partial<OnlineASRConfig>) {
  const mergedConfig: OnlineASRConfig = { ...DEFAULT_ASR_CONFIG, ...config };
  return new ASRService(mergedConfig);
}

/**
 * ASR 服务类
 * 提供对完整音频文件的端到端转写能力
 */
export class ASRService {
  private engine: OfflineEngine;
  private config: OnlineASRConfig;

  constructor(config: OnlineASRConfig = DEFAULT_ASR_CONFIG) {
    this.config = config;
    this.engine = new OfflineEngine(config);
  }

  /**
   * 初始化服务（加载模型）
   * 建议在应用启动时调用一次
   */
  async initialize(): Promise<void> {
    await this.engine.init();
  }

  /**
   * 转写完整音频文件
   *
   * @param audioFilePath - 音频文件绝对路径（支持 wav / pcm / mp3）
   * @param audioId - 可选，自定义音频标识；缺省时由文件名自动生成
   * @returns 带顶层包装的识别结果
   *
   * @example
   * ```ts
   * const result = await asr.transcribeFile('F:/recordings/meeting.wav');
   * // {
   * //   audio_id: "meeting",
   * //   duration: 125.3,
   * //   segments: [
   * //     { speaker: "speaker_0", text: "今天开会讨论", start: 0.0, end: 3.2 },
   * //   ],
   * //   full_text: "speaker_0：今天开会讨论"
   * // }
   * ```
   */
  async transcribeFile(audioFilePath: string, audioId?: string): Promise<ASRResult> {
    // 1. 检查文件是否存在
    const fs = require('fs');
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`音频文件不存在: ${audioFilePath}`);
    }

    // 2. 自动生成 audio_id
    const resolvedAudioId = audioId || this.generateAudioId(audioFilePath);

    // 3. 读取并解码音频文件为 PCM float32
    const samples = await this.loadAudioFile(audioFilePath);

    // 4. 计算音频时长
    const duration = samples.length / 16000;

    // 5. 执行离线转写
    const segments = this.engine.transcribeWithTimestamps(samples);

    // 6. 拼接完整对话文本
    const fullText = this.buildFullText(segments);

    return {
      audio_id: resolvedAudioId,
      duration,
      segments,
      full_text: fullText,
    };
  }

  /**
   * 释放引擎资源
   */
  release(): void {
    this.engine.release();
  }

  // ===================== 辅助方法 =====================

  /**
   * 从文件路径自动生成 audio_id
   */
  private generateAudioId(filePath: string): string {
    const path = require('path');
    const basename = path.basename(filePath, path.extname(filePath));
    // 去除空格和特殊字符，截断长度限制
    return basename.replace(/[^a-zA-Z0-9_一-鿿\-]/g, '_').slice(0, 64) || `audio_${Date.now()}`;
  }

  /**
   * 将片段列表拼接为带说话人前缀的完整对话文本
   */
  private buildFullText(segments: ASRSegment[]): string {
    return segments
      .map((seg) => `${seg.speaker}：${seg.text}`)
      .join('');
  }

  // ===================== 音频加载方法 =====================

  /**
   * 从音频文件加载为 PCM float32 数据
   *
   * 支持格式：wav（pcm16）、mp3（需 ffmpeg）
   * 内部使用，后续可替换为更专业的解码库
   */
  private async loadAudioFile(filePath: string): Promise<Float32Array> {
    const path = require('path');
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.wav') {
      return this.loadWavFile(filePath);
    }

    if (ext === '.pcm') {
      return this.loadPcmFile(filePath);
    }

    // mp3 / m4a / opus 等格式：调用 ffmpeg 转码
    if (['.mp3', '.m4a', '.opus', '.aac', '.ogg'].includes(ext)) {
      return this.transcodeWithFFmpeg(filePath);
    }

    throw new Error(`不支持的音频格式: ${ext}，支持 wav/pcm/mp3/m4a/opus/aac/ogg`);
  }

  /**
   * 加载 WAV 文件（PCM16 格式）
   */
  private async loadWavFile(filePath: string): Promise<Float32Array> {
    const fs = require('fs');
    const buffer = fs.readFileSync(filePath);

    // WAV 头部解析（44 字节标准头）
    const dataOffset = buffer.readUInt32LE(40) + 44 || 44; // data chunk offset
    const bitsPerSample = buffer.readUInt16LE(34); // 16 or 32
    const numChannels = buffer.readUInt16LE(22);

    // 读取 PCM 数据
    let pcmData: Float32Array;

    if (bitsPerSample === 16) {
      // 16-bit PCM：有符号 short
      const sampleCount = (buffer.length - dataOffset) / 2;
      pcmData = new Float32Array(sampleCount / numChannels);

      for (let i = 0; i < pcmData.length; i++) {
        // 取第一个声道，将 int16 归一化到 [-1, 1]
        pcmData[i] = buffer.readInt16LE(dataOffset + i * numChannels * 2) / 32768;
      }
    } else if (bitsPerSample === 32) {
      // 32-bit float PCM
      const sampleCount = (buffer.length - dataOffset) / 4;
      pcmData = new Float32Array(sampleCount / numChannels);

      for (let i = 0; i < pcmData.length; i++) {
        pcmData[i] = buffer.readFloatLE(dataOffset + i * numChannels * 4);
      }
    } else {
      throw new Error(`不支持的 WAV 位深: ${bitsPerSample}，仅支持 16/32 bit`);
    }

    return pcmData;
  }

  /**
   * 加载原始 PCM 文件（16kHz、16bit、单声道）
   */
  private async loadPcmFile(filePath: string): Promise<Float32Array> {
    const fs = require('fs');
    const buffer = fs.readFileSync(filePath);

    // 16-bit PCM：有符号 short
    const sampleCount = buffer.length / 2;
    const pcmData = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      pcmData[i] = buffer.readInt16LE(i * 2) / 32768;
    }

    return pcmData;
  }

  /**
   * 使用 ffmpeg 转码音频文件为 16kHz 单声道 PCM
   * 需系统安装 ffmpeg
   */
  private async transcodeWithFFmpeg(filePath: string): Promise<Float32Array> {
    const { execSync } = require('child_process');

    try {
      // 调用 ffmpeg 将音频转为 16kHz 单声道 s16le PCM
      const cmd = `ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -f s16le -`;
      const rawBuffer: Buffer = execSync(cmd, { maxBuffer: 100 * 1024 * 1024 });

      // 将 int16 转为 float32
      const sampleCount = rawBuffer.length / 2;
      const pcmData = new Float32Array(sampleCount);

      for (let i = 0; i < sampleCount; i++) {
        pcmData[i] = rawBuffer.readInt16LE(i * 2) / 32768;
      }

      return pcmData;
    } catch (err) {
      throw new Error(
        `ffmpeg 转码失败，请确认已安装 ffmpeg 且支持该格式: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
