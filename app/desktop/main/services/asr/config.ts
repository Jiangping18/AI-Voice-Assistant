/**
 * ASR 服务配置文件
 *
 * 提供默认配置常量，所有配置可通过构造函数或环境变量覆盖。
 * 模型文件统一放在项目根目录 models/ 下。
 *
 * @module asr/config
 */

import type {
  OnlineASRConfig,
  EndpointConfig,
  DiarizationConfig,
  TextCleaningConfig,
  AudioInputConfig,
  PipelineConfig,
} from './types';

/**
 * 获取项目根路径（从当前文件位置向上回溯）
 * 在 Electron 主进程中，process.cwd() 通常指向项目根目录
 *
 * TODO: 打包后需根据 app.getAppPath() 调整
 */
export function getProjectRoot(): string {
  // 开发环境：从 main/services/asr/ 回退到项目根
  // 生产环境：打包后改用 process.resourcesPath
  return process.env.PROJECT_ROOT || process.cwd();
}

/**
 * 模型文件存放根目录
 */
export function getModelRoot(): string {
  return process.env.MODEL_ROOT || `${getProjectRoot()}/models`;
}

// ===================== 模型路径模板 =====================

/**
 * SenseVoiceSmall INT8 量化模型文件路径
 * （用户需要手动下载或使用 download-models.sh 脚本）
 *
 * 模型来源：https://github.com/k2-fsa/sherpa-onnx/releases
 * 推荐模型：sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
 */
export const SENSE_VOICE_MODEL = {
  encoder: `${getModelRoot()}/sense-voice-int8/sense-voice-encoder.int8.onnx`,
  decoder: `${getModelRoot()}/sense-voice-int8/sense-voice-decoder.onnx`,
  joiner: `${getModelRoot()}/sense-voice-int8/sense-voice-joiner.onnx`,
  tokens: `${getModelRoot()}/sense-voice-int8/tokens.txt`,
} as const;

/**
 * 说话人嵌入模型路径
 * 推荐：3dspeaker_speech_campplus_sv_zh-cn_16k-common
 */
export const SPEAKER_EMBEDDING_MODEL = `${getModelRoot()}/speaker-embedding/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx`;

// ===================== 默认配置 =====================

/**
 * 默认 ASR 在线识别配置
 */
export const DEFAULT_ASR_CONFIG: OnlineASRConfig = {
  encoderModel: SENSE_VOICE_MODEL.encoder,
  decoderModel: SENSE_VOICE_MODEL.decoder,
  joinerModel: SENSE_VOICE_MODEL.joiner,
  tokens: SENSE_VOICE_MODEL.tokens,
  modelType: 'sense_voice',
  enableITN: true,
  samplingRate: 16000,
  featureDim: 80,
  decodingMethod: 'greedy',
  maxActivePaths: 4,
  endpointSilenceThresholdMs: 1500,
};

/**
 * 默认端点检测配置
 */
export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = {
  rule1MustContainSilence: true,
  rule1SilenceDurationS: 2.4,
  rule2MustContainSilence: true,
  rule2SilenceDurationS: 1.2,
  rule2MinTrailingSilence: 2.4,
};

/**
 * 默认说话人分离配置
 */
export const DEFAULT_DIARIZATION_CONFIG: DiarizationConfig = {
  engine: 'sherpa-onnx',
  embeddingModel: SPEAKER_EMBEDDING_MODEL,
  minSpeakers: 1,
  maxSpeakers: 5,
  clusteringThreshold: 0.55,
};

/**
 * 默认文本清洗配置
 */
export const DEFAULT_TEXT_CLEANING_CONFIG: TextCleaningConfig = {
  enablePunctuation: true,
  enableFillerFilter: true,
  enableNumberFormat: true,
};

/**
 * 默认音频输入配置
 */
export const DEFAULT_AUDIO_INPUT_CONFIG: AudioInputConfig = {
  targetSampleRate: 16000,
  channels: 1,
  format: 'auto',
  autoConvert: true,
};

/**
 * 默认完整 Pipeline 配置
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  asr: DEFAULT_ASR_CONFIG,
  endpoint: DEFAULT_ENDPOINT_CONFIG,
  diarization: DEFAULT_DIARIZATION_CONFIG,
  textCleaning: DEFAULT_TEXT_CLEANING_CONFIG,
  audio: DEFAULT_AUDIO_INPUT_CONFIG,
};
