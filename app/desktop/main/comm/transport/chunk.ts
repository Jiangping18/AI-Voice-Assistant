/**
 * transport/chunk.ts — 64KB 音频分片协议
 *
 * 实现：
 *   - 大 Buffer → AudioChunk[] （分片 + CRC32）
 *   - 序列化 / 反序列化（线格式）
 *   - CRC32 校验
 *   - 接收端重组
 *   - 缺失分片检测（断点续传）
 *
 * 线格式（固定头部 + 变长负载）：
 * [chunkId:4][audioIdLen:2][audioId:变长][offset:8][timestamp:8][crc32:4][data:变长]
 *
 * 所有多字节字段使用 Big-Endian 网络字节序。
 */

import * as zlib from 'node:zlib';
import type { AudioChunk, TransferProgress } from '../types';
import { ChunkTransferState } from '../types';

/** 分片头部固定部分长度（不含 audioId 和 data） */
export const CHUNK_HEADER_FIXED = 4 + 2 + 8 + 8 + 4; // 26 字节
/** audioId 最大字节数 */
export const MAX_AUDIO_ID_BYTES = 64;
/** 单分片最大数据负载 */
export const MAX_CHUNK_DATA = 64 * 1024; // 64KB

// ---- CRC32 ----

/** 计算 Buffer 的 CRC32（返回无符号 32 位整数） */
export function crc32(data: Buffer): number {
  return zlib.crc32(data) >>> 0;
}

/** 校验分片 CRC32 */
export function verifyChunkCRC(chunk: AudioChunk): boolean {
  return crc32(chunk.data) === chunk.crc32;
}

// ---- 序列化 / 反序列化 ----

/** AudioChunk → Buffer */
export function serializeChunk(chunk: AudioChunk): Buffer {
  const audioIdBuf = Buffer.from(chunk.audioId, 'utf-8');
  const totalSize = CHUNK_HEADER_FIXED + audioIdBuf.length + chunk.data.length;
  const buf = Buffer.alloc(totalSize);
  let off = 0;

  buf.writeUInt32BE(chunk.chunkId, off);  off += 4;
  buf.writeUInt16BE(audioIdBuf.length, off); off += 2;
  audioIdBuf.copy(buf, off);               off += audioIdBuf.length;
  buf.writeBigUInt64BE(BigInt(chunk.offset), off);     off += 8;
  buf.writeBigUInt64BE(BigInt(chunk.timestamp), off);  off += 8;
  buf.writeUInt32BE(chunk.crc32, off);     off += 4;
  chunk.data.copy(buf, off);

  return buf;
}

/** Buffer → AudioChunk */
export function deserializeChunk(buf: Buffer): AudioChunk {
  let off = 0;
  const chunkId = buf.readUInt32BE(off);     off += 4;
  const audioIdLen = buf.readUInt16BE(off);   off += 2;
  const audioId = buf.toString('utf-8', off, off + audioIdLen); off += audioIdLen;
  const offset = Number(buf.readBigUInt64BE(off)); off += 8;
  const timestamp = Number(buf.readBigUInt64BE(off)); off += 8;
  const crc = buf.readUInt32BE(off);          off += 4;
  const data = Buffer.from(buf.subarray(off));

  return { chunkId, audioId, offset, data, timestamp, crc32: crc, isRetransmission: false };
}

// ---- 分片工具 ----

/** 将完整音频 Buffer 拆分为 AudioChunk 列表 */
export function splitBuffer(
  data: Buffer,
  audioId: string,
  chunkSize: number = MAX_CHUNK_DATA,
): AudioChunk[] {
  const chunks: AudioChunk[] = [];
  const now = Date.now();

  for (let offset = 0, id = 0; offset < data.length; offset += chunkSize, id++) {
    const end = Math.min(offset + chunkSize, data.length);
    const chunkData = Buffer.from(data.subarray(offset, end));
    chunks.push({
      chunkId: id,
      audioId,
      offset,
      data: chunkData,
      timestamp: now,
      crc32: crc32(chunkData),
      isRetransmission: false,
    });
  }
  return chunks;
}

/** 将已接收分片按序重组为完整 Buffer */
export function reassemble(chunks: AudioChunk[]): Buffer {
  const sorted = [...chunks].sort((a, b) => a.chunkId - b.chunkId);
  const total = sorted.reduce((s, c) => s + c.data.length, 0);
  const out = Buffer.alloc(total);
  let off = 0;
  for (const c of sorted) {
    c.data.copy(out, off);
    off += c.data.length;
  }
  return out;
}

/** 找出缺失的分片序号（断点续传） */
export function getMissingIds(total: number, received: Set<number>): number[] {
  const miss: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!received.has(i)) miss.push(i);
  }
  return miss;
}

/** 计算传输进度 */
export function computeProgress(
  audioId: string,
  totalBytes: number,
  chunks: AudioChunk[],
  totalChunks: number,
  startTime: number,
): TransferProgress {
  const done = chunks.reduce((s, c) => s + c.data.length, 0);
  const elapsed = Date.now() - startTime;
  return {
    audioId,
    totalBytes,
    transferredBytes: done,
    totalChunks,
    completedChunks: chunks.length,
    percent: totalBytes > 0 ? Math.round((done / totalBytes) * 100) : 0,
    state: ChunkTransferState.TRANSFERRING,
    speedBps: elapsed > 0 ? Math.round(done / (elapsed / 1000)) : 0,
  };
}
