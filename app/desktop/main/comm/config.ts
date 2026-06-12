/**
 * comm/ 模块 — 配置常量与合并工具
 *
 * 所有可调参数集中管理，外部通过 mergeConfig() 传入部分覆盖。
 */

import type { CommConfig } from './types';

/** 默认配置 */
export const DEFAULT_COMM_CONFIG: CommConfig = {
  signalingPort: 18520,
  dataPort: 18521,
  dataChunkSize: 64 * 1024,       // 64KB
  dataChannelTimeoutMs: 30000,     // 30s

  heartbeatIntervalMs: 30000,      // 30s
  heartbeatTimeoutMs: 10000,       // 10s

  maxReconnectAttempts: 3,
  reconnectIntervalMs: 5000,       // 5s

  encryptionAlgorithm: 'aes-256-gcm',
  encryptionKeyLength: 32,

  discoveryPort: 18522,
  discoveryIntervalMs: 5000,       // 5s

  pairingTokenExpiryMs: 300_000,   // 5 分钟
};

/** 合并用户配置与默认值 */
export function mergeConfig(overrides?: Partial<CommConfig>): CommConfig {
  return { ...DEFAULT_COMM_CONFIG, ...overrides };
}

/** 协议版本号，用于配对和发现包 */
export const PROTOCOL_VERSION = 1;

/** 音频编码常量（对应 IF-06 规范） */
export const AUDIO_SPEC = {
  SAMPLE_RATE: 16000,
  BITS_PER_SAMPLE: 16,
  CHANNELS: 1,
  BYTE_RATE: 32000, // 16k × 2B × 1ch
} as const;

/** 分片协议常量 */
export const CHUNK_PROTOCOL = {
  MAX_DATA_SIZE: 64 * 1024,       // 64KB 每分片
  HEADER_SIZE: 26,                 // 固定头部字节数（见 chunk.ts）
} as const;

/** 配对二维码常量 */
export const PAIRING_QR = {
  PROTOCOL_TYPE: 'ai-voice-assistant-pairing',
  VERSION: 1,
} as const;
