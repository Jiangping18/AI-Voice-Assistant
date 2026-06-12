/**
 * ASR（自动语音识别）与服务模块类型定义
 *
 * 本文件定义了 ASR 识别结果的核心 JSON Schema、
 * 引擎配置接口、流式回调类型等。
 *
 * @module asr/types
 */

// ===================== 核心输出 JSON Schema =====================

/**
 * 单段识别结果（JSON Schema 的每个 item）
 *
 * @example
 * ```json
 * {
 *   "speaker": "speaker_0",
 *   "text": "今天天气真不错，我们出去走走好吗",
 *   "start": 0.0,
 *   "end": 2.5
 * }
 * ```
 */
export interface ASRSegment {
  /** 说话人标签，如 "speaker_0"、"speaker_1"，单说话人时为 "unknown" */
  speaker: string;
  /** 识别并清洗后的文本内容 */
  text: string;
  /** 该段音频的开始时间（秒） */
  start: number;
  /** 该段音频的结束时间（秒） */
  end: number;
}

/**
 * 完整音频文件的识别结果（顶层包装结构）
 *
 * 下游模块（语义分析、记忆存储等）统一使用此格式。
 *
 * @example
 * ```json
 * {
 *   "audio_id": "meeting_20260612_001",
 *   "duration": 125.3,
 *   "segments": [
 *     { "speaker": "speaker_0", "text": "今天开会讨论一下项目进度。", "start": 0.0, "end": 5.2 },
 *     { "speaker": "speaker_1", "text": "好的我先汇报一下。",         "start": 5.5, "end": 8.0 }
 *   ],
 *   "full_text": "speaker_0：今天开会讨论一下项目进度。speaker_1：好的我先汇报一下。"
 * }
 * ```
 */
export interface ASRResult {
  /** 唯一音频标识，由文件名/时间戳/UUID 生成 */
  audio_id: string;
  /** 音频总时长（秒） */
  duration: number;
  /** 识别结果片段列表 */
  segments: ASRSegment[];
  /** 完整对话文本（所有片段按时间顺序拼接，带说话人前缀） */
  full_text: string;
}

/**
 * 纯片段数组（内部使用，外部统一使用 ASRResult）
 */
export type ASRSegmentArray = ASRSegment[];

// ===================== 引擎配置 =====================

/**
 * Sherpa-ONNX 在线识别引擎配置
 */
export interface OnlineASRConfig {
  /** 编码器模型路径（如 SenseVoiceSmall INT8） */
  encoderModel: string;
  /** 解码器模型路径 */
  decoderModel: string;
  /** Joiner 模型路径 */
  joinerModel: string;
  /** tokens.txt 文件路径 */
  tokens: string;
  /** 模型类型： "sense_voice", "zipformer2", "paraformer" 等 */
  modelType: string;
  /** 是否启用 ITN（反向文本正则化） */
  enableITN: boolean;
  /** 采样率，默认 16000 */
  samplingRate: number;
  /** 特征维度，SenseVoice 默认 80 */
  featureDim: number;
  /** 解码方式： "greedy" | "modified_beam_search" */
  decodingMethod: string;
  /** 最大活跃帧数 */
  maxActivePaths: number;
  /** 端点检测静音阈值（秒） */
  endpointSilenceThresholdMs: number;
}

/**
 * 端点检测配置
 */
export interface EndpointConfig {
  /** 必填：静音检测规则，超过此时间（秒）无语音则结束一段 */
  rule1MustContainSilence: boolean;
  /** 规则1 的静音时长（秒） */
  rule1SilenceDurationS: number;
  /** 规则2：尾音规则，超过此时间（秒）无语音则结束 */
  rule2MustContainSilence: boolean;
  /** 规则2 的静音时长（秒） */
  rule2SilenceDurationS: number;
  /** 规则2 的最小识别文本长度 */
  rule2MinTrailingSilence: number;
}

/**
 * 说话人分离引擎配置
 */
export interface DiarizationConfig {
  /** 模型类型： "sherpa-onnx" | "pyannote" */
  engine: 'sherpa-onnx' | 'pyannote';
  /** Sherpa-ONNX 说话人嵌入模型路径 */
  embeddingModel: string;
  /** 聚类最小说话人数（默认 1） */
  minSpeakers: number;
  /** 聚类最大说话人数（默认 5） */
  maxSpeakers: number;
  /** 聚类阈值（余弦相似度，0~1） */
  clusteringThreshold: number;
}

// ===================== 流式回调 =====================

/**
 * 流式识别过程中的回调事件
 */
export interface StreamCallbacks {
  /** 部分识别结果（中间结果） */
  onPartialResult?: (text: string, start: number, end: number) => void;
  /** 最终确定的一段识别结果 */
  onFinalResult?: (segment: ASRSegment) => void;
  /** 说话人变更事件 */
  onSpeakerChange?: (newSpeaker: string, timestamp: number) => void;
  /** 错误事件 */
  onError?: (error: Error) => void;
  /** 状态变更 */
  onStateChange?: (state: StreamState) => void;
}

/** 流式解码器状态 */
export enum StreamState {
  IDLE = 'idle',
  LISTENING = 'listening',
  DECODING = 'decoding',
  ENDPOINT = 'endpoint',
  FINISHED = 'finished',
  ERROR = 'error',
}

// ===================== 完整流水线配置 =====================

/**
 * 完整 ASR Pipeline 配置
 */
export interface PipelineConfig {
  /** ASR 在线引擎配置 */
  asr: OnlineASRConfig;
  /** 端点检测配置 */
  endpoint: EndpointConfig;
  /** 说话人分离配置 */
  diarization: DiarizationConfig;
  /** 文本清洗配置 */
  textCleaning: TextCleaningConfig;
  /** 音频输入参数 */
  audio: AudioInputConfig;
}

/**
 * 音频输入配置
 */
export interface AudioInputConfig {
  /** 目标采样率，模型所需，默认 16000 */
  targetSampleRate: number;
  /** 声道数（模型通常需要单声道） */
  channels: number;
  /** 音频格式： "wav" | "pcm" | "mp3" | "auto" */
  format: 'wav' | 'pcm' | 'mp3' | 'auto';
  /** 是否自动转码 */
  autoConvert: boolean;
}

// ===================== 文本清洗配置 =====================

/**
 * 文本清洗配置
 */
export interface TextCleaningConfig {
  /** 是否启用标点补全 */
  enablePunctuation: boolean;
  /** 是否启用语气词过滤 */
  enableFillerFilter: boolean;
  /** 是否启用数字格式化 */
  enableNumberFormat: boolean;
  /** 自定义语气词列表（覆盖默认列表） */
  customFillers?: string[];
  /** 标点补全模型路径（如用模型补全时） */
  punctuationModelPath?: string;
}

// ===================== 文本清洗配置 =====================

/**
 * 文本清洗规则集合
 */
export interface CleaningRules {
  /** 需要过滤的语气词正则列表 */
  fillerPatterns: RegExp[];
  /** 数字格式映射（中文数字转阿拉伯数字等） */
  numberMappings: Map<string, string>;
  /** 标点补全规则 */
  punctuationRules: PunctuationRule[];
}

/** 标点补全规则 */
export interface PunctuationRule {
  /** 匹配模式（正则） */
  pattern: RegExp;
  /** 替换文本 */
  replacement: string;
  /** 规则描述 */
  description: string;
}
