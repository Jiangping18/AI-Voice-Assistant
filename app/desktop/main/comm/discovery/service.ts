/**
 * discovery/service.ts — 局域网设备发现服务
 *
 * 基于 UDP 多播实现 mDNS 风格的局域网发现。
 * 桌面端定期广播自身服务信息，移动端监听多播地址发现服务。
 *
 * 协议：
 *   - 多播地址：239.255.0.100
 *   - 端口：18522（可配置）
 *   - 广播间隔：5 秒
 *   - 数据格式：JSON over UDP，单包不超过 1024 字节
 *
 * 发出的 DiscoveryPacket：
 *   {
 *     "deviceId": "desktop-a1b2c3",
 *     "deviceName": "AI录音助手",
 *     "deviceRole": "desktop",
 *     "ip": "192.168.1.100",
 *     "signalingPort": 18520,
 *     "dataPort": 18521,
 *     "protocolVersion": 1
 *   }
 */

import * as dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { DEFAULT_COMM_CONFIG, PROTOCOL_VERSION } from '../config';
import type { DiscoveryPacket, DeviceRole, PeerInfo } from '../types';

/** 多播组地址 */
const MULTICAST_ADDR = '239.255.0.100';

export interface DiscoveryEvents {
  peerDiscovered: (peer: PeerInfo) => void;
  peerLost: (deviceId: string) => void;
  error: (error: Error) => void;
}

/** 发现服务 */
export class DiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private knownPeers = new Map<string, { peer: PeerInfo; lastSeen: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private deviceId = '';
  private deviceName = '';
  private ip = '';
  private serviceActive = false;

  constructor(
    private port: number = DEFAULT_COMM_CONFIG.discoveryPort,
    private signalingPort: number = DEFAULT_COMM_CONFIG.signalingPort,
    private dataPort: number = DEFAULT_COMM_CONFIG.dataPort,
    private onEvent?: Partial<DiscoveryEvents>,
  ) {
    super();
    if (onEvent) {
      if (onEvent.peerDiscovered) this.on('peerDiscovered', onEvent.peerDiscovered);
      if (onEvent.error) this.on('error', onEvent.error);
    }
  }

  /**
   * 启动发现服务（桌面端启动器，监听 + 广播）
   *
   * @param deviceId - 本机设备 ID
   * @param deviceName - 本机设备名称
   * @param localIp - 本机局域网 IP
   */
  async start(deviceId: string, deviceName: string, localIp: string): Promise<void> {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.ip = localIp;
    this.serviceActive = true;

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        this.onEvent?.error?.(err);
      });

      this.socket.on('message', (msg, rinfo) => {
        this._handleDiscoveryMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        this.socket!.addMembership(MULTICAST_ADDR);
        this.socket!.setBroadcast(true);

        // 启动定期广播
        this.broadcastTimer = setInterval(() => {
          this._broadcastPresence();
        }, DEFAULT_COMM_CONFIG.discoveryIntervalMs);

        // 启动清理定时器（30 秒未收到广播的设备标记为失联）
        this.cleanupTimer = setInterval(() => {
          this._cleanupStalePeers();
        }, 30000);

        resolve();
      });

      this.socket.bind(this.port, () => {
        // bind 回调可能在 listening 之后
      });
    });
  }

  /** 发送本机存在广播 */
  private _broadcastPresence(): void {
    if (!this.socket || !this.serviceActive) return;

    const packet: DiscoveryPacket = {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceRole: 'desktop' as DeviceRole,
      ip: this.ip,
      signalingPort: this.signalingPort,
      dataPort: this.dataPort,
      protocolVersion: PROTOCOL_VERSION,
    };

    const buf = Buffer.from(JSON.stringify(packet));
    this.socket.send(buf, 0, buf.length, this.port, MULTICAST_ADDR);
  }

  /** 处理收到的发现消息 */
  private _handleDiscoveryMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const packet: DiscoveryPacket = JSON.parse(msg.toString('utf-8'));

      // 忽略自己的广播
      if (packet.deviceId === this.deviceId) return;

      const peer: PeerInfo = {
        deviceId: packet.deviceId,
        deviceName: packet.deviceName,
        deviceRole: packet.deviceRole || 'mobile' as DeviceRole,
        ipAddress: rinfo.address,
        signalingPort: packet.signalingPort,
        dataPort: packet.dataPort,
      };

      const now = Date.now();
      const existing = this.knownPeers.get(packet.deviceId);

      if (!existing) {
        // 新对端发现
        this.knownPeers.set(packet.deviceId, { peer, lastSeen: now });
        this.emit('peerDiscovered', peer);
        this.onEvent?.peerDiscovered?.(peer);
      } else {
        existing.lastSeen = now;
      }
    } catch {
      // 忽略无法解析的包
    }
  }

  /** 清理失联设备（30 秒未更新） */
  private _cleanupStalePeers(): void {
    const now = Date.now();
    const timeout = 30000;

    for (const [id, entry] of this.knownPeers) {
      if (now - entry.lastSeen > timeout) {
        this.knownPeers.delete(id);
        this.emit('peerLost', id);
        this.onEvent?.peerLost?.(id);
      }
    }
  }

  /** 获取已发现的所有对端 */
  getDiscoveredPeers(): PeerInfo[] {
    return Array.from(this.knownPeers.values()).map(e => e.peer);
  }

  /** 停止发现服务 */
  stop(): void {
    this.serviceActive = false;
    if (this.broadcastTimer) { clearInterval(this.broadcastTimer); this.broadcastTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    if (this.socket) {
      try {
        this.socket.dropMembership(MULTICAST_ADDR);
      } catch { /* ignore */ }
      this.socket.close();
      this.socket = null;
    }
    this.knownPeers.clear();
  }
}
