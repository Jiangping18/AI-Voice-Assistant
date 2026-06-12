/**
 * signaling/ws.ts — 轻量 WebSocket 实现（RFC 6455）
 *
 * 纯 Node.js 内置模块（无需 ws 包）。
 * 支持：握手 / 文本帧编码 / Ping-Pong / 正常关闭。
 * 仅用于局域网内信令交换，不做大数据量传输。
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x01, OP_CLOSE = 0x08, OP_PING = 0x09, OP_PONG = 0x0a;

// ---- 帧编解码 ----

function createFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  const extLen = payload.length < 126 ? 0 : payload.length < 65536 ? 2 : 8;
  const maskLen = masked ? 4 : 0;
  const header = 2 + extLen + maskLen;
  const frame = Buffer.alloc(header + payload.length);

  frame[0] = 0x80 | opcode;
  let off = 2;
  if (payload.length < 126) {
    frame[1] = (masked ? 0x80 : 0) | payload.length;
  } else if (payload.length < 65536) {
    frame[1] = (masked ? 0x80 : 0) | 126;
    frame.writeUInt16BE(payload.length, off); off += 2;
  } else {
    frame[1] = (masked ? 0x80 : 0) | 127;
    frame.writeBigUInt64BE(BigInt(payload.length), off); off += 8;
  }

  if (masked) {
    const mask = crypto.randomBytes(4);
    mask.copy(frame, off); off += 4;
    for (let i = 0; i < payload.length; i++) frame[off + i] = payload[i] ^ mask[i % 4];
  } else {
    payload.copy(frame, off);
  }
  return frame;
}

function parseFrame(data: Buffer): { opcode: number; payload: Buffer } | null {
  if (data.length < 2) return null;
  const opcode = data[0] & 0x0f;
  const masked = (data[1] & 0x80) !== 0;
  let len = data[1] & 0x7f;
  let off = 2;

  if (len === 126) { len = data.readUInt16BE(off); off += 2; }
  else if (len === 127) { len = Number(data.readBigUInt64BE(off)); off += 8; }

  let maskKey: Buffer | null = null;
  if (masked) { maskKey = data.subarray(off, off + 4); off += 4; }

  let payload = data.subarray(off, off + len);
  if (masked && maskKey) {
    payload = Buffer.from(payload); // copy
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }
  return { opcode, payload };
}

// ---- 连接封装 ----

export class WSConnection extends EventEmitter {
  private socket: any;
  private _closed = false;
  /** 累积未完整解析的字节 */
  private buf = Buffer.alloc(0);

  constructor(socket: any, public role: 'server' | 'client' = 'server') {
    super();
    this.socket = socket;
    socket.on('data', (d: Buffer) => this._onData(d));
    socket.on('close', () => { this._closed = true; this.emit('close'); });
    socket.on('error', (e: Error) => this.emit('error', e));
  }

  private _onData(data: Buffer): void {
    this.buf = Buffer.concat([this.buf, data]);
    while (true) {
      const frame = parseFrame(this.buf);
      if (!frame) break;
      const maskLen = (this.buf[1] & 0x80) ? 4 : 0;
      const payloadLen = this.buf[1] & 0x7f;
      const headerLen = 2 + (payloadLen < 126 ? 0 : payloadLen === 126 ? 2 : 8) + maskLen + frame.payload.length;
      this.buf = this.buf.subarray(headerLen);

      switch (frame.opcode) {
        case OP_TEXT: this.emit('message', frame.payload.toString('utf-8')); break;
        case OP_CLOSE: this.close(); break;
        case OP_PING: this._sendFrame(OP_PONG, Buffer.alloc(0)); break;
        case OP_PONG: this.emit('pong'); break;
      }
    }
  }

  private _sendFrame(opcode: number, payload: Buffer): void {
    if (this._closed) return;
    try { this.socket.write(createFrame(opcode, payload, this.role === 'client')); }
    catch { /* ignore */ }
  }

  send(data: string): void { this._sendFrame(OP_TEXT, Buffer.from(data, 'utf-8')); }
  sendPing(): void { this._sendFrame(OP_PING, Buffer.alloc(0)); }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this._sendFrame(OP_CLOSE, Buffer.alloc(0));
      this.socket.end();
    } catch { /* ignore */ }
    this.emit('close');
  }

  get closed(): boolean { return this._closed; }
}

// ---- 服务器 ----

export class WSServer {
  private server: http.Server;

  constructor(server: http.Server, public onConnection: (ws: WSConnection) => void) {
    this.server = server;
    server.on('upgrade', (req, socket, head) => {
      const key = req.headers['sec-websocket-key'] as string;
      if (!key) { socket.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      this.onConnection(new WSConnection(socket, 'server'));
    });
  }
}

// ---- 客户端 ----

export class WSClient extends EventEmitter {
  private socket: any;
  private _ws: WSConnection | null = null;
  private _closed = true;

  connect(url: string): Promise<void> {
    const u = new URL(url);
    const port = parseInt(u.port, 10) || 80;
    return new Promise((resolve, reject) => {
      const net = require('node:net');
      this.socket = net.connect(port, u.hostname, () => {
        const key = crypto.randomBytes(16).toString('base64');
        this.socket.write(
          `GET ${u.pathname || '/'} HTTP/1.1\r\n` +
          `Host: ${u.hostname}:${port}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });

      let buf = Buffer.alloc(0);
      this.socket.on('data', (data: Buffer) => {
        if (this._ws) {
          // Already upgraded — relay to connection
          (this._ws as any).buf = Buffer.concat([(this._ws as any).buf, data]);
          return;
        }
        buf = Buffer.concat([buf, data]);
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const status = buf.toString('utf-8', 0, buf.indexOf('\r\n'));
        if (!status.includes('101')) {
          reject(new Error(`WS upgrade failed: ${status}`));
          return;
        }
        this._closed = false;
        this._ws = new WSConnection(this.socket, 'client');
        // Forward events
        this._ws.on('message', (m: string) => this.emit('message', m));
        this._ws.on('close', () => { this._closed = true; this.emit('close'); });
        this._ws.on('error', (e: Error) => this.emit('error', e));
        this._ws.on('pong', () => this.emit('pong'));
        // Handle remaining data
        const rest = buf.subarray(end + 4);
        if (rest.length > 0) (this._ws as any).buf = rest;
        resolve();
      });

      this.socket.on('error', reject);
      this.socket.on('close', () => { this._closed = true; this.emit('close'); });
    });
  }

  send(data: string): void { this._ws?.send(data); }
  sendPing(): void { this._ws?.sendPing(); }
  close(): void { this._ws?.close(); this.socket?.end(); }
  get closed(): boolean { return this._closed; }
}
