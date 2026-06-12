# 智能体2 — 局域网 P2P 通信模块 外部接口规范

> 文档版本: 1.0.0  
> 最后更新: 2026-06-12  
> 所属模块: `app/desktop/main/comm/`（桌面端，TypeScript / Electron）  
> 序列化: JSON (UTF-8) / 二进制加密包  
> 零外部依赖: 仅使用 Node.js 内置模块（http / crypto / net / dgram / zlib）

---

## 目录

| 接口编号 | 名称 | 传输层 | 方向 |
|----------|------|--------|------|
| [CMM-01](#cmm-01) | HTTP 端点（配对/健康） | HTTP 1.1 | 桌面端 → 移动端 |
| [CMM-02](#cmm-02) | WebSocket 信令协议 | WS (RFC 6455) | 双向 |
| [CMM-03](#cmm-03) | TCP 加密数据通道 | TCP (AES-256-GCM) | 双向（移动端→桌面端为主） |
| [CMM-04](#cmm-04) | UDP 多播发现协议 | UDP 多播 | 桌面端广播 |
| [CMM-05](#cmm-05) | 音频分片线格式 | 二进制 | 数据通道内部 |
| [CMM-06](#cmm-06) | 配对二维码内容 | JSON 字符串 | 桌面端 → 移动端(扫码) |
| [CMM-07](#cmm-07) | CommEngine 类 API | TypeScript | 进程内调用(桌面端内部) |
| [CMM-08](#cmm-08) | 事件回调接口 | EventEmitter | 进程内(桌面端 → UI) |
| [CMM-09](#cmm-09) | 配置参数 | TypeScript | 进程内 |
| [CMM-10](#cmm-10) | 音频编码规范 | — | 所有通道使用 |
| [CMM-11](#cmm-11) | 凭证存储格式 | 文件(AES-encrypted) | 桌面端本地 |

---

## CMM-01: HTTP 端点（配对/健康）

桌面端信令服务器在 `{signalingPort}` 端口提供以下 HTTP 端点。

### GET /pairing — 配对信息

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "配对信息响应",
  "description": "移动端通过 HTTP 获取当前配对二维码内容。桌面端返回包含设备信息和二维码 JSON 的响应。",
  "transport": "HTTP GET",
  "url": "http://{桌面端IP}:18520/pairing",
  "response": {
    "type": "object",
    "required": ["deviceId", "qrContent"],
    "properties": {
      "deviceId": {
        "type": "string",
        "description": "桌面端唯一设备 ID，由 IP+端口 SHA-256 前 12 字符生成",
        "example": "desktop-a1b2c3d4e5f6"
      },
      "qrContent": {
        "type": "string",
        "description": "配对二维码 JSON 字符串，UI 层渲染为 QR 码供移动端扫描。内容格式见 CMM-06",
        "example": "{\"type\":\"ai-voice-assistant-pairing\",\"version\":1,\"deviceId\":\"desktop-...\",...}"
      }
    }
  }
}
```

### GET /health — 健康检查

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "健康检查响应",
  "description": "简单的存活探测端点",
  "transport": "HTTP GET",
  "url": "http://{桌面端IP}:18520/health",
  "response": {
    "type": "object",
    "required": ["status", "deviceId"],
    "properties": {
      "status": { "type": "string", "enum": ["ok"], "description": "服务状态" },
      "deviceId": { "type": "string", "description": "桌面端设备 ID" }
    }
  }
}
```

---

## CMM-02: WebSocket 信令协议

### 2.1 连接建立

移动端通过扫描二维码获取 `ws://{ip}:{signalingPort}/`，发起 RFC 6455 WebSocket 握手。

### 2.2 消息类型

所有 WS 消息均为 JSON 文本帧。消息通用外壳：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "WS 消息通用外壳",
  "type": "object",
  "required": ["type"],
  "properties": {
    "type": {
      "type": "string",
      "enum": ["pair_request", "pair_response", "control", "ping", "pong", "error"],
      "description": "消息类型标识"
    },
    "payload": {
      "type": "object",
      "description": "消息载荷（可选，控制消息时必填）"
    },
    "messageId": {
      "type": "string",
      "description": "消息唯一 ID（control 类型时必填）"
    },
    "controlType": {
      "type": "string",
      "description": "控制指令类型（type='control' 时必填），枚举值见 CMM-02.4"
    },
    "timestamp": {
      "type": "number",
      "description": "Unix 毫秒时间戳"
    }
  }
}
```

### 2.3 配对协议

#### 移动端 → 桌面端: `pair_request`

```json
{
  "type": "pair_request",
  "payload": {
    "type": "object",
    "required": ["deviceId", "token", "publicKey"],
    "properties": {
      "deviceId": {
        "type": "string",
        "description": "移动端设备 ID",
        "example": "mobile-xxxx"
      },
      "token": {
        "type": "string",
        "description": "一次性配对 Token（从二维码获取，32 字节 hex）",
        "example": "a1b2c3d4e5f6..."
      },
      "publicKey": {
        "type": "string",
        "description": "移动端 ECDH P-256 公钥（hex 编码），用于密钥交换",
        "example": "04b5c6d7e8f9..."
      },
      "peerInfo": {
        "type": "object",
        "description": "对端设备信息（可选，用于注册对端名称）",
        "properties": {
          "deviceId": { "type": "string" },
          "deviceName": { "type": "string" },
          "deviceRole": { "type": "string", "enum": ["mobile", "desktop"] }
        }
      }
    }
  }
}
```

#### 桌面端 → 移动端: `pair_response` (成功)

```json
{
  "type": "pair_response",
  "status": "accepted",
  "payload": {
    "type": "object",
    "required": ["publicKey", "deviceId", "deviceName"],
    "properties": {
      "publicKey": {
        "type": "string",
        "description": "桌面端 ECDH P-256 公钥（hex），移动端用其计算共享密钥",
        "example": "04f0e1d2c3b4..."
      },
      "deviceId": { "type": "string", "description": "桌面端设备 ID" },
      "deviceName": { "type": "string", "description": "桌面端设备名称" }
    }
  }
}
```

#### 桌面端 → 移动端: `pair_response` (拒绝)

```json
{
  "type": "pair_response",
  "status": "rejected",
  "reason": {
    "type": "string",
    "description": "拒绝原因",
    "examples": ["Token无效或已过期", "Token已被使用"]
  }
}
```

### 2.4 控制消息协议

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "控制消息",
  "description": "信令通道建立后，双向传输的控制指令和状态同步消息",
  "type": "object",
  "required": ["type", "messageId", "timestamp", "controlType"],
  "properties": {
    "type": { "type": "string", "const": "control", "description": "固定标识" },
    "messageId": {
      "type": "string",
      "description": "消息唯一 ID（格式 ctrl-{timestamp}-{seqId}），用于去重",
      "example": "ctrl-1747128000000-1"
    },
    "timestamp": { "type": "number", "description": "Unix 毫秒时间戳" },
    "controlType": {
      "type": "string",
      "description": "指令类型",
      "enum": [
        "start_recording",    "stop_recording",    "start_transcribe",
        "state_update",       "audio_meta",        "audio_start",
        "audio_chunk",        "audio_complete",    "pairing_request",
        "pairing_response",   "error"
      ]
    },
    "payload": {
      "type": "object",
      "description": "指令载荷，根据 controlType 不同而变化"
    }
  }
}
```

#### 各 controlType 的 payload 定义

| controlType | 方向 | payload 字段 | 说明 |
|-------------|------|-------------|------|
| `start_recording` | PC→手机 | `{}` | 通知对端开始录音 |
| `stop_recording` | PC→手机 | `{}` | 通知对端停止录音 |
| `start_transcribe` | PC→手机 | `{ audioId?: string }` | 通知对端开始转写 |
| `state_update` | 双向 | `{ type, state, detail? }` | 状态同步（见 CMM-02.5） |
| `audio_meta` | 手机→PC | `{ audio_id, duration, timestamp, sampleRate, bitsPerSample, channels }` | 音频元信息（见 CMM-02.6） |
| `audio_complete` | 手机→PC | `{ audioId, totalBytes, totalChunks, duration }` | 音频传输完成标记 |
| `error` | 双向 | `{ reason: string }` | 错误信息 |

### 2.5 `state_update` 状态更新载荷

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StateUpdatePayload",
  "type": "object",
  "required": ["type", "state"],
  "properties": {
    "type": {
      "type": "string",
      "enum": ["status", "error"],
      "description": "消息类型，status=正常状态变更，error=异常"
    },
    "state": {
      "type": "string",
      "enum": ["idle", "listening", "recording", "error", "transcribing", "completed"],
      "description": "当前工作状态。idle=空闲, listening=监听中, recording=录音中, error=异常, transcribing=转写中, completed=完成"
    },
    "detail": {
      "type": "string",
      "description": "附加详情。recording→listening 时携带 'segment_end'；error 时携带错误原因",
      "examples": ["", "start", "segment_end", "VAD 引擎异常"]
    }
  }
}
```

### 2.6 `audio_meta` 音频元信息载荷

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AudioMetaPayload",
  "description": "符合 IF-03 接口规范的音频元信息",
  "type": "object",
  "required": ["audio_id", "duration", "timestamp"],
  "properties": {
    "audio_id": {
      "type": "string",
      "description": "音频文件唯一标识（UUID）",
      "example": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    },
    "duration": {
      "type": "number",
      "description": "音频时长（秒）",
      "minimum": 0,
      "example": 125.3
    },
    "timestamp": {
      "type": "string",
      "description": "ISO 8601 格式时间戳",
      "example": "2026-06-12T15:30:00.000Z"
    },
    "sampleRate": {
      "type": "integer",
      "const": 16000,
      "description": "采样率，固定 16000Hz"
    },
    "bitsPerSample": {
      "type": "integer",
      "const": 16,
      "description": "位深，固定 16bit"
    },
    "channels": {
      "type": "integer",
      "const": 1,
      "description": "声道数，固定单声道"
    }
  }
}
```

### 2.7 Ping / Pong（内置在 WS 层）

WS 层（ws.ts）自动处理 `OP_PING` / `OP_PONG` 帧：
- 桌面端收到 Ping → 自动回复 Pong（底层 RFC 6455 机制）
- 心跳模块每秒发送应用层 Ping JSON：`{"type":"ping","timestamp":1747128000000}`
- 对端应答 Pong JSON：`{"type":"pong","timestamp":1747128000000}`

### 2.8 错误消息

```json
{
  "type": "error",
  "reason": {
    "type": "string",
    "description": "错误描述",
    "examples": ["未知消息类型: xxx", "消息解析失败", "Token无效或已过期"]
  }
}
```

---

## CMM-03: TCP 加密数据通道

### 3.1 通道建立

1. 配对成功后（ECDH 密钥交换完成），移动端向桌面端 `dataPort`（默认 18521）发起 TCP 连接
2. 桌面端 TransportManager 接受连接，使用配对阶段协商的共享密钥进行 AES-256-GCM 加密通信

### 3.2 线格式

```
[4字节 包体长度:UInt32BE][加密包体: 变长]
└──────── 大端网络字节序 ────────┘
```

加密包体结构：

```
[12字节 IV][16字节 AuthTag][密文: 变长]
└──────── RSA-256-GCM 密文 ──────────┘
```

| 字段 | 长度 | 描述 |
|------|------|------|
| 包体长度 | 4 字节 | UInt32BE，加密包体总字节数（不含本字段） |
| IV | 12 字节 | AES-GCM 初始化向量，每次加密随机生成 |
| AuthTag | 16 字节 | GCM 认证标签，用于完整性验证 |
| 密文 | 变长 | 实际加密数据（JSON 控制包 或 序列化分片） |

### 3.3 支持的包类型（解密后）

| 首字节 | 类型 | 描述 |
|--------|------|------|
| `0x7b` (`{`) | JSON 控制包 | 控制消息或元信息，内容为 JSON 字符串 |
| 其他 | 二进制分片包 | 序列化的 AudioChunk（见 CMM-05） |

### 3.4 JSON 控制包（在加密数据通道中传输）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "数据通道控制包",
  "description": "在加密 TCP 数据通道中传输的 JSON 格式控制消息，通过首字节 '{' 区分",
  "types": {
    "audio_complete": {
      "description": "音频文件所有分片发送完毕后发送的完成标记",
      "type": "object",
      "required": ["type", "audioId", "totalBytes", "totalChunks"],
      "properties": {
        "type": { "type": "string", "const": "audio_complete" },
        "audioId": { "type": "string", "description": "音频文件 ID" },
        "totalBytes": { "type": "integer", "description": "音频总字节数" },
        "totalChunks": { "type": "integer", "description": "总分片数" },
        "duration": { "type": "number", "description": "音频时长（秒）" }
      }
    },
    "audio_meta": {
      "description": "音频元信息（创建接收任务）",
      "type": "object",
      "required": ["type", "audioId", "totalBytes", "totalChunks"],
      "properties": {
        "type": { "type": "string", "const": "audio_meta" },
        "audioId": { "type": "string" },
        "totalBytes": { "type": "integer" },
        "totalChunks": { "type": "integer" }
      }
    }
  }
}
```

---

## CMM-04: UDP 多播发现协议

### 4.1 多播参数

| 参数 | 值 |
|------|-----|
| 多播地址 | `239.255.0.100` |
| 端口 | 18522（可配置 `discoveryPort`） |
| 协议 | UDP IPv4 |
| 广播间隔 | 5 秒（可配置 `discoveryIntervalMs`） |
| 失联超时 | 30 秒未收到广播即标记失联 |
| 包大小 | JSON 文本，通常 < 512 字节 |

### 4.2 DiscoveryPacket 格式

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DiscoveryPacket",
  "description": "桌面端通过 UDP 多播定期广播的发现包，移动端监听发现服务",
  "type": "object",
  "required": ["deviceId", "deviceName", "deviceRole", "ip", "signalingPort", "dataPort", "protocolVersion"],
  "properties": {
    "deviceId": {
      "type": "string",
      "description": "设备唯一 ID",
      "example": "desktop-a1b2c3d4e5f6"
    },
    "deviceName": {
      "type": "string",
      "description": "设备显示名称",
      "example": "AI录音助手"
    },
    "deviceRole": {
      "type": "string",
      "enum": ["desktop", "mobile"],
      "description": "设备角色"
    },
    "ip": {
      "type": "string",
      "description": "设备局域网 IP 地址",
      "example": "192.168.1.100"
    },
    "signalingPort": {
      "type": "integer",
      "description": "信令端口（HTTP + WebSocket）",
      "default": 18520
    },
    "dataPort": {
      "type": "integer",
      "description": "加密数据通道端口",
      "default": 18521
    },
    "protocolVersion": {
      "type": "integer",
      "const": 1,
      "description": "协议版本号"
    }
  }
}
```

---

## CMM-05: 音频分片线格式

### 5.1 分片参数

| 参数 | 值 |
|------|-----|
| 单分片最大数据负载 | 65,536 字节（64KB） |
| 固定头部大小 | 26 字节（不含 audioId 和 data） |
| audioId 最大长度 | 64 字节（UTF-8） |
| 字节序 | Big-Endian（网络字节序） |

### 5.2 序列化格式

```
[chunkId:4][audioIdLen:2][audioId:变长][offset:8][timestamp:8][crc32:4][data:变长]
```

| 字段 | 类型 | 长度 | 说明 |
|------|------|------|------|
| chunkId | UInt32BE | 4 字节 | 分片全局序号，从 0 单调递增 |
| audioIdLen | UInt16BE | 2 字节 | 音频 ID 字符串 UTF-8 字节长度 |
| audioId | UTF-8 | 0~64 字节 | 音频文件唯一标识 |
| offset | UInt64BE | 8 字节 | 该分片在原始音频文件中的字节偏移 |
| timestamp | UInt64BE | 8 字节 | 发送端 Unix 毫秒时间戳 |
| crc32 | UInt32BE | 4 字节 | 仅对 data 字段的 CRC32 校验值（无符号） |
| data | 原始字节 | 0~65536 字节 | 音频分片数据 |

### 5.3 反序列化过程

```typescript
function deserializeChunk(buf: Buffer): AudioChunk {
  let off = 0;
  const chunkId   = buf.readUInt32BE(off);  off += 4;
  const idLen     = buf.readUInt16BE(off);  off += 2;
  const audioId   = buf.toString('utf-8', off, off + idLen); off += idLen;
  const offset    = Number(buf.readBigUInt64BE(off)); off += 8;
  const timestamp = Number(buf.readBigUInt64BE(off)); off += 8;
  const crc       = buf.readUInt32BE(off);  off += 4;
  const data      = Buffer.from(buf.subarray(off));
  return { chunkId, audioId, offset, data, timestamp, crc32: crc, isRetransmission: false };
}
```

### 5.4 CRC32 校验

使用 `zlib.crc32()` 计算，返回无符号 32 位整数：

```typescript
function crc32(data: Buffer): number {
  return zlib.crc32(data) >>> 0;
}
function verifyChunkCRC(chunk: AudioChunk): boolean {
  return crc32(chunk.data) === chunk.crc32;
}
```

### 5.5 分片/重组

| 操作 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `splitBuffer(data, audioId, chunkSize)` | 完整 Buffer | `AudioChunk[]` | 按 chunkSize（默认 64KB）切分，每片携带相同 audioId |
| `reassemble(chunks)` | `AudioChunk[]` | Buffer | 按 chunkId 排序、合并为完整 Buffer |
| `getMissingIds(total, received)` | 总片数, 已收 Set | `number[]` | 计算缺失分片序号（断点续传用） |
| `computeProgress(...)` | 统计参数 | `TransferProgress` | 计算传输进度百分比和速率 |

### 5.6 断点续传

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "断点续传协议",
  "description": "接收端记录已收到的分片 chunkId，传输中断后可通知发送端重发缺失分片",
  "resumeRequest": {
    "type": "object",
    "required": ["audioId", "receivedChunkIds"],
    "properties": {
      "audioId": { "type": "string", "description": "音频文件 ID" },
      "receivedChunkIds": {
        "type": "array",
        "items": { "type": "integer" },
        "description": "已成功接收的分片序号列表（排序后）"
      }
    }
  },
  "resumeResponse": {
    "type": "object",
    "required": ["audioId", "missingChunkIds"],
    "properties": {
      "audioId": { "type": "string" },
      "missingChunkIds": {
        "type": "array",
        "items": { "type": "integer" },
        "description": "需要重发的分片序号列表"
      }
    }
  }
}
```

### 5.7 传输进度模型

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TransferProgress",
  "description": "音频传输进度，用于前端进度条展示",
  "type": "object",
  "required": ["audioId", "totalBytes", "transferredBytes", "percent", "state", "speedBps"],
  "properties": {
    "audioId": { "type": "string", "description": "音频文件 ID" },
    "totalBytes": { "type": "integer", "description": "音频总字节数" },
    "transferredBytes": { "type": "integer", "description": "已传输字节数" },
    "totalChunks": { "type": "integer", "description": "总分片数" },
    "completedChunks": { "type": "integer", "description": "已完成分片数" },
    "percent": { "type": "integer", "minimum": 0, "maximum": 100, "description": "传输进度百分比" },
    "state": {
      "type": "string",
      "enum": ["pending", "transferring", "verifying", "completed", "failed"],
      "description": "当前传输状态"
    },
    "speedBps": { "type": "integer", "description": "当前传输速率（字节/秒）" }
  }
}
```

---

## CMM-06: 配对二维码内容

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PairingQRContent",
  "description": "桌面端生成的配对二维码 JSON 内容。移动端扫码后解析此 JSON 获取连接信息",
  "type": "object",
  "required": ["type", "version", "deviceId", "deviceName", "ip", "signalingPort", "dataPort", "token", "expiresAt"],
  "properties": {
    "type": {
      "type": "string",
      "const": "ai-voice-assistant-pairing",
      "description": "固定标识，用于移动端校验是否为本产品配对码"
    },
    "version": {
      "type": "integer",
      "const": 1,
      "description": "协议版本号"
    },
    "deviceId": {
      "type": "string",
      "description": "桌面端设备 ID",
      "example": "desktop-a1b2c3d4e5f6"
    },
    "deviceName": {
      "type": "string",
      "description": "桌面端显示名称",
      "example": "AI录音助手"
    },
    "ip": {
      "type": "string",
      "description": "桌面端局域网 IP 地址",
      "example": "192.168.1.100"
    },
    "signalingPort": {
      "type": "integer",
      "description": "信令端口",
      "default": 18520
    },
    "dataPort": {
      "type": "integer",
      "description": "加密数据通道端口",
      "default": 18521
    },
    "token": {
      "type": "string",
      "description": "一次性配对 Token（32 字节 hex = 64 字符），5 分钟有效期",
      "example": "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890"
    },
    "expiresAt": {
      "type": "integer",
      "description": "Token 过期 Unix 毫秒时间戳",
      "example": 1747128300000
    }
  }
}
```

### 解析示例

```typescript
const qrContent = JSON.parse(qrJson);
if (qrContent.type === 'ai-voice-assistant-pairing' && qrContent.version === 1) {
  const wsUrl = `ws://${qrContent.ip}:${qrContent.signalingPort}/`;
  // 连接 wsUrl，发送 pair_request 携带 token ...
}
```

---

## CMM-07: CommEngine 类 API

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CommEngine — 通信引擎主入口",
  "description": "应用层对 comm 模块的唯一访问入口。整合信令/传输/控制/心跳/发现/存储六个子系统",
  "type": "class",
  "constructor": {
    "description": "创建通信引擎实例",
    "input": {
      "type": "object",
      "optional": true,
      "properties": {
        "callbacks": { "$ref": "#/definitions/CommCallbacks", "description": "可选，事件回调" },
        "config": { "$ref": "#/definitions/CommConfig", "description": "可选，配置覆盖" }
      }
    },
    "output": { "description": "CommEngine 实例" }
  },
  "methods": {
    "start": {
      "description": "并行启动所有服务（发现 + 信令 + 传输）。异步。",
      "input": {},
      "output": { "type": "Promise<void>" },
      "errors": ["端口被占用", "UDP 多播绑定失败"]
    },
    "stop": {
      "description": "停止所有服务，释放端口。异步。",
      "input": {},
      "output": { "type": "Promise<void>" }
    },
    "getQRContent": {
      "description": "获取当前配对二维码 JSON 字符串（每次调用生成新 Token）",
      "input": {},
      "output": { "type": "string", "description": "PairingQRContent 的 JSON 序列化" }
    },
    "sendAudio": {
      "description": "发送完整音频 Buffer 给指定对端",
      "input": {
        "type": "object",
        "required": ["data", "audioId", "peerId"],
        "properties": {
          "data": { "type": "Buffer", "description": "PCM 音频数据" },
          "audioId": { "type": "string", "description": "音频文件 UUID" },
          "peerId": { "type": "string", "description": "目标对端设备 ID" }
        }
      },
      "output": { "type": "Promise<void>" }
    },
    "sendAudioFile": {
      "description": "发送音频文件给指定对端",
      "input": {
        "type": "object",
        "required": ["filePath", "peerId"],
        "properties": {
          "filePath": { "type": "string", "description": "音频文件绝对路径" },
          "peerId": { "type": "string" },
          "audioId": { "type": "string", "description": "可选，覆盖 audioId" }
        }
      },
      "output": { "type": "Promise<void>" }
    },
    "sendControl": {
      "description": "发送控制指令给指定对端",
      "input": {
        "type": "object",
        "required": ["peerId", "type", "payload"],
        "properties": {
          "peerId": { "type": "string" },
          "type": { "type": "string", "description": "ControlMessageType 枚举值" },
          "payload": { "type": "object" }
        }
      },
      "output": { "type": "boolean", "description": "是否发送成功" }
    },
    "getDiscoveredPeers": {
      "description": "获取局域网已发现设备列表",
      "input": {},
      "output": { "type": "array", "items": { "$ref": "#/definitions/PeerInfo" } }
    },
    "autoConnectFromSaved": {
      "description": "尝试从已保存凭证自动连接已知对端",
      "input": {},
      "output": { "type": "integer", "description": "尝试连接的对端数量" }
    }
  },
  "properties": {
    "signaling": { "description": "信令服务器实例（public，可访问）" },
    "transport": { "description": "传输管理器实例（public，可访问）" },
    "control": { "description": "控制通道实例（public，可访问）" },
    "heartbeat": { "description": "心跳检测器实例（public，可访问）" },
    "discovery": { "description": "发现服务实例（public，可访问）" },
    "started": { "type": "boolean", "description": "服务是否已启动" },
    "peerCount": { "type": "integer", "description": "当前连接的对端数量" }
  }
}
```

### 基础类型定义

```json
{
  "definitions": {
    "DeviceRole": {
      "type": "string",
      "enum": ["desktop", "mobile"],
      "description": "设备角色"
    },
    "ConnectionState": {
      "type": "string",
      "enum": ["disconnected", "connecting", "connected", "reconnecting", "failed"],
      "description": "连接生命周期状态"
    },
    "ChunkTransferState": {
      "type": "string",
      "enum": ["pending", "transferring", "verifying", "completed", "failed"]
    },
    "PeerInfo": {
      "type": "object",
      "required": ["deviceId", "deviceName", "deviceRole", "ipAddress", "signalingPort", "dataPort"],
      "properties": {
        "deviceId": { "type": "string" },
        "deviceName": { "type": "string" },
        "deviceRole": { "$ref": "#/definitions/DeviceRole" },
        "ipAddress": { "type": "string", "format": "ipv4" },
        "signalingPort": { "type": "integer" },
        "dataPort": { "type": "integer" }
      }
    },
    "PairingToken": {
      "type": "object",
      "required": ["token", "createdAt", "expiresAt", "used"],
      "properties": {
        "token": { "type": "string" },
        "createdAt": { "type": "integer" },
        "expiresAt": { "type": "integer" },
        "used": { "type": "boolean" }
      }
    }
  }
}
```

---

## CMM-08: 事件回调接口

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CommCallbacks — 通信模块事件回调",
  "description": "通过 CommEngine 构造函数或 EventEmitter.on() 注册的回调函数。所有回调均为可选",
  "type": "object",
  "properties": {
    "onConnectionStateChange": {
      "type": "function",
      "signature": "(state: ConnectionState, peer?: PeerInfo) => void",
      "description": "连接状态变更时触发。如 disconnected→connecting→connected→reconnecting→failed",
      "triggers": ["心跳超时", "配对成功", "主动关闭", "重连开始/成功/失败"]
    },
    "onTransferProgress": {
      "type": "function",
      "signature": "(progress: TransferProgress) => void",
      "description": "音频传输进度更新。每发送/接收一个分片触发一次",
      "用途": "前端进度条展示",
      "triggers": "每个分片发送/接收后"
    },
    "onAudioComplete": {
      "type": "function",
      "signature": "(audioId: string, data: Buffer) => void",
      "description": "音频文件接收完成。携带完整的 PCM Buffer，供 ASR 模块处理",
      "triggers": "audio_complete 控制包到达后"
    },
    "onControlMessage": {
      "type": "function",
      "signature": "(msg: ControlMessage) => void",
      "description": "收到对端的控制指令或状态更新时触发",
      "triggers": "control 类型 WebSocket 消息到达"
    },
    "onError": {
      "type": "function",
      "signature": "(error: Error) => void",
      "description": "模块内部发生错误时触发",
      "examples": ["分片 CRC32 校验失败", "端口绑定失败", "Token 验证失败"]
    },
    "onPeerDiscovered": {
      "type": "function",
      "signature": "(peer: PeerInfo) => void",
      "description": "局域网中发现新设备时触发",
      "用途": "设备列表 UI 更新",
      "triggers": "UDP 多播首次收到该设备广播"
    }
  }
}
```

---

## CMM-09: 配置参数

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CommConfig — 通信模块配置参数",
  "description": "通过 mergeConfig(overrides) 传入部分覆盖。所有字段均有默认值",
  "type": "object",
  "properties": {
    "signalingPort": {
      "type": "integer",
      "default": 18520,
      "description": "信令服务器端口（HTTP + WebSocket）"
    },
    "dataPort": {
      "type": "integer",
      "default": 18521,
      "description": "加密数据传输通道端口"
    },
    "dataChunkSize": {
      "type": "integer",
      "default": 65536,
      "description": "音频分片大小（字节），默认 64KB"
    },
    "dataChannelTimeoutMs": {
      "type": "integer",
      "default": 30000,
      "description": "数据通道超时时间（毫秒）"
    },
    "heartbeatIntervalMs": {
      "type": "integer",
      "default": 30000,
      "description": "心跳 Ping 发送间隔（毫秒），默认 30 秒"
    },
    "heartbeatTimeoutMs": {
      "type": "integer",
      "default": 10000,
      "description": "心跳超时时间（毫秒），Ping 后 10 秒未收到 Pong 视为断线"
    },
    "maxReconnectAttempts": {
      "type": "integer",
      "default": 3,
      "minimum": 0,
      "description": "断线自动重连最大尝试次数"
    },
    "reconnectIntervalMs": {
      "type": "integer",
      "default": 5000,
      "description": "重连间隔（毫秒），默认 5 秒"
    },
    "encryptionAlgorithm": {
      "type": "string",
      "const": "aes-256-gcm",
      "description": "数据传输加密算法"
    },
    "encryptionKeyLength": {
      "type": "integer",
      "const": 32,
      "description": "加密密钥长度（字节），对应 256 位"
    },
    "discoveryPort": {
      "type": "integer",
      "default": 18522,
      "description": "UDP 多播发现端口"
    },
    "discoveryIntervalMs": {
      "type": "integer",
      "default": 5000,
      "description": "UDP 广播间隔（毫秒），默认 5 秒"
    },
    "pairingTokenExpiryMs": {
      "type": "integer",
      "default": 300000,
      "description": "配对 Token 有效期（毫秒），默认 5 分钟"
    }
  }
}
```

---

## CMM-10: 音频编码规范

### 10.1 PCM 编码参数

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PCM 音频编码规范",
  "description": "comm 模块传输的音频数据统一使用以下编码格式，与 IF-06 规范一致",
  "parameters": {
    "sampleRate": {
      "type": "integer",
      "value": 16000,
      "unit": "Hz",
      "description": "固定 16kHz 采样率"
    },
    "bitsPerSample": {
      "type": "integer",
      "value": 16,
      "description": "16-bit signed integer，little-endian 字节序"
    },
    "channels": {
      "type": "integer",
      "value": 1,
      "description": "单声道"
    },
    "encoding": {
      "type": "string",
      "value": "PCM signed 16-bit LE",
      "description": "线性脉冲编码调制，无压缩"
    },
    "byteRate": {
      "type": "integer",
      "value": 32000,
      "unit": "bytes/sec",
      "formula": "sampleRate × bitsPerSample/8 × channels = 16000 × 2 × 1"
    }
  }
}
```

### 10.2 资源消耗估算

| 时间段 | 数据量 | 说明 |
|--------|--------|------|
| 每秒 | 32 KB | 32000 bytes/sec |
| 每分钟 | ~1.92 MB | 每分钟录音 |
| 每小时 | ~115 MB | 每小时录音 |

### 10.3 分片后传输效率

| 场景 | 原始大小 | 分片数量 | 传输开销 |
|------|---------|---------|---------|
| 10 秒录音 | 320 KB | 5 片（64KB×5） | ~130 字节头部/片 = 0.04% |
| 1 分钟录音 | 1.92 MB | 30 片 | ~3.9 KB 头部 = 0.2% |
| 1 小时录音 | 115 MB | 1840 片 | ~234 KB 头部 = 0.2% |

---

## CMM-11: 凭证存储格式

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "加密凭证存储",
  "description": "配对成功后，对端凭证加密存储在本地文件系统",
  "storage": {
    "path": "{AI_VOICE_APP_DATA || ~/.ai-voice-assistant}/credentials/{peerId}.json.enc",
    "encryption": "AES-256-GCM，主密钥 = SHA-256(MAC地址 + 固定Salt)",
    "keyDerivation": "MAC 地址取首个非内网接口，Salt 为 'ai-voice-assistant-v1-credential-salt'"
  },
  "plaintextSchema": {
    "type": "object",
    "required": ["peer", "sharedKey", "pairedAt", "lastConnectedAt"],
    "properties": {
      "peer": { "$ref": "#/definitions/PeerInfo", "description": "对端设备信息" },
      "sharedKey": {
        "type": "string",
        "description": "共享加密密钥（64 字符 hex），由 ECDH 协商派生"
      },
      "pairedAt": {
        "type": "integer",
        "description": "首次配对成功时间戳（Unix 毫秒）"
      },
      "lastConnectedAt": {
        "type": "integer",
        "description": "最后连接时间戳（Unix 毫秒），用于排序最近使用的设备"
      }
    }
  },
  "api": {
    "saveCredential(peer, sharedKey)": "保存对端凭证",
    "loadCredential(peerId)": "读取对端凭证，解密失败返回 null",
    "removeCredential(peerId)": "删除指定对端凭证（吊销）",
    "listSavedPeerIds()": "列出所有已保存凭证的设备 ID",
    "getAllCredentials()": "获取所有凭证摘要列表（用于自动连接 UI）"
  },
  "securityNotes": [
    "主密钥不落盘，运行时从 MAC 地址派生",
    "MAC 地址变化会导致已有凭证无法解密（自动删除无效文件）",
    "凭证文件为二进制加密格式，明文不落盘"
  ]
}
```

---

## 附录 A: 端口汇总

| 端口 | 用途 | 协议 | 默认值 |
|------|------|------|--------|
| 18520 | 信令（HTTP + WebSocket） | TCP | 可配置 |
| 18521 | 加密数据传输通道 | TCP | 可配置 |
| 18522 | UDP 多播设备发现 | UDP | 可配置 |

## 附录 B: 接口依赖关系

```
┌─────────────────────────────────────────────────────┐
│                    上层应用 (UI / ASR)              │
├─────────────────────────────────────────────────────┤
│  CMM-07: CommEngine API          CMM-08: Callbacks  │
├─────────────────────────────────────────────────────┤
│                                                     │
│   ┌─────────┐ ┌──────────┐ ┌────────┐ ┌─────────┐  │
│   │ 信令    │ │ 传输     │ │ 控制   │ │ 发现    │  │
│   │ server  │ │ manager  │ │ channel│ │ service │  │
│   │ CMM-02  │ │ CMM-03   │ │ CMM-02 │ │ CMM-04  │  │
│   └────┬────┘ └────┬─────┘ └───┬────┘ └────┬────┘  │
│        │           │           │           │        │
│   ┌────┴────┐ ┌────┴─────┐ ┌───┴────┐           │
│   │ ws.ts   │ │ chunk.ts │ │ heartbeat.ts │        │
│   │ RFC6455 │ │ CMM-05   │ │ 30s/10s/3次   │        │
│   └─────────┘ └──────────┘ └────────┘           │
│                                                     │
│   ┌──────────┐ ┌──────────────┐                     │
│   │ crypto/  │ │ storage/     │                     │
│   │ utils.ts │ │ credential   │                     │
│   │ AES+ECDH │ │ CMM-11       │                     │
│   └──────────┘ └──────────────┘                     │
└─────────────────────────────────────────────────────┘
```

## 附录 C: 消息类型枚举

```
ControlMessageType:
  start_recording   PC → 手机   开始录音
  stop_recording    PC → 手机   停止录音
  start_transcribe  PC → 手机   开始转写
  state_update      双向        状态同步
  audio_meta        手机 → PC   音频元信息
  audio_start       手机 → PC   音频开始
  audio_chunk       手机 → PC   音频分片
  audio_complete    手机 → PC   音频完成
  pairing_request   双向        配对请求
  pairing_response  双向        配对响应
  error             双向        错误信息

ConnectionState:
  disconnected → connecting → connected → reconnecting → failed

ChunkTransferState:
  pending → transferring → verifying → completed → failed
```
