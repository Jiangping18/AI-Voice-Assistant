/**
 * transport/manager.ts — 传输管理器（桌面端）
 *
 * 整合 TCP 服务器 + 加密 + 分片发送/接收 的生命周期管理。
 *
 * 职责：
 *   1. 启动 TCP 数据服务器（桌面端监听 dataPort）
 *   2. 接受加密连接（配对完成后由信令层触发）
 *   3. 挂载 AudioSender / AudioReceiver
 *   4. 管理连接复用（同一对端复用同一 TCP 连接）
 *   5. 传输进度回调 → UI 进度条
 */

import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { AudioSender } from './sender';
import { AudioReceiver } from './receiver';
import { DEFAULT_COMM_CONFIG } from '../config';
import type { ConnectionState, TransferProgress } from '../types';

/** 传输管理器事件 */
export interface TransportManagerEvents {
  stateChange: (state: ConnectionState) => void;
  progress: (progress: TransferProgress) => void;
  audioComplete: (audioId: string, data: Buffer) => void;
  error: (error: Error) => void;
}

/** 传输连接上下文 */
interface TransportContext {
  socket: net.Socket;
  sender: AudioSender;
  receiver: AudioReceiver;
  peerId: string;
  encryptionKey: string;
}

/** 传输管理器 */
export class TransportManager extends EventEmitter {
  private server: net.Server | null = null;
  private contexts = new Map<string, TransportContext>();
  private state: ConnectionState = 'disconnected' as ConnectionState;

  constructor(
    private config = DEFAULT_COMM_CONFIG,
    private onEvent?: Partial<TransportManagerEvents>,
  ) {
    super();
    if (onEvent) {
      if (onEvent.progress) this.on('progress', onEvent.progress);
      if (onEvent.audioComplete) this.on('audioComplete', onEvent.audioComplete);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /** 启动 TCP 数据服务器 */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        // 新连接到来时，等待配对层调用 attachConnection 来绑定
        // 暂存 socket
        this._pendingSocket = socket;
      });

      this.server.on('error', (err) => {
        this.emit('error', err);
        this.onEvent?.error?.(err);
      });

      this.server.listen(this.config.dataPort, '0.0.0.0', () => {
        const addr = this.server!.address();
        const port = addr && typeof addr === 'object' ? addr.port : this.config.dataPort;
        this._setState('connecting' as ConnectionState);
        resolve(port);
      });
    });
  }

  private _pendingSocket: net.Socket | null = null;

  /**
   * 将配对完成的对端绑定到传输层
   * 在信令层配对成功后调用
   */
  attachPeer(peerId: string, encryptionKey: string, socket?: net.Socket): TransportContext {
    const s = socket || this._pendingSocket;
    if (!s) throw new Error('没有待绑定的 socket');

    this._pendingSocket = null;

    // 创建发送器和接收器
    const sender = new AudioSender({
      progress: (p) => {
        this.emit('progress', p);
        this.onEvent?.progress?.(p);
      },
      error: (e) => {
        this.emit('error', e);
        this.onEvent?.error?.(e);
      },
    });

    const receiver = new AudioReceiver({
      audioComplete: (audioId, data) => {
        this.emit('audioComplete', audioId, data);
        this.onEvent?.audioComplete?.(audioId, data);
      },
      error: (e) => {
        this.emit('error', e);
        this.onEvent?.error?.(e);
      },
    });

    // 绑定
    sender.attach(s, encryptionKey);
    receiver.setEncryptionKey(encryptionKey);
    receiver.attach(s);

    const ctx: TransportContext = { socket: s, sender, receiver, peerId, encryptionKey };

    // 如果有旧连接，先关闭
    const oldCtx = this.contexts.get(peerId);
    if (oldCtx) {
      try { oldCtx.socket.end(); } catch { /* ignore */ }
    }
    this.contexts.set(peerId, ctx);

    s.on('close', () => {
      this.contexts.delete(peerId);
      this._setState('disconnected' as ConnectionState);
    });

    this._setState('connected' as ConnectionState);
    return ctx;
  }

  /** 发送音频 Buffer */
  async sendAudio(data: Buffer, audioId: string, peerId: string): Promise<void> {
    const ctx = this.contexts.get(peerId);
    if (!ctx) throw new Error(`未找到对端连接: ${peerId}`);
    await ctx.sender.sendAudio(data, audioId);
  }

  /** 发送音频文件 */
  async sendAudioFile(filePath: string, audioId: string | undefined, peerId: string): Promise<void> {
    const ctx = this.contexts.get(peerId);
    if (!ctx) throw new Error(`未找到对端连接: ${peerId}`);
    await ctx.sender.sendAudioFile(filePath, audioId);
  }

  /** 获取指定对端的接收器（用于查询已接收分片） */
  getReceiver(peerId: string): AudioReceiver | undefined {
    return this.contexts.get(peerId)?.receiver;
  }

  /** 获取传输上下文 */
  getContext(peerId: string): TransportContext | undefined {
    return this.contexts.get(peerId);
  }

  /** 断开指定对端 */
  disconnectPeer(peerId: string): void {
    const ctx = this.contexts.get(peerId);
    if (ctx) {
      ctx.sender.detach();
      try { ctx.socket.end(); } catch { /* ignore */ }
      this.contexts.delete(peerId);
    }
  }

  /** 停止服务器 */
  async stop(): Promise<void> {
    // 断开所有连接
    for (const [peerId] of this.contexts) {
      this.disconnectPeer(peerId);
    }

    // 关闭服务器
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  /** 当前连接数 */
  get connectionCount(): number {
    return this.contexts.size;
  }

  private _setState(s: ConnectionState): void {
    this.state = s;
    this.emit('stateChange', s);
    this.onEvent?.stateChange?.(s);
  }
}
