/**
 * signaling/server.ts — 信令服务器（桌面端）
 *
 * 在指定端口启动 HTTP + WebSocket 混合服务器，负责：
 *   1. 提供 /pairing 端点查询配对信息
 *   2. WebSocket 信令通道（Offer/Answer/ICE 交换）
 *   3. 配对 Token 验证
 *   4. 交换 ECDH 公钥协商加密密钥
 *
 * 移动端通过扫描二维码获得 IP:Port，然后连接 WebSocket
 * 完成信令握手后，双方通过加密 TCP 通道传输音频数据。
 */

import * as http from 'node:http';
import { WSServer, WSConnection } from './ws';
import { createPairingToken, getPairingToken, consumePairingToken, generateQRContent } from './pairing';
import { generateECDHKeyPair, computeSharedSecret, sha256 } from '../crypto/utils';
import type { PeerInfo } from '../types';
import { EventEmitter } from 'node:events';

/** 信令事件 */
export interface SignalingEvents {
  /** 新对端配对完成 */
  peerPaired: (peer: PeerInfo, sharedKey: string) => void;
  /** 收到控制消息 */
  controlMessage: (peerId: string, msg: string) => void;
  /** 连接断开 */
  peerDisconnected: (peerId: string) => void;
  /** 错误 */
  error: (error: Error) => void;
}

/** 信令服务器 */
export class SignalingServer extends EventEmitter {
  private httpServer: http.Server;
  private wsServer: WSServer | null = null;
  private connections = new Map<string, WSConnection>();
  private peerKeys = new Map<string, string>(); // peerId → sharedKey(hex)
  private deviceId: string;
  private deviceName: string;

  constructor(
    private port: number,
    private localIp: string,
    private dataPort: number,
    private onEvent: Partial<SignalingEvents> = {},
  ) {
    super();
    this.deviceId = `desktop-${sha256(localIp + port).slice(0, 12)}`;
    this.deviceName = `AI录音助手`;
  }

  get deviceInfo(): { deviceId: string; deviceName: string; ip: string; port: number } {
    return { deviceId: this.deviceId, deviceName: this.deviceName, ip: this.localIp, port: this.port };
  }

  /** 获取当前最新的二维码内容 */
  get currentQRContent(): string {
    const token = createPairingToken(this.deviceId);
    return generateQRContent(
      this.deviceId, this.deviceName, this.localIp, this.port, this.dataPort,
      token.token, token.expiresAt,
    );
  }

  /** 启动信令服务器 */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        // HTTP 端点：用于健康检查和配对信息获取
        if (req.url === '/pairing') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({
            deviceId: this.deviceId,
            qrContent: this.currentQRContent,
          }));
        } else if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', deviceId: this.deviceId }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      // 附加 WebSocket
      this.wsServer = new WSServer(this.httpServer, (ws) => {
        this.handleWebSocket(ws);
      });

      this.httpServer.listen(this.port, '0.0.0.0', () => {
        resolve();
      });
    });
  }

  /** 处理 WebSocket 连接 */
  private handleWebSocket(ws: WSConnection): void {
    let peerId = '';
    let authenticated = false;
    let ecdhKeyPair = generateECDHKeyPair();
    let sharedKey = '';

    ws.on('message', (raw: string) => {
      try {
        const msg = JSON.parse(raw);

        switch (msg.type) {
          // ---- 配对请求：验证 Token + 交换公钥 ----
          case 'pair_request':
            peerId = msg.payload?.deviceId || 'unknown';
            const token = msg.payload?.token || '';
            const peerPubKey = msg.payload?.publicKey
              ? Buffer.from(msg.payload.publicKey, 'hex')
              : null;

            if (!validateConnectionToken(token, peerId)) {
              ws.send(JSON.stringify({ type: 'pair_response', status: 'rejected', reason: 'Token无效或已过期' }));
              ws.close();
              return;
            }

            // 验证通过 → 消费 Token + 计算共享密钥
            consumePairingToken(this.deviceId);
            if (peerPubKey) {
              const sharedSecret = computeSharedSecret(peerPubKey, ecdhKeyPair.privateKey);
              sharedKey = sha256(sharedSecret);
              this.peerKeys.set(peerId, sharedKey);
            }

            // 发送本机公钥和配对成功响应
            ws.send(JSON.stringify({
              type: 'pair_response',
              status: 'accepted',
              payload: {
                publicKey: ecdhKeyPair.publicKey.toString('hex'),
                deviceId: this.deviceId,
                deviceName: this.deviceName,
              },
            }));
            authenticated = true;

            // 通知上层
            const peerInfo: PeerInfo = msg.payload.peerInfo || { deviceId: peerId, deviceName: '手机端', deviceRole: 'mobile' as any, ipAddress: '', signalingPort: this.port, dataPort: this.dataPort };
            this.connections.set(peerId, ws);
            this.emit('peerPaired', peerInfo, sharedKey);
            this.onEvent.peerPaired?.(peerInfo, sharedKey);
            break;

          // ---- 通用控制消息 ----
          case 'control':
            if (!authenticated) return;
            this.emit('controlMessage', peerId, raw);
            this.onEvent.controlMessage?.(peerId, raw);
            break;

          // ---- 心跳响应 ----
          case 'pong':
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', reason: `未知消息类型: ${msg.type}` }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', reason: '消息解析失败' }));
      }
    });

    ws.on('close', () => {
      this.connections.delete(peerId);
      this.emit('peerDisconnected', peerId);
      this.onEvent.peerDisconnected?.(peerId);
    });

    ws.on('error', (err) => {
      this.emit('error', err);
      this.onEvent.error?.(err);
    });
  }

  /** 向指定对端发送消息 */
  sendToPeer(peerId: string, message: string): boolean {
    const ws = this.connections.get(peerId);
    if (!ws || ws.closed) return false;
    ws.send(message);
    return true;
  }

  /** 广播给所有已连接对端 */
  broadcast(message: string): void {
    for (const [id, ws] of this.connections) {
      if (!ws.closed) ws.send(message);
    }
  }

  /** 停止服务器 */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const ws of this.connections.values()) ws.close();
      this.connections.clear();
      this.peerKeys.clear();
      this.httpServer.close(() => resolve());
    });
  }

  /** 获取已连接对端数量 */
  get connectionCount(): number {
    return this.connections.size;
  }
}

/** 验证连接 Token */
function validateConnectionToken(token: string, peerId: string): boolean {
  return getPairingToken(peerId)?.token === token;
}
