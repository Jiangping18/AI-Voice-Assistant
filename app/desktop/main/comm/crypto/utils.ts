/**
 * crypto/utils.ts — 加密/解密工具函数
 *
 * 使用 Node.js 内置 crypto 模块实现：
 *   - AES-256-GCM 加密（数据通道）
 *   - ECDHP256 密钥交换（配对阶段协商共享密钥）
 *   - Token / 密钥 生成
 */

import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;       // GCM 推荐 IV 长度
const AUTH_TAG_LENGTH = 16; // GCM 认证标签长度

// ---- 密钥生成 ----

/** 生成 256 位随机密钥，返回 hex 字符串 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** 生成安全随机 Token（默认 32 字节 hex = 64 字符） */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// ---- AES-256-GCM 加密 / 解密 ----

/** 加密：返回 { ciphertext, iv, authTag } */
export function encrypt(
  plaintext: Buffer,
  key: string | Buffer,
): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/** 解密：传入密文 + IV + 认证标签 → 明文（认证失败抛异常） */
export function decrypt(
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
  key: string | Buffer,
): Buffer {
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuf, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * 加密为线格式：iv(12) + authTag(16) + ciphertext，方便 TCP 透传。
 * 接收端用 decryptPacket() 还原。
 */
export function encryptPacket(plaintext: Buffer, key: string | Buffer): Buffer {
  const { ciphertext, iv, authTag } = encrypt(plaintext, key);
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** 解密 encryptPacket 打包的数据 */
export function decryptPacket(packet: Buffer, key: string | Buffer): Buffer {
  const iv = packet.subarray(0, IV_LENGTH);
  const authTag = packet.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packet.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  return decrypt(ciphertext, iv, authTag, key);
}

/** 加密后数据的前缀长度，用于读取时切分 */
export const ENCRYPTED_PACKET_HEADER_SIZE = IV_LENGTH + AUTH_TAG_LENGTH; // 28 字节

// ---- ECDH 密钥交换（配对阶段） ----

export interface ECDHKeyPair {
  publicKey: Buffer;
  privateKey: Buffer;
}

/** 生成 ECDH P-256 密钥对 */
export function generateECDHKeyPair(): ECDHKeyPair {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey(), privateKey: ecdh.getPrivateKey() };
}

/** 计算共享密钥（双方一致） */
export function computeSharedSecret(
  theirPublicKey: Buffer,
  myPrivateKey: Buffer,
): Buffer {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(myPrivateKey);
  return ecdh.computeSecret(theirPublicKey);
}

// ---- 通用哈希 ----

/** SHA-256 哈希（hex） */
export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
