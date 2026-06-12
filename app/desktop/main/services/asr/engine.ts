/**
 * Sherpa-ONNX 引擎封装层
 *
 * 负责加载 SenseVoiceSmall INT8 量化模型，
 * 提供离线转写（transcribe）和在线流式识别（createOnlineRecognizer）两种模式。
 *
 * 依赖 npm 包: sherpa-onnx（社区预编译版本）
 * 安装: npm install sherpa-onnx
 *
 * @module asr/engine
 */

import type { OnlineASRConfig, ASRSegment } from './types';
import { DEFAULT_ASR_CONFIG } from './config';

// ===================== Sherpa-ONNX 类型声明 =====================
// sherpa-onnx 的 npm 包导出全局对象，此处做类型扩展
// 详细 API 参考: https://github.com/k2-fsa/sherpa-onnx

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sherpaOnnx: any = null;

/**
 * 延迟加载 sherpa-onnx 模块
 * 在非 Electron 环境（如纯 Node 测试）也能正常工作
 */
async function loadSherpaOnnx(): Promise<void> {
  if (sherpaOnnx) return;
  try {
    // 动态 require 避免模块未安装时直接 crash
    sherpaOnnx = require('sherpa-onnx');
  } catch (err) {
    throw new Error(
      '无法加载 sherpa-onnx 模块，请执行: npm install sherpa-onnx\n' +
        '详情: https://github.com/k2-fsa/sherpa-onnx/releases'
    );
  }
}

// ===================== 离线识别引擎 =====================

/**
 * Sherpa-ONNX 离线识别引擎
 * 用于处理完整音频文件的批量识别
 */
export class OfflineEngine {
  private recognizer: any;
  private config: OnlineASRConfig;
  private initialized = false;

  constructor(config: OnlineASRConfig = DEFAULT_ASR_CONFIG) {
    this.config = { ...config };
  }

  /**
   * 初始化引擎，加载模型
   * 需确保模型文件已下载到对应路径
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await loadSherpaOnnx();

    const offlineConfig = {
      featConfig: {
        samplingRate: this.config.samplingRate,
        featureDim: this.config.featureDim,
      },
      modelConfig: {
        senseVoice: {
          model: this.config.encoderModel,
          tokens: this.config.tokens,
          numThreads: 2,
        },
        // SenseVoice 使用 encoder-only 架构，decoder/joiner 传空
        // 对于其他模型类型（如 zipformer2）需填充 decoder/joiner
      },
      decodingConfig: {
        method: this.config.decodingMethod,
        numActivePaths: this.config.maxActivePaths,
      },
      enableEndpoint: true,
      endpointConfig: {
        rule1MustContainSilence: true,
        rule1SilenceDurationS: 2.4,
        rule2MustContainSilence: true,
        rule2SilenceDurationS: 1.2,
        rule2MinTrailingSilence: 2.4,
      },
    };

    try {
      this.recognizer = new sherpaOnnx.OfflineRecognizer(offlineConfig);
      this.initialized = true;
      console.log('[ASR Engine] 离线引擎初始化完成，模型:', this.config.encoderModel);
    } catch (err) {
      throw new Error(
        `Sherpa-ONNX 离线引擎初始化失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 对完整 PCM 数据进行转写
   *
   * @param samples - 16kHz 单声道 PCM float32 音频数据
   * @param sampleRate - 采样率（需与模型匹配）
   * @returns 识别文本列表（每段对应一个 endpoint 分割）
   */
  transcribe(samples: Float32Array, sampleRate: number = 16000): string[] {
    if (!this.initialized) {
      throw new Error('引擎未初始化，请先调用 init()');
    }

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate });

    // 运行解码
    this.recognizer.decode(stream);

    // 获取结果并转换为文字
    const text = stream.result.text as string;
    stream.free();

    // SenseVoice 返回结果可能包含语言标签前缀如 "<|zh|><|NEUTRAL|>"
    // 需要清洗
    const cleaned = this.cleanSenseVoiceOutput(text);

    return cleaned ? [cleaned] : [];
  }

  /**
   * 完整转写：输入 PCM 数据，返回带时间戳的分段结果
   * 注意：OfflineRecognizer 不返回时间戳，
   * 精确时间戳需要使用 OnlineRecognizer + 对齐
   *
   * @param samples - 16kHz 单声道 PCM float32 数据
   * @param sampleRate - 采样率
   * @returns 分段结果（不含时间戳，用于后续对齐）
   */
  transcribeWithTimestamps(
    samples: Float32Array,
    sampleRate: number = 16000
  ): ASRSegment[] {
    if (!this.initialized) {
      throw new Error('引擎未初始化，请先调用 init()');
    }

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate });

    // 使用支持时间戳的解码方式
    this.recognizer.decode(stream);

    const text = this.cleanSenseVoiceOutput(stream.result.text as string);
    stream.free();

    if (!text) return [];

    // 离线模式无法精确分段，返回整段结果
    // 精确时间戳和分段请使用 OnlineEngine（流式解码）
    const durationSec = samples.length / sampleRate;
    return [
      {
        speaker: 'unknown',
        text,
        start: 0,
        end: durationSec,
      },
    ];
  }

  /**
   * 释放引擎资源
   */
  release(): void {
    if (this.recognizer) {
      try {
        this.recognizer.release();
      } catch {
        // ignore release errors
      }
      this.initialized = false;
    }
  }

  /**
   * 清洗 SenseVoice 输出的特殊标签
   * SenseVoice 会在文本中插入 <|zh|> <|NEUTRAL|> <| laughter |> 等标签
   */
  private cleanSenseVoiceOutput(text: string): string {
    if (!text) return '';

    return text
      // 移除语言标签 <|zh|> <|en|> <|ja|> <|ko|> <|yue|>
      .replace(/<\|(zh|en|ja|ko|yue)\|>/g, '')
      // 移除情感标签 <|NEUTRAL|> <|HAPPY|> <|SAD|> <|ANGRY|>
      .replace(/<\|(NEUTRAL|HAPPY|SAD|ANGRY|FRIGHTENED)\|>/g, '')
      // 移除特殊事件标签 <| laughter |> <| applause |>
      .replace(/<\|[^>]+\|>/g, '')
      // 移除残余的 token 分隔标记
      .replace(/\|/g, '')
      // 合并多余空格
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// ===================== 在线流式识别引擎 =====================

/**
 * 流式识别引擎工厂
 * 创建 OnlineRecognizer 实例，用于实时流式解码
 *
 * @param config - 在线引擎配置
 * @returns OnlineRecognizer 实例（sherpa-onnx 原生对象）
 */
export async function createOnlineEngine(
  config: OnlineASRConfig = DEFAULT_ASR_CONFIG
): Promise<any> {
  await loadSherpaOnnx();

  const onlineConfig = {
    featConfig: {
      samplingRate: config.samplingRate,
      featureDim: config.featureDim,
    },
    modelConfig: {
      senseVoice: {
        model: config.encoderModel,
        tokens: config.tokens,
        numThreads: 2,
      },
    },
    decodingConfig: {
      method: config.decodingMethod,
      numActivePaths: config.maxActivePaths,
    },
    enableEndpoint: true,
    endpointConfig: {
      rule1MustContainSilence: true,
      rule1SilenceDurationS: 2.4,
      rule2MustContainSilence: true,
      rule2SilenceDurationS: 1.2,
      rule2MinTrailingSilence: 2.4,
    },
  };

  console.log('[ASR Engine] 在线流式引擎创建完成');
  return new sherpaOnnx.OnlineRecognizer(onlineConfig);
}
