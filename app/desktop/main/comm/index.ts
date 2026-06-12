/**
 * comm/ — 局域网 P2P 通信模块入口
 *
 * 整合所有子模块，对外暴露统一的 `CommEngine` 类。
 *
 * ## 使用方式
 *
 * ```ts
 * import { CommEngine } from './comm';
 *
 * const engine = new CommEngine({
 *   onConnectionStateChange: (state, peer) => { /* 更新 UI *\/ },
 *   onTransferProgress: (progress) => { /* 更新进度条 *\/ },
 * });
 *
 * await engine.start();
 *
 * // 生成配对二维码
 * const qrJson = engine.getQRContent();
 *
 * // 发送音频
 * const audioFile = fs.readFileSync('/path/to/audio.pcm');
 * await engine.sendAudio(audioFile, 'audio-uuid-xxx');
 * ```
 *
 * @module comm
 */

export * from './types';
export { DEFAULT_COMM_CONFIG, mergeConfig } from './config';
export type { CommConfig } from './types';

// 信令
export { SignalingServer } from './signaling/server';
export { SignalingClient } from './signaling/client';
export { createPairingToken, generateQRContent, parseQRContent } from './signaling/pairing';

// 传输
export { AudioSender } from './transport/sender';
export { AudioReceiver } from './transport/receiver';
export { TransportManager } from './transport/manager';
export { splitBuffer, reassemble, serializeChunk, deserializeChunk, crc32 } from './transport/chunk';

// 控制
export { ControlChannel } from './control/channel';
export { Heartbeat } from './control/heartbeat';

// 发现
export { DiscoveryService } from './discovery/service';

// 加密
export { generateEncryptionKey, encrypt, decrypt, encryptPacket, decryptPacket } from './crypto/utils';

// 存储
export { saveCredential, loadCredential, removeCredential, getAllCredentials } from './storage/credential';

import { SignalingServer } from './signaling/server';
import { TransportManager } from './transport/manager';
import { ControlChannel } from './control/channel';
import { Heartbeat } from './control/heartbeat';
import { DiscoveryService } from './discovery/service';
import { saveCredential, loadCredential, updateLastConnected } from './storage/credential';
import { mergeConfig, DEFAULT_COMM_CONFIG } from './config';
import type { PeerInfo, ConnectionState, TransferProgress, ControlMessage, CommConfig, CommCallbacks } from './types';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';

/**
 * CommEngine — 通信引擎（对外的唯一入口）
 *
 * 整合信令、传输、控制、心跳、发现、存储六个子系统。
 * 应用层只需创建 CommEngine 实例、启动、发送数据、监听事件。
 */
export class CommEngine extends EventEmitter {
  /** 本机局域网 IP */
  private localIp = '';
  /** 当前配置 */
  private config: CommConfig;
  /** 是否已启动 */
  private _started = false;

  /** 信令服务器 */
  public signaling: SignalingServer;
  /** 传输管理器 */
  public transport: TransportManager;
  /** 控制指令通道 */
  public control: ControlChannel;
  /** 心跳检测 */
  public heartbeat: Heartbeat;
  /** 局域网发现 */
  public discovery: DiscoveryService;

  constructor(callbacks?: CommCallbacks) {
    super();
    this.config = callbacks ? mergeConfig() : DEFAULT_COMM_CONFIG;
    // 不传 callbacks 就复制一份默认
    const cb = callbacks || {};

    // 获取本机局域网 IP
    this.localIp = this._getLocalIP();

    // 初始化解耦实例（先创建空对象，再互相链接）
    this.heartbeat = new Heartbeat();
    this.signaling = new SignalingServer(
      this.config.signalingPort,
      this.localIp,
      this.config.dataPort,
    );
    this.transport = new TransportManager(this.config);
    this.control = new ControlChannel(this.signaling);
    this.discovery = new DiscoveryService(
      this.config.discoveryPort,
      this.config.signalingPort,
      this.config.dataPort,
    );

    // 连接心跳与信令
    this.heartbeat.setSendPing(() => this.signaling.broadcast(JSON.stringify({ type: 'ping', timestamp: Date.now() })));
    this.heartbeat.setReconnectFn(async () => {
      // 重连逻辑：重启信令服务器（简化版，实际重连由信令层处理）
      await this.signaling.stop();
      await this.signaling.start();
    });

    // 转发事件
    if (cb.onConnectionStateChange) this.on('stateChange', cb.onConnectionStateChange);
    if (cb.onTransferProgress) this.on('progress', cb.onTransferProgress);
    if (cb.onAudioComplete) this.on('audioComplete', cb.onAudioComplete);
    if (cb.onControlMessage) this.on('controlMessage', cb.onControlMessage);
    if (cb.onError) this.on('error', cb.onError);
    if (cb.onPeerDiscovered) this.on('peerDiscovered', cb.onPeerDiscovered);

    // 信令事件 → 传输层绑定
    this.signaling.on('peerPaired', (peer: PeerInfo, sharedKey: string) => {
      // 保存凭证
      saveCredential(peer, sharedKey);
      // 启动心跳
      this.heartbeat.start();
      this.emit('stateChange', 'connected' as ConnectionState, peer);
    });

    this.signaling.on('controlMessage', (peerId: string, raw: string) => {
      this.control.handleMessage(raw);
    });

    // 发现事件
    this.discovery.on('peerDiscovered', (peer: PeerInfo) => {
      this.emit('peerDiscovered', peer);
    });

    // 心跳事件
    this.heartbeat.on('stateChange', (state: ConnectionState) => {
      this.emit('stateChange', state);
    });
    this.heartbeat.on('reconnected', () => {
      this.heartbeat.resetAttempts();
    });

    // 传输事件
    this.transport.on('progress', (p: TransferProgress) => this.emit('progress', p));
    this.transport.on('audioComplete', (audioId: string, data: Buffer) => this.emit('audioComplete', audioId, data));
    this.transport.on('error', (err: Error) => this.emit('error', err));
  }

  /**
   * 启动所有服务
   *
   * 启动顺序：
   *   1. 发现服务（UDP 多播）
   *   2. 信令服务器（HTTP + WebSocket）
   *   3. 传输服务器（TCP 数据通道）
   */
  async start(): Promise<void> {
    if (this._started) return;

    const deviceId = this.signaling.deviceInfo.deviceId;
    const deviceName = this.signaling.deviceInfo.deviceName;

    // 并行启动所有服务
    await Promise.all([
      this.signaling.start(),
      this.transport.start(),
      this.discovery.start(deviceId, deviceName, this.localIp),
    ]);

    this._started = true;
    this.emit('stateChange', 'connecting' as ConnectionState);
  }

  /** 停止所有服务 */
  async stop(): Promise<void> {
    if (!this._started) return;

    this.heartbeat.stop();
    await this.transport.stop();
    await this.signaling.stop();
    this.discovery.stop();

    this._started = false;
    this.emit('stateChange', 'disconnected' as ConnectionState);
  }

  // ---- 便捷 API ----

  /** 获取配对二维码 JSON 内容（UI 层渲染为二维码供手机扫描） */
  getQRContent(): string {
    return this.signaling.currentQRContent;
  }

  /** 已连接对端数量 */
  get peerCount(): number {
    return this.signaling.connectionCount;
  }

  /** 获取发现的局域网设备 */
  getDiscoveredPeers(): PeerInfo[] {
    return this.discovery.getDiscoveredPeers();
  }

  /** 服务是否已启动 */
  get started(): boolean {
    return this._started;
  }

  /** 发送音频数据给指定对端 */
  async sendAudio(data: Buffer, audioId: string, peerId: string): Promise<void> {
    await this.transport.sendAudio(data, audioId, peerId);
  }

  /** 发送音频文件 */
  async sendAudioFile(filePath: string, peerId: string, audioId?: string): Promise<void> {
    await this.transport.sendAudioFile(filePath, audioId, peerId);
  }

  /** 发送控制指令 */
  sendControl(peerId: string, type: string, payload: Record<string, unknown>): boolean {
    return this.control.sendTo(peerId, type as any, payload);
  }

  /**
   * 尝试从已保存的凭证自动连接所有已知对端
   * 返回尝试连接的对端数量
   */
  autoConnectFromSaved(): number {
    const { getAllCredentials } = require('./storage/credential');
    const credentials = getAllCredentials();
    for (const cred of credentials) {
      const peerData = loadCredential(cred.peerId);
      if (peerData) {
        updateLastConnected(cred.peerId);
        // 实际重连操作由上层 UI 触发（需要知道目标 IP）
      }
    }
    return credentials.length;
  }

  /** 获取本机局域网 IP */
  private _getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const info of iface) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
    return '127.0.0.1';
  }
}
