/**
 * comm/ 模块 — 集成测试
 *
 * 使用 Node.js 内置 assert 模块，验证各子模块的核心功能。
 * 运行方式：node --experimental-vm-modules node_modules/.bin/jest --config jest.config.js
 * 或直接用 ts-node / tsx 运行。
 *
 * @jest-environment node
 */

// 注意：由于 npm 注册表被限制，无法安装 jest 和 ts-jest。
// 本文件使用 Node.js 原生 assert 编写，可用 tsx 或 ts-node 直接运行。
// 运行方式：npx tsx main/comm/__tests__/comm.test.ts

// ==========================================
// 引入模块
// ==========================================
import * as assert from 'node:assert';
import { crc32, splitBuffer, reassemble, serializeChunk, deserializeChunk, verifyChunkCRC, getMissingIds } from '../transport/chunk';
import { generateEncryptionKey, encrypt, decrypt, encryptPacket, decryptPacket, sha256, generateToken } from '../crypto/utils';
import { createPairingToken, validateToken, consumePairingToken, generateQRContent, parseQRContent } from '../signaling/pairing';
import { saveCredential, loadCredential, listSavedPeerIds, removeCredential } from '../storage/credential';
import { Heartbeat } from '../control/heartbeat';
import type { PeerInfo } from '../types';

// ==========================================
// Test Suite 1: CRC32 + 分片协议
// ==========================================
function testChunkProtocol() {
  console.log('\n[Test Suite 1] CRC32 + 分片协议');

  // 1.1 CRC32 计算
  const data = Buffer.from('Hello, AI Voice Assistant! 你好，世界！');
  const hash = crc32(data);
  assert.ok(typeof hash === 'number' && hash > 0, 'CRC32 应为正数');
  console.log('  ✓ CRC32 计算:', hash);

  // 1.2 分片
  const audioId = 'test-audio-001';
  const largeData = Buffer.alloc(200 * 1024); // 200KB 数据
  for (let i = 0; i < largeData.length; i++) largeData[i] = i & 0xff;

  const chunks = splitBuffer(largeData, audioId, 64 * 1024);
  assert.equal(chunks.length, 4, '200KB 应分为 4 个分片 (64KB × 3 + 8KB)');
  assert.equal(chunks[0].chunkId, 0);
  assert.equal(chunks[3].chunkId, 3);
  console.log(`  ✓ 分片: ${largeData.length} bytes → ${chunks.length} chunks`);

  // 1.3 序列化 / 反序列化
  const serialized = serializeChunk(chunks[0]);
  const deserialized = deserializeChunk(serialized);
  assert.equal(deserialized.chunkId, chunks[0].chunkId);
  assert.equal(deserialized.audioId, chunks[0].audioId);
  assert.equal(deserialized.offset, chunks[0].offset);
  assert.ok(deserialized.data.equals(chunks[0].data), '反序列化后数据应一致');
  console.log('  ✓ 序列化/反序列化: 数据一致');

  // 1.4 CRC32 校验
  assert.ok(verifyChunkCRC(deserialized), 'CRC32 校验应通过');
  const corrupted = { ...chunks[0], data: Buffer.from('corrupted') };
  assert.ok(!verifyChunkCRC(corrupted as any), '篡改数据后 CRC32 应失败');
  console.log('  ✓ CRC32 校验: 正常通过，篡改失败');

  // 1.5 重组
  const reassembled = reassemble(chunks);
  assert.equal(reassembled.length, largeData.length);
  assert.ok(reassembled.equals(largeData), '重组后数据应与原始数据一致');
  console.log('  ✓ 重组: 数据完全一致');

  // 1.6 缺失分片检测
  const received = new Set([0, 1, 3]);
  const missing = getMissingIds(4, received);
  assert.deepEqual(missing, [2], '缺失分片应为 [2]');
  console.log('  ✓ 缺失分片检测: [2]');
}

// ==========================================
// Test Suite 2: 加密工具
// ==========================================
function testCrypto() {
  console.log('\n[Test Suite 2] 加密工具');

  // 2.1 密钥生成
  const key = generateEncryptionKey();
  assert.equal(key.length, 64, '密钥应为 64 字符 hex（32 字节）');
  console.log('  ✓ 密钥生成:', key.slice(0, 16) + '...');

  // 2.2 AES-256-GCM 加密/解密
  const plaintext = Buffer.from('这是测试数据 with UTF-8 中文 🎉');
  const { ciphertext, iv, authTag } = encrypt(plaintext, key);
  const decrypted = decrypt(ciphertext, iv, authTag, key);
  assert.ok(decrypted.equals(plaintext), '解密后应与原文一致');
  console.log('  ✓ AES-256-GCM 加密/解密: 通过');

  // 2.3 加密包打包/解包
  const packet = encryptPacket(plaintext, key);
  const unpacked = decryptPacket(packet, key);
  assert.ok(unpacked.equals(plaintext), '加密包解包后应与原文一致');
  console.log('  ✓ 加密包格式: 通过');

  // 2.4 Token 生成
  const token = generateToken(16);
  assert.equal(token.length, 32, '16 字节 Token 应生成 32 字符 hex');
  console.log('  ✓ Token 生成:', token.slice(0, 8) + '...');

  // 2.5 SHA-256
  const hash = sha256('test-data');
  assert.equal(hash.length, 64, 'SHA-256 应为 64 字符 hex');
  console.log('  ✓ SHA-256:', hash.slice(0, 8) + '...');
}

// ==========================================
// Test Suite 3: 配对协议
// ==========================================
function testPairing() {
  console.log('\n[Test Suite 3] 配对协议');

  const deviceId = 'desktop-test-001';
  const expiryMs = 300000;

  // 3.1 创建 Token
  const token = createPairingToken(deviceId, expiryMs);
  assert.ok(token.token.length > 0, 'Token 不应为空');
  assert.ok(token.expiresAt > token.createdAt, '过期时间应晚于创建时间');
  assert.equal(token.used, false, '新建 Token 应未使用');
  console.log('  ✓ 创建 Token:', token.token.slice(0, 8) + '...');

  // 3.2 验证 Token
  assert.ok(validateToken(deviceId, token.token), '有效 Token 应验证通过');
  assert.ok(!validateToken(deviceId, 'invalid-token'), '无效 Token 应验证失败');
  console.log('  ✓ Token 验证: 有效通过，无效拒绝');

  // 3.3 消费 Token
  assert.ok(consumePairingToken(deviceId), '消费 Token 应成功');
  assert.ok(!validateToken(deviceId, token.token), '已消费 Token 应失效');
  console.log('  ✓ Token 消费: 已消费的 Token 失效');

  // 3.4 二维码内容
  const qrJson = generateQRContent(deviceId, 'AI录音助手', '192.168.1.100', 18520, 18521, token.token, token.expiresAt);
  const parsed = parseQRContent(qrJson);
  assert.ok(parsed !== null, '解析二维码内容应成功');
  assert.equal(parsed!.deviceId, deviceId);
  assert.equal(parsed!.ip, '192.168.1.100');
  assert.equal(parsed!.signalingPort, 18520);
  console.log('  ✓ 二维码生成/解析: 通过');

  // 3.5 过期 Token 测试
  const expiredToken = createPairingToken('test-expired', 1); // 1ms 后过期
  const qrExpired = generateQRContent('test-expired', 'exp', '127.0.0.1', 18520, 18521, expiredToken.token, Date.now() - 1);
  const parsedExpired = parseQRContent(qrExpired);
  assert.equal(parsedExpired, null, '过期二维码应解析失败');
  console.log('  ✓ 过期二维码: 解析失败');
}

// ==========================================
// Test Suite 4: 凭证存储
// ==========================================
function testCredentialStorage() {
  console.log('\n[Test Suite 4] 凭证存储');

  const peer: PeerInfo = {
    deviceId: 'mobile-test-001',
    deviceName: '测试手机',
    deviceRole: 'mobile' as any,
    ipAddress: '192.168.1.50',
    signalingPort: 18520,
    dataPort: 18521,
  };
  const sharedKey = generateEncryptionKey();

  // 4.1 保存凭证
  saveCredential(peer, sharedKey);
  console.log('  ✓ 保存凭证: 通过');

  // 4.2 读取凭证
  const loaded = loadCredential('mobile-test-001');
  assert.ok(loaded !== null, '加载凭证应成功');
  assert.equal(loaded!.peer.deviceId, 'mobile-test-001');
  assert.equal(loaded!.sharedKey, sharedKey);
  console.log('  ✓ 读取凭证:', loaded!.peer.deviceName);

  // 4.3 列出已保存凭证
  const ids = listSavedPeerIds();
  assert.ok(ids.includes('mobile-test-001'), '已保存凭证列表应包含测试对端');
  console.log('  ✓ 列表:', ids);

  // 4.4 删除凭证
  removeCredential('mobile-test-001');
  const deleted = loadCredential('mobile-test-001');
  assert.equal(deleted, null, '删除后凭证应不存在');
  console.log('  ✓ 删除凭证: 通过');
}

// ==========================================
// Test Suite 5: 心跳模块
// ==========================================
function testHeartbeat() {
  console.log('\n[Test Suite 5] 心跳模块');

  const hb = new Heartbeat();
  let stateChanges: string[] = [];

  hb.on('stateChange', (state) => { stateChanges.push(state); });

  // 配置 ping 发送（不做实际发送）
  hb.setSendPing(() => { /* no-op */ });

  // 启动心跳
  hb.start();
  console.log('  ✓ 心跳启动');

  // 收到 pong
  hb.pongReceived();
  console.log('  ✓ Pong 处理');

  // 检查状态
  assert.equal(hb.maxAttempts, 3, '最大重连次数应为 3');
  assert.equal(hb.attemptCount, 0, '初始重连次数应为 0');

  hb.stop();
  console.log('  ✓ 心跳停止');
}

// ==========================================
// 主入口
// ==========================================
function main() {
  console.log('========================================');
  console.log('  comm/ 模块集成测试');
  console.log('========================================');
  console.log('Node.js 版本:', process.version);

  let passed = 0;
  let failed = 0;

  const tests = [
    testChunkProtocol,
    testCrypto,
    testPairing,
    testCredentialStorage,
    testHeartbeat,
  ];

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${test.name} 失败:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('\n========================================');
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');
}

main();
