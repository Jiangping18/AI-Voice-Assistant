/**
 * 说话人分离引擎
 *
 * 提供两种引擎实现:
 * 1. sherpa-onnx: 基于 SpeakerEmbeddingExtractor + 余弦相似度聚类
 * 2. pyannote: 通过 Python 子进程调用 pyannote-audio pipeline（备选）
 *
 * @module diarization/engine
 */

import type { DiarizationConfig, DiarizationResult, DiarizationSegment } from './types';
import { DEFAULT_DIARIZATION_CONFIG } from '../asr/config';

// ===================== Sherpa-ONNX 引擎 =====================

/**
 * Sherpa-ONNX 说话人分离引擎
 *
 * 使用 3D-Speaker (CAM++) 说话人嵌入模型提取声纹特征，
 * 然后通过余弦相似度聚类实现说话人分离。
 *
 * 模型来源：
 * https://github.com/k2-fsa/sherpa-onnx/releases
 * 推荐：3dspeaker_speech_campplus_sv_zh-cn_16k-common
 */
export class SherpaOnnxDiarizationEngine {
  private extractor: any = null;
  private config: DiarizationConfig;
  private initialized = false;

  constructor(config: DiarizationConfig) {
    this.config = config;
  }

  /**
   * 初始化引擎，加载嵌入模型
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    let sherpaOnnx: any;
    try {
      sherpaOnnx = require('sherpa-onnx');
    } catch {
      throw new Error('无法加载 sherpa-onnx，请执行: npm install sherpa-onnx');
    }

    try {
      this.extractor = new sherpaOnnx.SpeakerEmbeddingExtractor({
        model: this.config.embeddingModel,
        numThreads: 2,
      });
      this.initialized = true;
      console.log('[Diarization] Sherpa-ONNX 嵌入提取器初始化完成');
    } catch (err) {
      throw new Error(
        `说话人嵌入模型加载失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 对完整音频进行说话人分离
   *
   * @param samples - 16kHz 单声道 PCM float32 数据
   * @param sampleRate - 采样率（默认 16000）
   * @param segmentDuration - 分段时长（秒），默认 1.5s 一窗
   * @returns 说话人分离结果
   */
  async diarize(
    samples: Float32Array,
    sampleRate: number = 16000,
    segmentDuration: number = 1.5
  ): Promise<DiarizationResult> {
    if (!this.initialized) {
      throw new Error('引擎未初始化，请先调用 init()');
    }

    const windowSize = Math.floor(segmentDuration * sampleRate);
    const stepSize = Math.floor(windowSize / 2); // 50% 重叠滑窗
    const embeddings: Array<{ embedding: Float32Array; start: number; end: number }> = [];

    // 1. 滑窗提取嵌入向量
    for (let offset = 0; offset < samples.length - windowSize; offset += stepSize) {
      const windowSamples = samples.slice(offset, offset + windowSize);
      const stream = this.extractor.createStream();
      stream.acceptWaveform({ samples: windowSamples, sampleRate });
      const embedding = this.extractor.extract(stream);
      stream.free();

      if (embedding && embedding.dim > 0) {
        embeddings.push({
          embedding: new Float32Array(embedding.data || embedding),
          start: offset / sampleRate,
          end: (offset + windowSize) / sampleRate,
        });
      }
    }

    if (embeddings.length === 0) {
      console.warn('[Diarization] 未提取到有效的说话人嵌入');
      return [{ speaker: 'unknown', start: 0, end: samples.length / sampleRate }];
    }

    // 2. 基于余弦相似度的层次聚类
    const clusters = this.clusterEmbeddings(
      embeddings.map((e) => e.embedding),
      this.config.clusteringThreshold
    );

    // 3. 将聚类结果映射回时间轴
    const result: DiarizationResult = [];
    for (let i = 0; i < clusters.length; i++) {
      const clusterIdx = clusters[i];
      if (clusterIdx < 0) continue; // 噪音点，忽略

      const speakerLabel = `speaker_${clusterIdx % this.config.maxSpeakers}`;
      const emb = embeddings[i];
      result.push({
        speaker: speakerLabel,
        start: emb.start,
        end: emb.end,
      });
    }

    // 4. 合并相邻的相同说话人段
    const merged = this.mergeAdjacentSegments(result);

    console.log(`[Diarization] 检测到 ${new Set(merged.map((s) => s.speaker)).size} 个说话人`);
    return merged;
  }

  /**
   * 释放引擎资源
   */
  release(): void {
    if (this.extractor) {
      try {
        this.extractor.release();
      } catch {
        // ignore
      }
      this.initialized = false;
    }
  }

  // ===================== 聚类算法 =====================

  /**
   * 基于余弦相似度的贪心聚类
   *
   * @param embeddings - 嵌入向量数组
   * @param threshold - 相似度阈值（0~1），大于此值判定为同一人
   * @returns 聚类标签数组，-1 表示噪音
   */
  private clusterEmbeddings(
    embeddings: Float32Array[],
    threshold: number
  ): number[] {
    if (embeddings.length === 0) return [];

    const labels: number[] = new Array(embeddings.length).fill(-1);
    let clusterCount = 0;

    // 第一个向量作为第0类
    labels[0] = 0;
    clusterCount = 1;

    for (let i = 1; i < embeddings.length; i++) {
      let bestCluster = -1;
      let bestSimilarity = threshold;

      // 与已有聚类的中心比较
      for (let c = 0; c < clusterCount; c++) {
        // 找到属于该类所有向量的平均
        const clusterMembers = embeddings.filter((_, idx) => labels[idx] === c);
        if (clusterMembers.length === 0) continue;

        // 计算与聚类平均向量的相似度
        const avgEmbedding = this.averageEmbeddings(clusterMembers);
        const sim = this.cosineSimilarity(embeddings[i], avgEmbedding);

        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestCluster = c;
        }
      }

      if (bestCluster >= 0) {
        labels[i] = bestCluster;
      } else if (clusterCount < this.config.maxSpeakers) {
        // 新建聚类
        labels[i] = clusterCount;
        clusterCount++;
      } else {
        // 超过最大说话人数，归于最近的一类
        labels[i] = clusterCount - 1;
      }
    }

    return labels;
  }

  /**
   * 计算两个嵌入向量的余弦相似度
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  /**
   * 计算嵌入向量的平均值
   */
  private averageEmbeddings(embeddings: Float32Array[]): Float32Array {
    const dim = embeddings[0].length;
    const avg = new Float32Array(dim);

    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }

    return avg;
  }

  /**
   * 合并时间上连续的相同说话人段
   * 减少输出中的碎片化分段
   */
  private mergeAdjacentSegments(segments: DiarizationSegment[]): DiarizationSegment[] {
    if (segments.length <= 1) return segments;

    const merged: DiarizationSegment[] = [];
    let current = { ...segments[0] };

    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.speaker === current.speaker) {
        // 合并：扩展结束时间
        current.end = seg.end;
      } else {
        merged.push(current);
        current = { ...seg };
      }
    }
    merged.push(current);

    return merged;
  }
}

// ===================== PyAnnote 引擎（备选） =====================

/**
 * PyAnnote 音频说话人分离引擎
 *
 * 通过 Python 子进程调用 pyannote-audio 的 pipeline。
 * 需要预先安装：
 *   pip install pyannote.audio torch torchaudio
 *
 * 使用场景：当 Sherpa-ONNX 聚类效果不满足时，作为备选方案
 */
export class PyannoteDiarizationEngine {
  private config: DiarizationConfig;

  constructor(config: DiarizationConfig) {
    this.config = config;
  }

  /**
   * 执行说话人分离
   *
   * @param audioFilePath - 音频文件路径（pyannote 支持 wav/mp3 等）
   * @returns 说话人分离结果
   */
  async diarize(audioFilePath: string): Promise<DiarizationResult> {
    const { execSync } = require('child_process');
    const path = require('path');

    // 构造 Python 脚本
    const script = `
import sys
import json
from pyannote.audio import Pipeline

pipeline = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token=None
)

diarization = pipeline("${audioFilePath.replace(/\\/g, '\\\\')}",
    min_speakers=${this.config.minSpeakers},
    max_speakers=${this.config.maxSpeakers}
)

result = []
for turn, _, speaker in diarization.itertracks(yield_label=True):
    result.append({
        "speaker": speaker,
        "start": round(turn.start, 2),
        "end": round(turn.end, 2)
    })

print(json.dumps(result, ensure_ascii=False))
`;

    const tmpScriptPath = path.join(
      process.env.TEMP || '/tmp',
      `diarize_${Date.now()}.py`
    );
    const fs = require('fs');
    fs.writeFileSync(tmpScriptPath, script, 'utf-8');

    try {
      const rawOutput = execSync(`python "${tmpScriptPath}"`, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300000, // 5 min timeout for pyannote
      });

      const result: DiarizationResult = JSON.parse(rawOutput.toString().trim());
      return result;
    } catch (err) {
      throw new Error(
        `PyAnnote 说话人分离失败: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // 清理临时脚本
      try {
        fs.unlinkSync(tmpScriptPath);
      } catch {
        // ignore
      }
    }
  }
}

// ===================== 工厂函数 =====================

/**
 * 创建说话人分离引擎工厂
 *
 * @param config - 说话人分离配置
 * @returns 引擎实例
 */
export function createDiarizationEngine(
  config: DiarizationConfig = DEFAULT_DIARIZATION_CONFIG
): SherpaOnnxDiarizationEngine | PyannoteDiarizationEngine {
  if (config.engine === 'pyannote') {
    return new PyannoteDiarizationEngine(config);
  }
  return new SherpaOnnxDiarizationEngine(config);
}
