/**
 * Comm 模块核心逻辑测试（使用 Node.js 内置模块）
 *
 * 测试项:
 *   1. CRC32 校验
 *   2. 分片/重组
 *   3. AES-256-GCM 加密/解密
 *   4. 配对 Token 生成/验证
 *   5. 模拟音频传输全流程
 */

import * as crypto from 'node:crypto';
import * as assert from 'node:assert/strict';
import * as zlib from 'node:zlib';

const CHUNK_SIZE = 65536; // 64KB
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ─── CRC32 ─────────────────────────────────────────────
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── 分片 ──────────────────────────────────────────────
function splitBuffer(buffer, chunkSize = CHUNK_SIZE) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

function reassemble(chunks) {
  return Buffer.concat(chunks);
}

// ─── AES-256-GCM 加密/解密 ─────────────────────────────
function generateKey() {
  return crypto.randomBytes(32);
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv, tag };
}

function decrypt(encrypted, key, iv, tag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ─── ECDH 密钥交换 ─────────────────────────────────────
function generateECDH() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh;
}

function computeShared(ecdh, otherPublicKey) {
  return ecdh.computeSecret(otherPublicKey);
}

// ─── Token 生成 ────────────────────────────────────────
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

// ════════════════════════════════════════════════════════
console.log('\nComm 模块核心逻辑测试\n');
console.log('='.repeat(50));

// 测试 1: CRC32
test('CRC32 校验 — 空数据', () => {
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('CRC32 校验 — 已知数据', () => {
  const data = Buffer.from('hello');
  const result = crc32(data);
  assert.equal(typeof result, 'number');
  assert.ok(result > 0);
});

test('CRC32 校验 — 64KB 数据一致性', () => {
  const data = crypto.randomBytes(CHUNK_SIZE);
  const c1 = crc32(data);
  const c2 = crc32(data);
  assert.equal(c1, c2);
});

test('CRC32 校验 — 不同数据不同值', () => {
  const d1 = crc32(Buffer.from('abc'));
  const d2 = crc32(Buffer.from('abd'));
  assert.notEqual(d1, d2);
});

// 测试 2: 分片/重组
test('分片/重组 — 小数据（<64KB）', () => {
  const data = Buffer.from('small data');
  const chunks = splitBuffer(data);
  assert.equal(chunks.length, 1);
  const restored = reassemble(chunks);
  assert.equal(restored.toString(), 'small data');
});

test('分片/重组 — 恰好 64KB', () => {
  const data = crypto.randomBytes(CHUNK_SIZE);
  const chunks = splitBuffer(data);
  assert.equal(chunks.length, 1);
  const restored = reassemble(chunks);
  assert.ok(restored.equals(data));
});

test('分片/重组 — 64KB+1 字节（2片）', () => {
  const data = crypto.randomBytes(CHUNK_SIZE + 1);
  const chunks = splitBuffer(data);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, CHUNK_SIZE);
  assert.equal(chunks[1].length, 1);
  const restored = reassemble(chunks);
  assert.ok(restored.equals(data));
});

test('分片/重组 — 192KB（3片）', () => {
  const data = crypto.randomBytes(CHUNK_SIZE * 3);
  const chunks = splitBuffer(data);
  assert.equal(chunks.length, 3);
  const restored = reassemble(chunks);
  assert.ok(restored.equals(data));
});

// 测试 3: AES-256-GCM 加密
test('AES-256-GCM — 加密/解密', () => {
  const key = generateKey();
  const plaintext = Buffer.from('Hello, AI Voice Assistant!');
  const { encrypted, iv, tag } = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key, iv, tag);
  assert.equal(decrypted.toString(), 'Hello, AI Voice Assistant!');
  assert.notDeepEqual(encrypted, plaintext);
});

test('AES-256-GCM — 篡改检测', () => {
  const key = generateKey();
  const plaintext = Buffer.from('sensitive data');
  const { encrypted, iv, tag } = encrypt(plaintext, key);
  encrypted[0] ^= 0xFF; // 篡改
  assert.throws(() => decrypt(encrypted, key, iv, tag));
});

test('AES-256-GCM — 64KB 大块加密', () => {
  const key = generateKey();
  const plaintext = crypto.randomBytes(CHUNK_SIZE);
  const { encrypted, iv, tag } = encrypt(plaintext, key);
  const decrypted = decrypt(encrypted, key, iv, tag);
  assert.ok(decrypted.equals(plaintext));
});

test('AES-256-GCM — 不同密钥解密失败', () => {
  const key1 = generateKey();
  const key2 = generateKey();
  const plaintext = Buffer.from('secret');
  const { encrypted, iv, tag } = encrypt(plaintext, key1);
  assert.throws(() => decrypt(encrypted, key2, iv, tag));
});

// 测试 4: ECDH 密钥交换
test('ECDH — 双方生成相同共享密钥', () => {
  const alice = generateECDH();
  const bob = generateECDH();
  const sharedAlice = computeShared(alice, bob.getPublicKey());
  const sharedBob = computeShared(bob, alice.getPublicKey());
  assert.ok(sharedAlice.equals(sharedBob));
  assert.equal(sharedAlice.length, 32); // SHA-256
});

test('ECDH — 不同对密钥不同', () => {
  const alice1 = generateECDH();
  const bob1 = generateECDH();
  const alice2 = generateECDH();
  const bob2 = generateECDH();
  const s1 = computeShared(alice1, bob1.getPublicKey());
  const s2 = computeShared(alice2, bob2.getPublicKey());
  assert.notDeepEqual(s1, s2);
});

// 测试 5: Token
test('Token — 生成长度正确', () => {
  const token = generateToken(32);
  assert.equal(token.length, 64); // hex 编码
});

test('Token — 每次不同', () => {
  const t1 = generateToken();
  const t2 = generateToken();
  assert.notEqual(t1, t2);
});

// 测试 6: 模拟音频传输全流程
test('模拟音频传输 — 完整分片→加密→解密→重组', () => {
  const audioData = crypto.randomBytes(16000 * 2 * 30); // 30秒 16kHz 16bit PCM
  const audioId = crypto.randomUUID();
  const key = generateKey();

  // 分片
  const chunks = splitBuffer(audioData);
  console.log(`     音频大小: ${(audioData.length / 1024).toFixed(1)}KB, 分片数: ${chunks.length}`);

  // 每片加密 + CRC32
  const encryptedChunks = chunks.map((chunk, i) => {
    const { encrypted, iv, tag } = encrypt(chunk, key);
    const checksum = crc32(chunk);
    return {
      chunkId: i,
      audioId,
      encrypted,
      iv,
      tag,
      offset: i * CHUNK_SIZE,
      checksum,
    };
  });

  // 模拟传输后解密 + CRC32 验证
  const decryptedChunks = encryptedChunks.map((ec) => {
    const decrypted = decrypt(ec.encrypted, key, ec.iv, ec.tag);
    const verifyChecksum = crc32(decrypted);
    assert.equal(verifyChecksum, ec.checksum, `分片 ${ec.chunkId} CRC32 不匹配`);
    return decrypted;
  });

  // 重组
  const restored = reassemble(decryptedChunks);
  assert.ok(restored.equals(audioData));
  assert.equal(restored.length, audioData.length);
  console.log(`     传输验证: ${encryptedChunks.length} 片 CRC32 全部通过, 重组大小: ${(restored.length / 1024).toFixed(1)}KB`);
});

// 测试 7: 断点续传模拟
test('断点续传 — 模拟丢片后只重传丢失分片', () => {
  const audioData = crypto.randomBytes(CHUNK_SIZE * 5); // 320KB = 5片
  const chunks = splitBuffer(audioData);
  const totalChunks = chunks.length;

  // 模拟收到前 3 片
  const received = new Set([0, 1, 2]);
  const missing = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!received.has(i)) missing.push(i);
  }

  assert.equal(missing.length, 2);
  assert.deepEqual(missing, [3, 4]);

  // 只重传丢失的
  const retransmitted = chunks.filter((_, i) => missing.includes(i));
  assert.equal(retransmitted.length, 2);

  // 合并全部
  const all = [chunks[0], chunks[1], chunks[2], ...retransmitted];
  const restored = reassemble(all);
  assert.ok(restored.equals(audioData));
  console.log(`     总片数: ${totalChunks}, 接收: 3, 丢失: ${missing.length}, 续传成功`);
});

// ════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(50)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败, ${passed + failed} 总计`);
console.log(`${'='.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
