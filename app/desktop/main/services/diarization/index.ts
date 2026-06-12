/**
 * 说话人分离服务模块 - 入口
 *
 * 提供完整的说话人分离服务，供 Pipeline 或其他模块调用。
 * 默认使用 Sherpa-ONNX + 3D-Speaker 嵌入模型，备选 PyAnnote。
 *
 * @module diarization
 */

import type { DiarizationResult, DiarizationSegment } from './types';
import type { DiarizationConfig } from '../asr/types';
import { createDiarizationEngine, SherpaOnnxDiarizationEngine } from './engine';
import { DEFAULT_DIARIZATION_CONFIG } from '../asr/config';

export type { DiarizationResult, DiarizationSegment };
export type { DiarizationConfig };
export { SherpaOnnxDiarizationEngine };
export { createDiarizationEngine };

/**
 * 说话人分离服务类
 *
 * @example
 * ```ts
 * const diar = new DiarizationService();
 * await diar.initialize();
 * const result = await diar.diarizeFile('/path/to/audio.wav');
 * // [
 * //   { speaker: "speaker_0", start: 0.0, end: 12.5 },
 * //   { speaker: "speaker_1", start: 12.5, end: 25.0 },
 * // ]
 * ```
 */
export class DiarizationService {
  private engine: SherpaOnnxDiarizationEngine | null = null;
  private config: DiarizationConfig;

  constructor(config: DiarizationConfig = DEFAULT_DIARIZATION_CONFIG) {
    this.config = { ...DEFAULT_DIARIZATION_CONFIG, ...config };
  }

  /**
   * 初始化服务（加载模型）
   */
  async initialize(): Promise<void> {
    const engine = createDiarizationEngine(this.config);
    if (engine instanceof SherpaOnnxDiarizationEngine) {
      await engine.init();
      this.engine = engine;
    }
  }

  /**
   * 对音频文件进行说话人分离
   *
   * @param audioFilePath - 音频文件绝对路径
   * @returns 说话人分离时间线
   */
  async diarizeFile(audioFilePath: string): Promise<DiarizationResult> {
    const fs = require('fs');
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`音频文件不存在: ${audioFilePath}`);
    }

    // 加载音频为 PCM float32
    const samples = await this.loadAudio(audioFilePath);

    if (this.engine) {
      // Sherpa-ONNX 引擎
      return await this.engine.diarize(samples);
    } else {
      // PyAnnote 引擎：直接传文件路径
      const pyannoteEngine = createDiarizationEngine({
        ...this.config,
        engine: 'pyannote',
      }) as import('./engine').PyannoteDiarizationEngine;
      return await pyannoteEngine.diarize(audioFilePath);
    }
  }

  /**
   * 释放引擎资源
   */
  release(): void {
    if (this.engine) {
      this.engine.release();
      this.engine = null;
    }
  }

  /**
   * 加载音频文件为 PCM float32
   */
  private async loadAudio(filePath: string): Promise<Float32Array> {
    const path = require('path');
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.wav') {
      return this.loadWavFile(filePath);
    }

    // 非 wav 格式使用 ffmpeg 转码
    return this.transcodeWithFFmpeg(filePath);
  }

  /**
   * 加载 WAV 文件
   */
  private async loadWavFile(filePath: string): Promise<Float32Array> {
    const fs = require('fs');
    const buffer = fs.readFileSync(filePath);
    const dataOffset = 44; // 标准 WAV 头
    const numChannels = buffer.readUInt16LE(22);

    const sampleCount = (buffer.length - dataOffset) / 2;
    const pcmData = new Float32Array(sampleCount / numChannels);

    for (let i = 0; i < pcmData.length; i++) {
      pcmData[i] = buffer.readInt16LE(dataOffset + i * numChannels * 2) / 32768;
    }

    return pcmData;
  }

  /**
   * 使用 ffmpeg 转码
   */
  private async transcodeWithFFmpeg(filePath: string): Promise<Float32Array> {
    const { execSync } = require('child_process');
    const cmd = `ffmpeg -y -i "${filePath}" -ar 16000 -ac 1 -f s16le -`;
    const rawBuffer: Buffer = execSync(cmd, { maxBuffer: 100 * 1024 * 1024 });

    const sampleCount = rawBuffer.length / 2;
    const pcmData = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      pcmData[i] = rawBuffer.readInt16LE(i * 2) / 32768;
    }
    return pcmData;
  }
}
