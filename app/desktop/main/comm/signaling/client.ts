/**
 * signaling/client.ts — 信令客户端（当桌面端作为"客户端"连接另一桌面端时使用）
 *
 * 通常情况下，桌面端是信令服务器（等待移动端连接）。
 * 此客户端用于桌面端作为"对等方"连接另一台桌面端或测试场景。
 *
 * 流程：
 *   1. 连接远程信令服务器的 WebSocket
 *   2. 发送配对请求（携带 Token + ECDH 公钥）
 *   3. 接收配对响应，提取共享密钥
 *   4. 保持连接用于后续控制消息交换
 */

import { WSClient } from './ws';
import { generateECDHKeyPair, computeSharedSecret, sha256 } from '../crypto/utils';
import { getPairingToken } from './pairing';
import { EventEmitter } from 'node:events';

export interface SignalingClientEvents {
  paired: (sharedKeyHex: string, serverDeviceId: string) => void;
  message: (msg: any) => void;
  disconnected: () => void;
  error: (err: Error) => void;
}

/** 信令客户端 */
export class SignalingClient extends EventEmitter {
  private ws: WSClient | null = null;
  private ecdh = generateECDHKeyPair();
  private _sharedKey = '';
  private _serverDeviceId = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private serverUrl: string,
    private localDeviceId: string,
    private onEvent: Partial<SignalingClientEvents> = {},
  ) {
    super();
  }

  /** 连接并执行配对 */
  async connect(token: string): Promise<void> {
    this.ws = new WSClient();
    this._sharedKey = '';
    this._serverDeviceId = '';

    await this.ws.connect(this.serverUrl);

    // 发送配对请求
    this.ws.send(JSON.stringify({
      type: 'pair_request',
      payload: {
        deviceId: this.localDeviceId,
        token,
        publicKey: this.ecdh.publicKey.toString('hex'),
        peerInfo: {
          deviceId: this.localDeviceId,
          deviceName: '桌面端',
          deviceRole: 'desktop',
        },
      },
    }));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('配对响应超时')), 15000);

      this.ws!.on('message', (raw: string) => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === 'pair_response') {
            clearTimeout(timeout);

            if (msg.status === 'rejected') {
              reject(new Error(`配对被拒绝: ${msg.reason}`));
              return;
            }

            // accepted: 计算共享密钥
            const peerPubKey = msg.payload?.publicKey;
            if (peerPubKey) {
              const sharedSecret = computeSharedSecret(
                Buffer.from(peerPubKey, 'hex'),
                this.ecdh.privateKey,
              );
              this._sharedKey = sha256(sharedSecret);
            }
            this._serverDeviceId = msg.payload?.deviceId || '';
            this.emit('paired', this._sharedKey, this._serverDeviceId);
            this.onEvent.paired?.(this._sharedKey, this._serverDeviceId);

            // 后续消息直接转发
            this.ws!.removeAllListeners('message');
            this.ws!.on('message', (m: string) => {
              this.emit('message', m);
              this.onEvent.message?.(JSON.parse(m));
            });

            resolve();
            return;
          }
        } catch { /* ignore parse errors */ }
      });

      this.ws!.on('error', reject);
    });
  }

  /** 发送控制消息 */
  send(msg: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** 启动心跳 */
  startHeartbeat(intervalMs: number = 30000): void {
    this.timer = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }, intervalMs);
  }

  /** 关闭连接 */
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  get sharedKey(): string { return this._sharedKey; }
  get serverDeviceId(): string { return this._serverDeviceId; }
  get connected(): boolean { return this.ws !== null && !this.ws.closed; }
}
