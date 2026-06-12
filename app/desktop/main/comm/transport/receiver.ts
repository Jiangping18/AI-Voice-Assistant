/**
 * transport/receiver.ts — 音频数据接收器（桌面端从移动端接收）
 *
 * 职责：
 *   1. 监听加密 TCP 连接，接收分片数据
 *   2. CRC32 校验每个分片
 *   3. 组装完整音频文件
 *   4. 上报传输进度
 *   5. 支持断点续传：记录已接收分片，生成缺失列表
 *
 * 工作流程：
 *   TCP 流 → [4字节长度][加密包] → 解密 → 反序列化 → CRC32验证 → 存储
 */

import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { deserializeChunk, verifyChunkCRC, reassemble } from './chunk';
import { decryptPacket } from '../crypto/utils';
import type { AudioChunk, TransferProgress } from '../types';
import { ChunkTransferState } from '../types';
import { DEFAULT_COMM_CONFIG } from '../config';

/** 接收器事件 */
export interface AudioReceiverEvents {
  progress: (progress: TransferProgress) => void;
  chunkReceived: (chunkId: number, audioId: string) => void;
  audioComplete: (audioId: string, data: Buffer) => void;
  error: (error: Error) => void;
}

/** 接收中的传输任务 */
interface ReceiveTask {
  audioId: string;
  chunks: AudioChunk[];
  receivedIds: Set<number>;
  totalBytes: number;
  totalChunks: number;
  startTime: number;
}

/** 音频数据接收器 */
export class AudioReceiver extends EventEmitter {
  private tasks = new Map<string, ReceiveTask>();
  private buffer = Buffer.alloc(0); // TCP 粘包缓冲区
  private encryptionKey = '';

  constructor(onEvent?: Partial<AudioReceiverEvents>) {
    super();
    if (onEvent) {
      if (onEvent.progress) this.on('progress', onEvent.progress);
      if (onEvent.chunkReceived) this.on('chunkReceived', onEvent.chunkReceived);
      if (onEvent.audioComplete) this.on('audioComplete', onEvent.audioComplete);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /** 设置解密密钥 */
  setEncryptionKey(key: string): void {
    this.encryptionKey = key;
  }

  /** 将接收器绑定到 TCP socket */
  attach(socket: net.Socket): void {
    socket.on('data', (data: Buffer) => this._onData(data));
    socket.on('close', () => { /* clean up if needed */ });
    socket.on('error', (err) => this.emit('error', err));
  }

  /** 处理收到的 TCP 数据（处理粘包） */
  private _onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this._tryParsePacket();
  }

  /** 尝试从缓冲区解析完整包 */
  private _tryParsePacket(): void {
    while (this.buffer.length >= 4) {
      const packetLen = this.buffer.readUInt32BE(0);
      const totalLen = 4 + packetLen;

      if (this.buffer.length < totalLen) break; // 等待更多数据

      const packet = this.buffer.subarray(4, totalLen);
      this.buffer = this.buffer.subarray(totalLen);

      try {
        this._processPacket(packet);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** 处理单个加密包 */
  private _processPacket(encrypted: Buffer): void {
    if (!this.encryptionKey) return;

    // 解密
    const decrypted = decryptPacket(encrypted, this.encryptionKey);

    // 检查是否为控制包（JSON）或分片包（二进制）
    const firstByte = decrypted[0];

    if (firstByte === 0x7b) { // '{' → JSON 控制消息
      const json = decrypted.toString('utf-8');
      try {
        const msg = JSON.parse(json);

        if (msg.type === 'audio_complete') {
          // 音频传输完成
          const task = this.tasks.get(msg.audioId);
          if (task) {
            const data = reassemble(Array.from(task.chunks));
            this.emit('audioComplete', msg.audioId, data);
            this.tasks.delete(msg.audioId);
          }
        } else if (msg.type === 'audio_meta') {
          // 音频元信息 → 创建接收任务
          this.tasks.set(msg.audioId, {
            audioId: msg.audioId,
            chunks: [],
            receivedIds: new Set(),
            totalBytes: msg.totalBytes || 0,
            totalChunks: msg.totalChunks || 0,
            startTime: Date.now(),
          });
        }
      } catch { /* ignore parse errors */ }
      return;
    }

    // 音频分片包
    const chunk = deserializeChunk(decrypted);

    // CRC32 校验
    if (!verifyChunkCRC(chunk)) {
      this.emit('error', new Error(`分片 ${chunk.chunkId} CRC32 校验失败`));
      return;
    }

    // 获取或创建接收任务
    let task = this.tasks.get(chunk.audioId);
    if (!task) {
      task = {
        audioId: chunk.audioId,
        chunks: [],
        receivedIds: new Set(),
        totalBytes: 0,
        totalChunks: 0,
        startTime: Date.now(),
      };
      this.tasks.set(chunk.audioId, task);
    }

    // 去重
    if (!task.receivedIds.has(chunk.chunkId)) {
      task.receivedIds.add(chunk.chunkId);
      task.chunks.push(chunk);
      task.totalBytes += chunk.data.length;

      this.emit('chunkReceived', chunk.chunkId, chunk.audioId);

      // 上报进度
      const progress: TransferProgress = {
        audioId: chunk.audioId,
        totalBytes: task.totalBytes,
        transferredBytes: task.chunks.reduce((s, c) => s + c.data.length, 0),
        totalChunks: task.totalChunks || task.chunks.length,
        completedChunks: task.receivedIds.size,
        percent: 0,
        state: ChunkTransferState.TRANSFERRING,
        speedBps: 0,
      };
      this.emit('progress', progress);
    }
    // 重复分片：忽略
  }

  /** 获取指定音频的已接收分片 ID 列表（用于断点续传通知发送端） */
  getReceivedChunkIds(audioId: string): number[] {
    const task = this.tasks.get(audioId);
    return task ? Array.from(task.receivedIds).sort((a, b) => a - b) : [];
  }

  /** 清理 */
  reset(): void {
    this.tasks.clear();
    this.buffer = Buffer.alloc(0);
  }
}
