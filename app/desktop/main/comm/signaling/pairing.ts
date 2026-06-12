/**
 * signaling/pairing.ts — 配对协议
 *
 * 负责：
 *   - 生成一次性配对 Token
 *   - 创建/解析二维码内容（JSON 字符串）
 *   - Token 验证和过期管理
 *   - 存储配对成功的对端信息
 *
 * 配对流程：
 *   1. 桌面端生成 PairingToken 并嵌入二维码
 *   2. 移动端扫码 → 解析出 IP:Port + Token
 *   3. 移动端携带 Token 连接信令服务器
 *   4. 服务器验证 Token → 交换加密密钥 → 配对完成
 *   5. 配对凭证持久化，下次自动连接
 */

import type { PairingToken, PairingQRContent, PeerInfo, DeviceRole } from '../types';
import { generateToken } from '../crypto/utils';
import { PAIRING_QR } from '../config';

/** 存储活跃的配对 Token（deviceId → PairingToken） */
const pendingTokens = new Map<string, PairingToken>();

/** 已配对设备信息（peerId → PeerInfo） */
export const pairedDevices = new Map<string, PeerInfo>();

/**
 * 创建新配对 Token
 *
 * @param deviceId - 本机设备 ID
 * @param expiryMs - 过期时间（毫秒），默认 5 分钟
 */
export function createPairingToken(deviceId: string, expiryMs: number = 300_000): PairingToken {
  const now = Date.now();
  const token: PairingToken = {
    token: generateToken(32),
    createdAt: now,
    expiresAt: now + expiryMs,
    used: false,
  };
  pendingTokens.set(deviceId, token);
  return token;
}

/** 获取指定设备当前的配对 Token */
export function getPairingToken(deviceId: string): PairingToken | undefined {
  const t = pendingTokens.get(deviceId);
  if (!t) return undefined;
  if (Date.now() > t.expiresAt || t.used) {
    pendingTokens.delete(deviceId);
    return undefined;
  }
  return t;
}

/** 将 Token 标记为已使用 */
export function consumePairingToken(deviceId: string): boolean {
  const t = pendingTokens.get(deviceId);
  if (!t || Date.now() > t.expiresAt) return false;
  t.used = true;
  pendingTokens.delete(deviceId);
  return true;
}

/** 验证 Token 是否有效 */
export function validateToken(deviceId: string, token: string): boolean {
  const t = getPairingToken(deviceId);
  return t !== undefined && t.token === token && !t.used;
}

// ---- 二维码内容 ----

/**
 * 生成配对二维码 JSON 字符串（UI 层将其渲染为 QR 码）
 *
 * @returns JSON 字符串，UI 渲染为二维码后供移动端扫描
 */
export function generateQRContent(
  deviceId: string,
  deviceName: string,
  ip: string,
  signalingPort: number,
  dataPort: number,
  token: string,
  expiresAt: number,
): string {
  const content: PairingQRContent = {
    type: PAIRING_QR.PROTOCOL_TYPE,
    version: PAIRING_QR.VERSION,
    deviceId,
    deviceName,
    ip,
    signalingPort,
    dataPort,
    token,
    expiresAt,
  };
  return JSON.stringify(content);
}

/** 解析二维码 JSON 内容 */
export function parseQRContent(json: string): PairingQRContent | null {
  try {
    const obj = JSON.parse(json);
    if (obj.type !== PAIRING_QR.PROTOCOL_TYPE || obj.version !== PAIRING_QR.VERSION) return null;
    if (Date.now() > obj.expiresAt) return null;
    return obj as PairingQRContent;
  } catch {
    return null;
  }
}

// ---- 已配对设备管理 ----

/** 记录配对成功的对端 */
export function addPairedDevice(peer: PeerInfo): void {
  pairedDevices.set(peer.deviceId, peer);
}

/** 获取所有已配对设备列表 */
export function getPairedDevices(): PeerInfo[] {
  return Array.from(pairedDevices.values());
}

/** 清理过期的配对 Token */
export function cleanExpiredTokens(): void {
  const now = Date.now();
  for (const [id, t] of pendingTokens) {
    if (now > t.expiresAt || t.used) pendingTokens.delete(id);
  }
}
