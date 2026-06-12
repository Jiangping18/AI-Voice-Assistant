/**
 * control/channel.ts — 双向控制指令通道
 *
 * PC ↔ 手机 之间的控制消息和状态同步通道。
 * 复用信令 WebSocket 连接（不需要额外建立 TCP 连接）。
 *
 * 支持的消息类型：
 *   - PC → 手机: start_recording, stop_recording, start_transcribe
 *   - 手机 → PC: state_update, audio_meta, audio_complete
 *   - 双向: pairing_request/response, error
 *
 * 符合 IF-01 / IF-02 接口规范。
 */

import { EventEmitter } from 'node:events';
import type { ControlMessage, ControlMessageType, StateUpdatePayload, AudioMetaPayload } from '../types';
import { SignalingServer } from '../signaling/server';

export interface ControlChannelEvents {
  /** 收到控制消息 */
  message: (msg: ControlMessage) => void;
  /** 状态更新 */
  stateUpdate: (payload: StateUpdatePayload) => void;
  /** 音频元信息 */
  audioMeta: (payload: AudioMetaPayload) => void;
  /** 错误 */
  error: (error: Error) => void;
}

/** 控制指令通道 */
export class ControlChannel extends EventEmitter {
  private seqId = 0;

  constructor(
    private signalingServer?: SignalingServer,
    private onEvent?: Partial<ControlChannelEvents>,
  ) {
    super();
    if (onEvent) {
      if (onEvent.message) this.on('message', onEvent.message);
      if (onEvent.stateUpdate) this.on('stateUpdate', onEvent.stateUpdate);
      if (onEvent.audioMeta) this.on('audioMeta', onEvent.audioMeta);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /** 生成唯一消息 ID */
  private nextId(): string {
    return `ctrl-${Date.now()}-${++this.seqId}`;
  }

  /** 构造控制消息 */
  private buildMessage(type: ControlMessageType, payload: Record<string, unknown>): ControlMessage {
    return { type, messageId: this.nextId(), timestamp: Date.now(), payload };
  }

  /** 发送控制消息给指定对端 */
  sendTo(peerId: string, type: ControlMessageType, payload: Record<string, unknown>): boolean {
    if (!this.signalingServer) return false;
    const msg = this.buildMessage(type, payload);
    return this.signalingServer.sendToPeer(peerId, JSON.stringify({
      type: 'control',
      messageId: msg.messageId,
      timestamp: msg.timestamp,
      controlType: msg.type,
      payload: msg.payload,
    }));
  }

  /** 广播控制消息 */
  broadcast(type: ControlMessageType, payload: Record<string, unknown>): void {
    if (!this.signalingServer) return;
    const msg = this.buildMessage(type, payload);
    this.signalingServer.broadcast(JSON.stringify({
      type: 'control',
      messageId: msg.messageId,
      timestamp: msg.timestamp,
      controlType: msg.type,
      payload: msg.payload,
    }));
  }

  // ---- 便捷方法 ----

  /** PC → 手机：开始录音 */
  startRecording(peerId: string): boolean {
    return this.sendTo(peerId, 'start_recording' as ControlMessageType, {});
  }

  /** PC → 手机：停止录音 */
  stopRecording(peerId: string): boolean {
    return this.sendTo(peerId, 'stop_recording' as ControlMessageType, {});
  }

  /** PC → 手机：开始转写 */
  startTranscribe(peerId: string, audioId?: string): boolean {
    return this.sendTo(peerId, 'start_transcribe' as ControlMessageType, { audioId: audioId || '' });
  }

  /** 手机 → PC：状态更新（收到的外部消息通过 handleMessage 注入） */
  handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw);

      // 支持两种格式：control 类型包 或 原始控制消息
      const msg: ControlMessage = {
        type: parsed.controlType || parsed.type,
        messageId: parsed.messageId || '',
        timestamp: parsed.timestamp || Date.now(),
        payload: parsed.payload || {},
      };

      this.emit('message', msg);

      // 特定类型分发
      if (msg.type === 'state_update') {
        this.emit('stateUpdate', msg.payload as unknown as StateUpdatePayload);
        this.onEvent?.stateUpdate?.(msg.payload as unknown as StateUpdatePayload);
      } else if (msg.type === 'audio_meta') {
        this.emit('audioMeta', msg.payload as unknown as AudioMetaPayload);
        this.onEvent?.audioMeta?.(msg.payload as unknown as AudioMetaPayload);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', error);
      this.onEvent?.error?.(error);
    }
  }
}
