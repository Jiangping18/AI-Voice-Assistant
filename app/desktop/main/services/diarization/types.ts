/**
 * 说话人分离模块类型定义
 *
 * @module diarization/types
 */

/**
 * 说话人分离结果片段
 */
export interface DiarizationSegment {
  /** 说话人标签 */
  speaker: string;
  /** 开始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
}

/**
 * 完整说话人分离结果
 */
export type DiarizationResult = DiarizationSegment[];

/**
 * 说话人嵌入向量
 */
export interface SpeakerEmbedding {
  /** 说话人标签 */
  speaker: string;
  /** 嵌入向量（float32 数组） */
  embedding: Float32Array;
  /** 该说话人的音频段列表 */
  segments: Array<{ start: number; end: number }>;
}

/**
 * 说话人嵌入提取结果
 */
export interface EmbeddingResult {
  /** 时间戳（秒） */
  timestamp: number;
  /** 嵌入向量 */
  embedding: Float32Array;
}

/**
 * 聚类配置
 */
export interface ClusteringConfig {
  /** 最小说话人数 */
  minSpeakers: number;
  /** 最大说话人数 */
  maxSpeakers: number;
  /** 聚类阈值（余弦相似度） */
  threshold: number;
}
