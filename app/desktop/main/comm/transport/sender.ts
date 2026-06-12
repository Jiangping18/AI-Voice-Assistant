/**
 * transport/sender.ts — 音频数据发送器（桌面端 → 移动端）
 *
 * 职责：
 *   1. 从上游（ASR 模块处理的 PCM 数据或文件路径）读取音频数据
 *   2. 拆分为 64KB 分片（含 CRC32）
 *   3. 通过加密 TCP 通道逐片发送
 *   4. 上报传输进度
 *   5. 支持断点续传（接收缺失分片）
 *
 * 接口：
 *   - sendAudio(data, audioId) — 发送完整 Buffer
 *   - sendPCMChunk(chunk) — 实时流式发送（适用于移动端实时采集场景，本端为接收端）
 *   - onProgress — 进度回调
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { splitBuffer, serializeChunk, computeProgress } from './chunk';
import { encryptPacket } from '../crypto/utils';
import type { AudioChunk, TransferProgress, ChunkTransferState } from '../types';
import { DEFAULT_COMM_CONFIG } from '../config';

export type AudioSource = Buffer | string; // Buffer = PCM 数据, string = 文件路径

/** 音频发送器事件 */
export interface AudioSenderEvents {
  progress: (progress: TransferProgress) => void;
  chunkSent: (chunkId: number, audioId: string) => void;
  complete: (audioId: string) => void;
  error: (error: Error) => void;
}

/** 音频发送器 */
export class AudioSender extends EventEmitter {
  private config = DEFAULT_COMM_CONFIG;
  private socket: net.Socket | null = null;
  private encryptionKey = '';
  private sending = false;

  constructor(onEvent?: Partial<AudioSenderEvents>) {
    super();
    if (onEvent) {
      if (onEvent.progress) this.on('progress', onEvent.progress);
      if (onEvent.complete) this.on('complete', onEvent.complete);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /** 绑定加密连接 */
  attach(socket: net.Socket, encryptionKey: string): void {
    this.socket = socket;
    this.encryptionKey = encryptionKey;
  }

  /** 发送完整音频数据 */
  async sendAudio(data: Buffer, audioId: string): Promise<void> {
    if (!this.socket) throw new Error('发送器未绑定连接');
    if (this.sending) throw new Error('正在发送中，请等待完成');

    this.sending = true;
    const startTime = Date.now();
    const chunks = splitBuffer(data, audioId, this.config.dataChunkSize);
    const totalBytes = data.length;

    try {
      for (const chunk of chunks) {
        // 序列化 → 加密 → 发送
        const serialized = serializeChunk(chunk);
        const encrypted = encryptPacket(serialized, this.encryptionKey);

        // 线格式：[4字节长度][加密数据]
        const header = Buffer.alloc(4);
        header.writeUInt32BE(encrypted.length);
        const packet = Buffer.concat([header, encrypted]);

        await this.writeWithAck(packet);

        this.emit('chunkSent', chunk.chunkId, audioId);

        // 上报进度
        const progress = computeProgress(audioId, totalBytes, chunks.slice(0, chunk.chunkId + 1), chunks.length, startTime);
        this.emit('progress', progress);
      }

      // 发送完成标记
      const donePacket = encryptPacket(Buffer.from(JSON.stringify({
        type: 'audio_complete',
        audioId,
        totalBytes,
        totalChunks: chunks.length,
        duration: data.length / 32000, // bytes / byteRate → seconds
      })), this.encryptionKey);
      const doneHeader = Buffer.alloc(4);
      doneHeader.writeUInt32BE(donePacket.length);
      this.socket.write(Buffer.concat([doneHeader, donePacket]));

      this.emit('complete', audioId);
    } finally {
      this.sending = false;
    }
  }

  /** 从文件发送音频 */
  async sendAudioFile(filePath: string, audioId?: string): Promise<void> {
    const data = fs.readFileSync(filePath);
    const id = audioId || path.basename(filePath, path.extname(filePath));
    return this.sendAudio(data, id);
  }

  /** 重发缺失分片（断点续传） */
  async retransmitChunks(missingChunkIds: number[], allChunks: AudioChunk[]): Promise<void> {
    if (!this.socket) throw new Error('发送器未绑定连接');

    for (const id of missingChunkIds) {
      const chunk = allChunks.find(c => c.chunkId === id);
      if (!chunk) continue;

      chunk.isRetransmission = true;
      const serialized = serializeChunk(chunk);
      const encrypted = encryptPacket(serialized, this.encryptionKey);
      const header = Buffer.alloc(4);
      header.writeUInt32BE(encrypted.length);
      this.socket.write(Buffer.concat([header, encrypted]));
    }
  }

  /** 带确认的写入（等待对端 ACK，简化版直接写入） */
  private writeWithAck(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) { reject(new Error('Socket 已关闭')); return; }
      this.socket.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** 断开 */
  detach(): void {
    this.socket = null;
    this.sending = false;
  }
}
