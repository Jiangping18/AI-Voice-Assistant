/**
 * control/heartbeat.ts — 心跳探活 + 断线自动重连
 *
 * 职责：
 *   1. 每隔 30 秒向对端发送 Ping
 *   2. 对端回复 Pong 确认存活
 *   3. 超时（10 秒未收到 Pong）视为断线
 *   4. 断线后自动重连（最多 3 次，间隔 5 秒）
 *   5. 重连失败或达到上限后触发 FAILED 状态
 *
 * 集成方式：
 *   信令服务器收到 ping → 回复 pong（由 ws.ts 自动处理）
 *   本模块负责从客户端侧发送 Ping 并检测超时。
 */

import { EventEmitter } from 'node:events';
import { DEFAULT_COMM_CONFIG } from '../config';
import type { ConnectionState } from '../types';

export interface HeartbeatEvents {
  stateChange: (state: ConnectionState) => void;
  pingTimeout: () => void;
  reconnected: () => void;
  reconnectFailed: () => void;
  error: (error: Error) => void;
}

/** 心跳检测器 */
export class Heartbeat extends EventEmitter {
  private config = DEFAULT_COMM_CONFIG;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private state: ConnectionState = 'disconnected' as ConnectionState;

  /** 当前重连次数 */
  private reconnectAttempts = 0;
  /** 是否已主动停止 */
  private stopped = true;

  /** 发送 Ping 的函数（由外部注入） */
  private sendPingFn: (() => void) | null = null;
  /** 重连函数（由外部注入） */
  private reconnectFn: (() => Promise<void>) | null = null;

  constructor(
    private onEvent?: Partial<HeartbeatEvents>,
  ) {
    super();
    if (onEvent) {
      if (onEvent.stateChange) this.on('stateChange', onEvent.stateChange);
      if (onEvent.pingTimeout) this.on('pingTimeout', onEvent.pingTimeout);
      if (onEvent.reconnected) this.on('reconnected', onEvent.reconnected);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /** 配置发送 Ping 的函数 */
  setSendPing(fn: () => void): void {
    this.sendPingFn = fn;
  }

  /** 配置重连函数 */
  setReconnectFn(fn: () => Promise<void>): void {
    this.reconnectFn = fn;
  }

  /** 启动心跳 */
  start(): void {
    this.stopped = false;
    this.reconnectAttempts = 0;
    this._setState('connected' as ConnectionState);

    this.pingTimer = setInterval(() => {
      this._sendPing();
    }, this.config.heartbeatIntervalMs);
  }

  /** 收到 Pong 时调用 */
  pongReceived(): void {
    // 清除超时计时器
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** 发送 Ping */
  private _sendPing(): void {
    if (this.stopped) return;
    this.seq++;

    try {
      this.sendPingFn?.();
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.onEvent?.error?.(err instanceof Error ? err : new Error(String(err)));
    }

    // 设置超时检测
    this.timeoutTimer = setTimeout(() => {
      this._onPingTimeout();
    }, this.config.heartbeatTimeoutMs);
  }

  /** Ping 超时处理 */
  private _onPingTimeout(): void {
    this.emit('pingTimeout');
    this.onEvent?.pingTimeout?.();

    if (this.stopped) return;
    this._tryReconnect();
  }

  /** 尝试重连 */
  private _tryReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this._setState('failed' as ConnectionState);
      this.emit('reconnectFailed');
      this.onEvent?.reconnectFailed?.();
      this.stop();
      return;
    }

    this.reconnectAttempts++;
    this._setState('reconnecting' as ConnectionState);

    this.reconnectTimer = setTimeout(async () => {
      if (this.stopped) return;
      try {
        if (this.reconnectFn) {
          await this.reconnectFn();
          // 重连成功
          this.reconnectAttempts = 0;
          this._setState('connected' as ConnectionState);
          this.emit('reconnected');
          this.onEvent?.reconnected?.();
        }
      } catch {
        // 重连失败，继续尝试
        this._tryReconnect();
      }
    }, this.config.reconnectIntervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    this.stopped = true;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._setState('disconnected' as ConnectionState);
  }

  /** 重置重连计数（连接稳定后调用） */
  resetAttempts(): void {
    this.reconnectAttempts = 0;
  }

  private _setState(s: ConnectionState): void {
    this.state = s;
    this.emit('stateChange', s);
    this.onEvent?.stateChange?.(s);
  }

  get currentState(): ConnectionState { return this.state; }
  get attemptCount(): number { return this.reconnectAttempts; }
  get maxAttempts(): number { return this.config.maxReconnectAttempts; }
}
