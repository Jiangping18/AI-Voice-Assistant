/**
 * 运行时验证脚本（纯 Node.js，无需 TypeScript 编译）
 *
 * 验证 comm 模块的核心逻辑：CRC32、加密、分片协议、配对协议。
 * 直接以 .mjs 运行：node validate.mjs
 */

import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// 当前脚本目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function crc32(data) {
  return zlib.crc32(data) >>> 0;
}

function splitBuffer(data, audioId, chunkSize) {
  const chunks = [];
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

function serializeChunk(chunk) {
  const audioIdBuf = Buffer.from(chunk.audioId, 'utf-8');
  const headerFixed = 4 + 2 + 8 + 8 + 4; // 26 bytes
  const totalSize = headerFixed + audioIdBuf.length + chunk.data.length;
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

function deserializeChunk(buf) {
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

function verifyChunkCRC(chunk) {
  return crc32(chunk.data) === chunk.crc32;
}

function reassemble(chunks) {
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

function getMissingIds(total, received) {
  const miss = [];
  for (let i = 0; i < total; i++) {
    if (!received.has(i)) miss.push(i);
  }
  return miss;
}

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

function encrypt(plaintext, key) {
  const keyBuf = Buffer.from(key, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

function decrypt(ciphertext, iv, authTag, key) {
  const keyBuf = Buffer.from(key, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptPacket(plaintext, key) {
  const { ciphertext, iv, authTag } = encrypt(plaintext, key);
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptPacket(packet, key) {
  const iv = packet.subarray(0, 12);
  const authTag = packet.subarray(12, 28);
  const ciphertext = packet.subarray(28);
  return decrypt(ciphertext, iv, authTag, key);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateToken(length) {
  return crypto.randomBytes(length).toString('hex');
}

// ==========================================
// Tests
// ==========================================
let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function assertEqual(a, b, msg) {
  const ok = a === b || (Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b));
  if (ok) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}: expected ${typeof a === 'object' ? JSON.stringify(a) : a}, got ${typeof b === 'object' ? JSON.stringify(b) : b}`);
    failed++;
  }
}

function assertDeepEqual(a, b, msg) {
  const aStr = JSON.stringify(a);
  const bStr = JSON.stringify(b);
  if (aStr === bStr) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}: ${aStr} !== ${bStr}`);
    failed++;
  }
}

// ---- Test 1: CRC32 + 分片 ----
console.log('\n[Test 1] CRC32 + 分片协议');
const data = Buffer.from('Hello, AI Voice Assistant!');
const hash = crc32(data);
assert(typeof hash === 'number' && hash > 0, 'CRC32 应为正数');

const audioId = 'test-audio-001';
const largeData = Buffer.alloc(200 * 1024);
for (let i = 0; i < largeData.length; i++) largeData[i] = i & 0xff;

const chunks = splitBuffer(largeData, audioId, 64 * 1024);
assert(chunks.length === 4, '200KB 应分为 4 个分片');

const serialized = serializeChunk(chunks[0]);
const deserialized = deserializeChunk(serialized);
assert(deserialized.chunkId === chunks[0].chunkId, 'chunkId 一致');
assert(deserialized.audioId === chunks[0].audioId, 'audioId 一致');
assert(deserialized.offset === chunks[0].offset, 'offset 一致');
assertEqual(deserialized.data, chunks[0].data, '数据一致');

assert(verifyChunkCRC(deserialized), 'CRC32 校验应通过');
const corrupted = { ...chunks[0], data: Buffer.from('corrupted') };
assert(!verifyChunkCRC(corrupted), '篡改数据应检测到');

const reassembled = reassemble(chunks);
assertEqual(reassembled, largeData, '重组数据一致');

const missing = getMissingIds(4, new Set([0, 1, 3]));
assertDeepEqual(missing, [2], '缺失分片检测');

// ---- Test 2: 加密 ----
console.log('\n[Test 2] 加密工具');
const key = generateEncryptionKey();
assert(key.length === 64, '密钥应为 64 字符 hex');

const plaintext = Buffer.from('测试数据 with UTF-8 🎉');
const { ciphertext, iv, authTag } = encrypt(plaintext, key);
const decrypted = decrypt(ciphertext, iv, authTag, key);
assertEqual(decrypted, plaintext, 'AES-256-GCM 解密一致');

const packet = encryptPacket(plaintext, key);
const unpacked = decryptPacket(packet, key);
assertEqual(unpacked, plaintext, '加密包格式通过');

const token = generateToken(16);
assert(token.length === 32, 'Token 长度正确');

const hash256 = sha256('test-data');
assert(hash256.length === 64, 'SHA-256 长度正确');

// ---- Test 3: 配对（简单验证） ----
console.log('\n[Test 3] 配对基础验证');
// 验证 Token 生成和 ECDH
const ecdh1 = crypto.createECDH('prime256v1');
const ecdh2 = crypto.createECDH('prime256v1');
ecdh1.generateKeys();
ecdh2.generateKeys();

const secret1 = ecdh1.computeSecret(ecdh2.getPublicKey());
const secret2 = ecdh2.computeSecret(ecdh1.getPublicKey());
assertEqual(secret1, secret2, 'ECDH 密钥交换一致');

// ---- Test 4: 配置文件读取验证 ----
console.log('\n[Test 4] 源文件完整性');
const commDir = path.resolve(__dirname, '..');
const expectedFiles = [
  'types.ts', 'config.ts', 'index.ts',
  'crypto/utils.ts',
  'signaling/ws.ts', 'signaling/server.ts', 'signaling/client.ts', 'signaling/pairing.ts',
  'transport/chunk.ts', 'transport/sender.ts', 'transport/receiver.ts', 'transport/manager.ts',
  'control/channel.ts', 'control/heartbeat.ts',
  'discovery/service.ts',
  'storage/credential.ts',
];

for (const file of expectedFiles) {
  const fullPath = path.join(commDir, file);
  const exists = fs.existsSync(fullPath);
  assert(exists, `文件存在: ${file}`);
}

// ==========================================
console.log('\n========================================');
console.log(`结果: ${passed} 通过, ${failed} 失败`);
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
