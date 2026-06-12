/**
 * storage/credential.ts — 加密凭证存储
 *
 * 负责：
 *   1. 配对成功后存储对端加密凭证（对端信息 + 共享密钥）
 *   2. 应用下次启动时读取凭证，尝试自动连接
 *   3. 凭证文件使用 AES-256-GCM 加密存储（主密钥派生自机器特征）
 *
 * 存储路径：{appData}/credentials/{peerId}.json.enc
 * 主密钥：SHA-256(MAC地址 + 应用Salt)
 *
 * 安全性：
 *   - 凭证文件加密存储，即使文件泄露也无法解密
 *   - 主密钥不落盘，运行时从机器特征派生
 *   - 支持吊销单个对端凭证
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { encryptPacket, decryptPacket, sha256, generateToken } from '../crypto/utils';
import type { PeerInfo } from '../types';

/** 凭证存储目录名 */
const CREDENTIAL_DIR = 'credentials';

/** 保存的凭证结构 */
interface StoredCredential {
  peer: PeerInfo;
  sharedKey: string;       // hex 编码的共享密钥
  pairedAt: number;        // 配对时间戳
  lastConnectedAt: number; // 最后连接时间
}

/**
 * 获取应用数据根目录
 * 优先用户配置，默认 ~/.ai-voice-assistant
 */
function getAppDataDir(): string {
  return process.env.AI_VOICE_APP_DATA || path.join(os.homedir(), '.ai-voice-assistant');
}

/** 获取凭证存储目录 */
function getCredentialDir(): string {
  return path.join(getAppDataDir(), CREDENTIAL_DIR);
}

/** 获取本机主密钥（基于 MAC 地址 + Salt 派生） */
function getMasterKey(): string {
  const interfaces = os.networkInterfaces();
  let mac = 'unknown';
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name]?.[0];
    if (iface && !iface.internal && iface.mac !== '00:00:00:00:00:00') {
      mac = iface.mac;
      break;
    }
  }
  // Salt: 预定义的固定盐值，结合 MAC + Salt 派生唯一密钥
  const salt = 'ai-voice-assistant-v1-credential-salt';
  return sha256(mac + salt);
}

/** 确保凭证目录存在 */
function ensureDir(): void {
  const dir = getCredentialDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 获取凭证文件路径 */
function credentialFilePath(peerId: string): string {
  return path.join(getCredentialDir(), `${peerId}.json.enc`);
}

// ---- 公开 API ----

/**
 * 保存对端凭证
 *
 * @param peer - 对端信息
 * @param sharedKey - 共享密钥（hex）
 */
export function saveCredential(peer: PeerInfo, sharedKey: string): void {
  ensureDir();
  const masterKey = getMasterKey();
  const credential: StoredCredential = {
    peer,
    sharedKey,
    pairedAt: Date.now(),
    lastConnectedAt: Date.now(),
  };

  const plaintext = Buffer.from(JSON.stringify(credential, null, 2));
  const encrypted = encryptPacket(plaintext, masterKey);
  fs.writeFileSync(credentialFilePath(peer.deviceId), encrypted);
}

/**
 * 读取对端凭证
 *
 * @returns 如果凭证存在且可解密则返回 StoredCredential，否则 null
 */
export function loadCredential(peerId: string): StoredCredential | null {
  const filePath = credentialFilePath(peerId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const masterKey = getMasterKey();
    const encrypted = fs.readFileSync(filePath);
    const plaintext = decryptPacket(encrypted, masterKey);
    return JSON.parse(plaintext.toString('utf-8')) as StoredCredential;
  } catch {
    // 解密失败（密钥变化或文件损坏），删除无效凭证
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return null;
  }
}

/**
 * 获取所有已保存凭证的对端 ID 列表
 */
export function listSavedPeerIds(): string[] {
  const dir = getCredentialDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json.enc'))
    .map(f => f.replace('.json.enc', ''));
}

/**
 * 更新最后连接时间
 */
export function updateLastConnected(peerId: string): void {
  const cred = loadCredential(peerId);
  if (cred) {
    cred.lastConnectedAt = Date.now();
    saveCredential(cred.peer, cred.sharedKey);
  }
}

/**
 * 删除对端凭证（吊销）
 */
export function removeCredential(peerId: string): void {
  const filePath = credentialFilePath(peerId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * 获取所有已保存的凭证列表
 */
export function getAllCredentials(): { peerId: string; peerName: string; lastConnectedAt: number }[] {
  return listSavedPeerIds().map(id => {
    const cred = loadCredential(id);
    return {
      peerId: id,
      peerName: cred?.peer.deviceName || '未知设备',
      lastConnectedAt: cred?.lastConnectedAt || 0,
    };
  }).filter(c => c.lastConnectedAt > 0);
}
