/**
 * comm/ 模块 — 公共类型定义
 *
 * 定义局域网 P2P 通信涉及的所有枚举、接口与数据结构。
 * 智能体2 与 智能体1（移动端）/ 智能体3（ASR）之间的数据交换格式。
 *
 * @module comm/types
 */

// ===================== 基础枚举 =====================

/** 设备角色 */
export enum DeviceRole {
  DESKTOP = 'desktop',
  MOBILE = 'mobile',
}

/** 连接状态 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
}

/** 分片传输状态 */
export enum ChunkTransferState {
  PENDING = 'pending',
  TRANSFERRING = 'transferring',
  VERIFYING = 'verifying',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// ===================== 配对与发现 =====================

/** 对端设备信息 */
export interface PeerInfo {
  deviceId: string;
  deviceName: string;
  deviceRole: DeviceRole;
  ipAddress: string;
  signalingPort: number;
  dataPort: number;
}

/** 配对 Token */
export interface PairingToken {
  token: string;
  createdAt: number;       // Unix 毫秒时间戳
  expiresAt: number;       // 过期时间戳
  used: boolean;
}

/** 配对二维码内容（展示为 JSON 字符串） */
export interface PairingQRContent {
  type: 'ai-voice-assistant-pairing';
  version: 1;
  deviceId: string;
  deviceName: string;
  ip: string;
  signalingPort: number;
  dataPort: number;
  token: string;
  expiresAt: number;
}

/** mDNS 发现公告数据包 */
export interface DiscoveryPacket {
  deviceId: string;
  deviceName: string;
  deviceRole: DeviceRole;
  ip: string;
  signalingPort: number;
  dataPort: number;
  protocolVersion: number;
}

// ===================== 音频分片传输 =====================

/** 音频分片（线路传输格式） */
export interface AudioChunk {
  chunkId: number;         // 分片序号，从 0 开始单调递增
  audioId: string;         // 所属音频文件 UUID
  offset: number;          // 该分片在原始文件中的字节偏移
  data: Buffer;            // 分片负载（最大 64KB）
  timestamp: number;       // 发送端 Unix 毫秒时间戳
  crc32: number;           // CRC32 校验值（仅对 data 字段计算）
  isRetransmission: boolean; // 是否为断点续传重发
}

/** 传输进度回调 */
export interface TransferProgress {
  audioId: string;
  totalBytes: number;
  transferredBytes: number;
  totalChunks: number;
  completedChunks: number;
  percent: number;         // 0–100
  state: ChunkTransferState;
  speedBps: number;        // bytes/sec
}

/** 断点续传请求 */
export interface ResumeRequest {
  audioId: string;
  receivedChunkIds: number[];
}

/** 断点续传响应 */
export interface ResumeResponse {
  audioId: string;
  missingChunkIds: number[];
}

// ===================== 控制消息 =====================

/** 控制消息类型 */
export enum ControlMessageType {
  // 控制指令（PC → 手机）
  START_RECORDING = 'start_recording',
  STOP_RECORDING = 'stop_recording',
  START_TRANSCRIBE = 'start_transcribe',
  // 状态同步（双向）
  STATE_UPDATE = 'state_update',
  // 音频生命周期（手机 → PC）
  AUDIO_META = 'audio_meta',
  AUDIO_START = 'audio_start',
  AUDIO_CHUNK = 'audio_chunk',
  AUDIO_COMPLETE = 'audio_complete',
  // 配对流程
  PAIRING_REQUEST = 'pairing_request',
  PAIRING_RESPONSE = 'pairing_response',
  // 系统
  ERROR = 'error',
}

/** 控制消息通用容器 */
export interface ControlMessage {
  type: ControlMessageType;
  messageId: string;       // UUID，用于去重 / ACK
  timestamp: number;       // Unix 毫秒
  payload: Record<string, unknown>;
}

/** 音频元信息（IF-03 接口规范） */
export interface AudioMetaPayload {
  audio_id: string;        // UUID
  duration: number;        // 秒
  timestamp: string;       // ISO8601
  sampleRate: number;      // 默认 16000
  bitsPerSample: number;   // 默认 16
  channels: number;        // 默认 1
}

/** 状态更新载荷（IF-01 接口规范） */
export interface StateUpdatePayload {
  type: 'status' | 'error';
  state: 'idle' | 'listening' | 'recording' | 'error' | 'transcribing' | 'completed';
  detail?: string;
}

// ===================== 心跳 =====================

/** 心跳包 */
export interface HeartbeatPacket {
  type: 'ping' | 'pong';
  timestamp: number;
  sequenceId: number;
}

// ===================== 配置 =====================

/** 通信模块完整配置 */
export interface CommConfig {
  signalingPort: number;
  dataPort: number;
  dataChunkSize: number;       // 字节，默认 65536 (64KB)
  dataChannelTimeoutMs: number;

  heartbeatIntervalMs: number; // 默认 30000
  heartbeatTimeoutMs: number;  // 默认 10000

  maxReconnectAttempts: number; // 默认 3
  reconnectIntervalMs: number;  // 默认 5000

  encryptionAlgorithm: string;
  encryptionKeyLength: number;

  discoveryPort: number;
  discoveryIntervalMs: number;

  pairingTokenExpiryMs: number; // 默认 300000 (5 分钟)
}

// ===================== 事件回调接口 =====================

/** 通信模块事件回调 */
export interface CommCallbacks {
  onConnectionStateChange?: (state: ConnectionState, peer?: PeerInfo) => void;
  onTransferProgress?: (progress: TransferProgress) => void;
  onAudioComplete?: (audioId: string, data: Buffer) => void;
  onControlMessage?: (msg: ControlMessage) => void;
  onError?: (error: Error) => void;
  onPeerDiscovered?: (peer: PeerInfo) => void;
}
