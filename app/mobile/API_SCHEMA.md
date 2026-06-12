# 智能体1 — 移动端音频采集与 VAD 模块 外部接口规范

> 文档版本: 1.0.0  
> 最后更新: 2026-06-12  
> 通道协议: Flutter MethodChannel / EventChannel / BasicMessageChannel  
> 序列化: JSON (UTF-8) / 二进制 PCM

---

## 目录

| 接口编号 | 名称 | 方向 | 传输层 |
|----------|------|------|--------|
| [IF-01](#if-01) | 状态发布通道 | 智能体1 → 对端 | MethodChannel |
| [IF-02](#if-02) | 状态事件通道 | 对端 → 智能体1 | EventChannel |
| [IF-03](#if-03) | 音频数据通道 | 智能体1 → 对端 | BasicMessageChannel |
| [IF-04](#if-04) | 前台服务控制 | Dart → Kotlin 原生 | MethodChannel |
| [IF-05](#if-05) | 降噪引擎接口 | Dart → Kotlin 原生 | MethodChannel |
| [IF-06](#if-06) | PCM 音频流编码规范 | — | 二进制 |
| [IF-07](#if-07) | Dart 层状态消息 JSON 格式 | — | JSON |
| [IF-08](#if-08) | AudioPipeline 控制器 API | 外部 Dart 代码调用 | Dart 函数调用 |
| [IF-09](#if-09) | VAD 引擎抽象接口 | 外部 Dart 代码调用 | Dart 函数调用 |
| [IF-10](#if-10) | Silero VAD ONNX 张量签名 | Dart → ONNX Runtime | ONNX 张量 |

---

## IF-01: 状态发布通道 (智能体1 → 对端)

### 通道定义

```json
{
  "channelName": "com.aiassistant.mobile/state",
  "transport": "MethodChannel",
  "codec": "StandardMethodCodec",
  "direction": "智能体1 → 外部监听者 (对端/P2P/PC端)",
  "description": "智能体1 通过此通道主动推送状态变更和错误信息给外部消费者"
}
```

### 方法: `onStateChanged`

```json
{
  "method": "onStateChanged",
  "description": "音频采集工作状态变更时触发",
  "arguments": {
    "type": "object",
    "required": ["type", "state"],
    "properties": {
      "type": {
        "type": "string",
        "enum": ["status", "audio", "error"],
        "description": "消息类型标识",
        "example": "status"
      },
      "state": {
        "type": "string",
        "enum": ["idle", "listening", "recording", "error"],
        "description": "当前工作状态",
        "example": "recording"
      },
      "detail": {
        "type": "string",
        "description": "附加详情。recording→listening 时携带 segment_end；error 时携带错误原因",
        "examples": ["", "start", "segment_end", "VAD 引擎异常"]
      }
    }
  },
  "examples": [
    {"type": "status", "state": "listening", "detail": ""},
    {"type": "status", "state": "recording", "detail": "start"},
    {"type": "status", "state": "listening", "detail": "segment_end"},
    {"type": "status", "state": "error",  "detail": "启动失败: No permission"}
  ],
  "状态机转换表": {
    "idle → listening":    {"trigger": "AudioPipeline.start()", "detail": ""},
    "listening → recording": {"trigger": "连续 ≥3 帧 VAD 语音", "detail": "start"},
    "recording → listening": {"trigger": "连续 ≥48 帧 VAD 静音", "detail": "segment_end"},
    "*/idle/listening → error": {"trigger": "任何异常", "detail": "错误原因"},
    "error/idle → stop":  {"trigger": "AudioPipeline.stop()", "detail": ""}
  }
}
```

### 方法: `onError`

```json
{
  "method": "onError",
  "description": "不可恢复的错误时触发",
  "arguments": {
    "type": "object",
    "required": ["type", "state", "detail"],
    "properties": {
      "type":  {"type": "string", "enum": ["error"]},
      "state": {"type": "string", "enum": ["error"]},
      "detail": {"type": "string", "description": "错误详情"}
    }
  }
}
```

---

## IF-02: 状态事件通道 (对端 → 智能体1)

### 通道定义

```json
{
  "channelName": "com.aiassistant.mobile/state_events",
  "transport": "EventChannel",
  "codec": "StandardMethodCodec",
  "direction": "外部消费者 (对端/PC端) → 智能体1",
  "description": "外部通过此通道发送控制指令给智能体1。支持 JSON 字符串 或 Map 两种载荷格式。"
}
```

### 输入指令格式

```json
{
  "description": "通过 EventChannel.receiveBroadcastStream() 接收，支持两种格式",
  "formats": {
    "Map 格式": {
      "example": {"command": "start", "params": {}}
    },
    "JSON 字符串格式": {
      "example": "{\"command\":\"stop\"}"
    }
  },
  "command": {
    "type": "string",
    "description": "指令名称",
    "enum": ["start", "stop", "reload_model", "update_config"],
    "required": true
  },
  "params": {
    "type": "object",
    "description": "指令参数（可选）",
    "anyOf": [
      {"command": "start",       "params": {"sampleRate": {"type": "integer"}}},
      {"command": "stop",        "params": {}},
      {"command": "reload_model","params": {"modelPath": {"type": "string"}}},
      {"command": "update_config","params": {
        "speechThreshold":  {"type": "number", "description": "VAD 语音阈值"},
        "maxSilenceFrames": {"type": "integer", "description": "静音超时帧数"}
      }}
    ]
  },
  "note": "当前仅实现 start/stop 的处理路由，reload_model/update_config 为预留扩展"
}
```

---

## IF-03: 音频数据通道 (智能体1 → 对端)

### 通道定义

```json
{
  "channelName": "com.aiassistant.mobile/audio_data",
  "transport": "BasicMessageChannel",
  "codec": "StandardMessageCodec",
  "direction": "智能体1 → 外部消费者 (对端/PC端)",
  "description": "智能体1 通过此通道持续推送降噪后的 PCM 音频数据包给智能体2。数据包按照 [sequenceNumber, timestampMs, sampleRate, bitsPerSample, channels, pcmBytes] 顺序打包为 List。"
}
```

### 消息载荷

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "description": "BasicMessageChannel.send() 发送的 List<dynamic> 载荷",
  "type": "array",
  "minItems": 6,
  "maxItems": 6,
  "items": [
    {
      "index": 0,
      "field": "sequenceNumber",
      "type": "integer",
      "required": true,
      "description": "PCM 包序列号（单调递增，从 0 开始），接收方用于重组和检测丢包",
      "example": 0
    },
    {
      "index": 1,
      "field": "timestampMs",
      "type": "integer",
      "required": true,
      "description": "Unix 毫秒时间戳（DateTime.now().millisecondsSinceEpoch）",
      "example": 1750000000000
    },
    {
      "index": 2,
      "field": "sampleRate",
      "type": "integer",
      "required": true,
      "description": "音频采样率，固定 16000",
      "example": 16000,
      "const": 16000
    },
    {
      "index": 3,
      "field": "bitsPerSample",
      "type": "integer",
      "required": true,
      "description": "位深，固定 16",
      "example": 16,
      "const": 16
    },
    {
      "index": 4,
      "field": "channels",
      "type": "integer",
      "required": true,
      "description": "声道数，固定 1（单声道）",
      "example": 1,
      "const": 1
    },
    {
      "index": 5,
      "field": "pcmBytes",
      "type": "array",
      "items": {"type": "integer"},
      "required": true,
      "description": "PCM 音频裸数据（16bit signed little-endian 编码），详见 IF-06",
      "example": "[0x00, 0x00, 0xFF, 0x7F, 0x00, 0x80, ...]"
    }
  ]
}
```

### 接收方 Dart 反序列化示例

```dart
// 接收方通过 BasicMessageChannel 的同名通道订阅
const channel = BasicMessageChannel('com.aiassistant.mobile/audio_data', StandardMessageCodec());
channel.setMessageHandler((message, reply) {
  final List<dynamic> data = message as List<dynamic>;
  final int seq       = data[0] as int;
  final int ts        = data[1] as int;
  final int sr        = data[2] as int;
  final int bps       = data[3] as int;
  final int ch        = data[4] as int;
  final List<int> pcm = data[5] as List<int>;
  // 处理 pcmBytes...
});
```

---

## IF-04: 前台服务控制 (Dart → Android 原生)

### 通道定义

```json
{
  "channelName": "com.aiassistant.mobile/foreground_service",
  "transport": "MethodChannel",
  "direction": "Dart Flutter 层 → Android Kotlin 原生层",
  "description": "Flutter 侧控制 Android 前台 Service 的启动、停止和通知更新。iOS 侧暂用 AVAudioSession 后台音频模式替代。"
}
```

### 方法列表

| method | 参数 | 返回值 | 描述 |
|--------|------|--------|------|
| `start` | 无 | `bool` | 启动前台 Service（注册 notification channel、startForeground） |
| `stop` | 无 | `void` | 停止前台 Service（stopForeground + stopSelf） |
| `updateState` | `{"state": "监听中"}` | `void` | 更新常驻通知栏文本内容 |

### 方法签名 (JSON Schema)

```json
{
  "methods": {
    "start": {
      "description": "启动 Android 前台 Service。触发 AudioForegroundService.onCreate() → startForeground() → 显示常驻通知",
      "arguments": {},
      "returns": {
        "type": "boolean",
        "description": "true=启动成功，false=启动失败（如权限不足）"
      }
    },
    "stop": {
      "description": "停止前台 Service。触发 stopForeground(STOP_FOREGROUND_REMOVE) + stopSelf()",
      "arguments": {},
      "returns": "void"
    },
    "updateState": {
      "description": "更新通知栏状态文本。通过 Intent(action=UPDATE_STATE, extra=state_text) 发送给 AudioForegroundService",
      "arguments": {
        "type": "object",
        "required": ["state"],
        "properties": {
          "state": {
            "type": "string",
            "description": "通知栏显示的状态文本",
            "examples": ["监听中", "录音中", "异常", "已停止"]
          }
        }
      },
      "returns": "void"
    }
  }
}
```

### Android 原生 Intent Action

```json
{
  "IntentAction": {
    "action": "UPDATE_STATE",
    "extra": {
      "key": "state_text",
      "type": "String"
    }
  },
  "WakeLock": {
    "tag": "com.aiassistant.mobile:audio_capture_wakelock",
    "type": "PARTIAL_WAKE_LOCK",
    "maxDuration": "4小时",
    "description": "防止 CPU 休眠导致音频采集中断"
  },
  "foregroundServiceType": "microphone",
  "startStrategy": "START_STICKY（被系统杀死后自动重启）"
}
```

---

## IF-05: 降噪引擎接口 (Dart → Android 原生)

### 通道定义

```json
{
  "channelName": "com.aiassistant.mobile/noise_suppression",
  "transport": "MethodChannel",
  "direction": "Dart Flutter 层 → Android Kotlin 原生层",
  "description": "调用 Android 原生 WebRTC NoiseSuppression 库进行降噪。当前为占位实现（直接转发），待集成 WebRTC NS JNI 后启用。"
}
```

### 方法签名

```json
{
  "methods": {
    "init": {
      "description": "初始化降噪引擎。在 AudioProcessor.init() 中调用",
      "arguments": {},
      "returns": {
        "type": "boolean",
        "description": "true=降噪引擎可用，false=降噪不可用（Flutter 侧回退到 noise gate）"
      }
    },
    "process": {
      "description": "对 PCM 数据块执行降噪处理",
      "arguments": {
        "type": "object",
        "required": ["audioData", "sampleRate"],
        "properties": {
          "audioData": {
            "type": "array",
            "items": {"type": "integer", "description": "byte value 0~255"},
            "description": "PCM 16bit LE 二进制数据（ByteArray）"
          },
          "sampleRate": {
            "type": "integer",
            "description": "采样率，固定 16000",
            "const": 16000
          }
        }
      },
      "returns": {
        "type": "array",
        "items": {"type": "integer"},
        "description": "降噪处理后的 PCM 16bit LE 数据。占位模式下直接返回原始数据的拷贝。"
      }
    },
    "release": {
      "description": "释放降噪引擎资源",
      "arguments": {},
      "returns": "void"
    }
  }
}
```

---

## IF-06: PCM 音频流编码规范

### 编码参数

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PCM 音频编码规范",
  "description": "智能体1 输出给智能体2 的标准化 PCM 音频流格式",
  "parameters": {
    "sampleRate": {
      "type": "integer",
      "value": 16000,
      "unit": "Hz",
      "description": "固定 16kHz 采样率。由于采自移动设备麦克风，实际可能因硬件上采样导致质量低于专业设备。"
    },
    "bitsPerSample": {
      "type": "integer",
      "value": 16,
      "description": "16-bit signed integer， little-endian 字节序"
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
      "formula": "sampleRate × bitsPerSample/8 × channels = 16000 × 2 × 1",
      "description": "每秒 32KB 的原始 PCM 数据量"
    },
    "sampleEncoding": {
      "type": "string",
      "value": "signed 16-bit integer",
      "range": "[-32768, 32767]",
      "byteOrder": "little-endian",
      "note": "Dart 侧使用 ByteData.getInt16(i, Endian.little) 读取"
    }
  }
}
```

### 分片规则

```json
{
  "title": "PCM 数据包分片规则",
  "description": "音频采集器从麦克风读取的数据块大小由底层驱动决定，不做固定分片。每个 BasicMessageChannel 消息包含一次回调的全部数据。",
  "rules": [
    "每次 AudioCapture.pcmStream 回调的 ByteData 长度不固定（取决于 record 包的内部缓冲区大小）",
    "典型单次回调数据量约 4096 采样点 × 2 字节 = 8192 字节（≈ 256ms 音频）",
    "每个回调立即触发一次降噪处理 + 一次 PCM 发送，不做帧聚合",
    "VAD 检测独立于 PCM 发送：内部缓冲区累积到 512 采样点（32ms）时触发一次 Silero VAD 推理",
    "序列号 (sequenceNumber) 全局单调递增，一个数据包对应一个序列号"
  ],
  "典型时序示例": {
    "T+0ms":  "pcmStream 回调 4096 采样点 → seq=0 → BasicMessageChannel 发送",
    "T+32ms": "VAD 缓冲区满 512 采样点 → Silero VAD 推理 → 状态判断",
    "T+32ms": "pcmStream 回调 4096 采样点 → seq=1 → BasicMessageChannel 发送",
    "T+64ms": "VAD 缓冲区满 512 采样点 → Silero VAD 推理 → 状态判断",
    "...":    "持续循环"
  }
}
```

### 资源消耗估算

```json
{
  "bitrate": "256 kbps (16000 × 16 × 1)",
  "perMinuteData": "约 1.92 MB/min (32000 × 60)",
  "perHourData":  "约 115 MB/hour",
  "note": "以上为原始 PCM 裸数据，不包含任何压缩。P2P 传输时建议在传输层进行 opus 压缩（由智能体2 的通信模块负责）。"
}
```

---

## IF-07: Dart 层状态消息 JSON 格式

### `StatusMessage`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StatusMessage",
  "description": "智能体1 内部状态消息的序列化格式。同时用于 IF-01 通道的载荷和内部日志",
  "type": "object",
  "required": ["type", "state"],
  "properties": {
    "type": {
      "type": "string",
      "enum": ["status", "audio", "error"],
      "description": "消息类型"
    },
    "state": {
      "$ref": "#/definitions/AudioWorkState"
    },
    "detail": {
      "type": "string",
      "description": "附加详情。可选字段，仅在非空时出现在序列化输出中"
    }
  },
  "definitions": {
    "AudioWorkState": {
      "type": "string",
      "enum": ["idle", "listening", "recording", "error"],
      "description": "音频采集器的工作状态枚举"
    }
  },
  "examples": [
    "{\"type\":\"status\",\"state\":\"listening\"}",
    "{\"type\":\"status\",\"state\":\"recording\",\"detail\":\"start\"}",
    "{\"type\":\"status\",\"state\":\"listening\",\"detail\":\"segment_end\"}",
    "{\"type\":\"error\",\"state\":\"error\",\"detail\":\"VAD engine crashed\"}"
  ]
}
```

### `PcmPacket`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PcmPacket",
  "description": "PCM 数据包的对象模型。实际 P2P 传输时使用 IF-03 的二进制 List 格式以减少序列化开销",
  "type": "object",
  "required": ["data", "timestampMs", "sequenceNumber"],
  "properties": {
    "data": {
      "type": "array",
      "items": {"type": "integer"},
      "description": "PCM 16bit LE 字节数据"
    },
    "sampleRate":    {"type": "integer", "const": 16000},
    "bitsPerSample": {"type": "integer", "const": 16},
    "channels":      {"type": "integer", "const": 1},
    "timestampMs":   {"type": "integer", "description": "Unix 毫秒时间戳"},
    "sequenceNumber":{"type": "integer", "description": "序列号，从 0 单调递增"},
    "durationMs": {
      "type": "integer",
      "description": "计算属性。data.length / (sampleRate × channels × bitsPerSample/8) × 1000",
      "readOnly": true
    }
  }
}
```

### `VadResult`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VadResult",
  "description": "单次 VAD 检测结果。智能体1 内部使用，不对外传输",
  "type": "object",
  "required": ["probability", "isSpeech", "timestampMs"],
  "properties": {
    "probability": {
      "type": "number",
      "minimum": 0.0,
      "maximum": 1.0,
      "description": "Silero VAD 模型输出的语音概率（sigmoid 输出）"
    },
    "isSpeech": {
      "type": "boolean",
      "description": "是否判定为语音，由 probability >= threshold(0.5) 决定"
    },
    "timestampMs": {
      "type": "integer",
      "description": "Unix 毫秒时间戳"
    }
  }
}
```

---

## IF-08: AudioPipeline 控制器 API

### Dart 类接口

```dart
/// 顶层管线 — 音频采集生命周期控制器
class AudioPipeline {
  /// 当前工作状态
  AudioWorkState get currentState;

  /// 是否正在运行
  bool get isRunning;

  /// 启动管线（异步）:
  ///   1. AudioProcessor.init() → 初始化/探测降噪
  ///   2. VadEngine.load() → 加载 VAD ONNX 模型
  ///   3. ForegroundService.start() → 前台保活
  ///   4. AudioCapture.start() → 开始 PCM 采集
  ///   5. 启动 VAD 定时器（每 32ms）
  ///   6. ⇒ 进入 listening 状态
  Future<void> start();

  /// 停止管线（异步）:
  ///   1. 停止 VAD 定时器
  ///   2. AudioCapture.stop() → 停止采集
  ///   3. ForegroundService.stop() → 停止前台服务
  ///   4. ⇒ 进入 idle 状态
  Future<void> stop();

  /// 释放全部资源（不可恢复）
  Future<void> dispose();
}
```

### 构造函数依赖注入

```json
{
  "constructor": {
    "required": ["audioCapture", "audioProcessor", "vadEngine", "stateChannel"],
    "parameters": {
      "audioCapture":    {"type": "AudioCapture",    "description": "PCM 采集器"},
      "audioProcessor":  {"type": "AudioProcessor",  "description": "降噪处理器"},
      "vadEngine":       {"type": "VadEngine",       "description": "VAD 引擎抽象"},
      "stateChannel":    {"type": "StateChannel",    "description": "状态消息桥接"},
      "foregroundService": {"type": "ForegroundService?", "description": "前台服务（可选，默认新建）"},
      "onStateChanged":  {"type": "void Function(AudioWorkState)?", "description": "状态变更回调（可选）"}
    }
  }
}
```

---

## IF-09: VAD 引擎抽象接口

### Dart 抽象类

```dart
/// VAD 引擎抽象接口 — 支持不同模型实现
abstract class VadEngine {
  /// 加载模型（异步，可能耗时），加载后 isLoaded → true
  Future<void> load();

  /// 卸载模型，释放资源
  Future<void> unload();

  /// 是否已加载
  bool get isLoaded;

  /// 模型要求的输入采样率 (Hz)
  int get requiredSampleRate;   // → 16000

  /// 每次推理需要的采样点数
  int get frameSize;            // → 512

  /// 对 PCM 数据进行语音活动检测
  /// [pcmSamples]: Float64 采样点，范围 [-1.0, 1.0]
  /// 返回值: 语音概率 [0.0, 1.0]
  double detectSync(List<double> pcmSamples);

  /// 异步检测（当前实现为同步封装的 Future）
  Future<double> detectAsync(List<double> pcmSamples);

  /// 重置 LSTM 内部状态
  void resetStates();
}
```

### VadStateMachine（状态机）

```json
{
  "title": "VadStateMachine",
  "description": "管理 idle → listening → recording 的状态转换逻辑",
  "states": {
    "idle": {
      "enter": "reset() 调用时进入",
      "behavior": "忽略所有 VAD 输入，不处理 feedVadResult()"
    },
    "listening": {
      "enter": "startListening() 调用时进入",
      "stay": "连续语音帧计数 < 3 时保持",
      "exit": "连续 ≥3 帧 isSpeech=true → recording"
    },
    "recording": {
      "enter": "连续 ≥3 帧语音时进入",
      "stay": "连续静音帧计数 < 48 时保持",
      "exit": "连续 ≥48 帧 isSpeech=false → listening"
    },
    "error": {
      "enter": "setError() 调用时进入",
      "behavior": "忽略所有 VAD 输入"
    }
  },
  "parameters": {
    "minSpeechFrames":  {"value": 3,  "description": "触发 recording 所需的最小连续语音帧数"},
    "maxSilenceFrames": {"value": 48, "description": "触发 listening 回退的最大连续静音帧数（≈1.5秒）"},
    "speechThreshold":  {"value": 0.5,"description": "Silero VAD 语音概率判定阈值"},
    "silenceThreshold": {"value": 0.3,"description": "静音判定阈值"}
  }
}
```

---

## IF-10: Silero VAD ONNX 张量签名

### 模型信息

```json
{
  "model": "Silero VAD v5",
  "format": "ONNX",
  "source": "https://github.com/snakers4/silero-vad",
  "size": "约 1.7 MB",
  "runtime": "onnxruntime_flutter (ONNX Runtime)"
}
```

### 输入张量

```json
{
  "inputs": [
    {
      "name": "input",
      "type": "tensor(float32)",
      "shape": [1, 512],
      "description": "PCM 音频采样点，归一化到 [-1.0, 1.0] 的 float32 值",
      "frameDuration": "32ms @ 16000Hz",
      "required": true
    },
    {
      "name": "h",
      "type": "tensor(float32)",
      "shape": [1, 1, 64],
      "description": "LSTM hidden state（跨帧保持上下文）",
      "initialValue": "全零 Float32List(64)",
      "required": true
    },
    {
      "name": "c",
      "type": "tensor(float32)",
      "shape": [1, 1, 64],
      "description": "LSTM cell state（跨帧保持上下文）",
      "initialValue": "全零 Float32List(64)",
      "required": true
    },
    {
      "name": "sr",
      "type": "tensor(int64)",
      "shape": [1],
      "description": "采样率，固定值 16000",
      "value": 16000,
      "required": true
    }
  ]
}
```

### 输出张量

```json
{
  "outputs": [
    {
      "name": "output",
      "type": "tensor(float32)",
      "shape": [1, 1],
      "description": "语音概率（sigmoid 输出），范围 [0.0, 1.0]"
    },
    {
      "name": "hn",
      "type": "tensor(float32)",
      "shape": [1, 1, 64],
      "description": "更新后的 LSTM hidden state，必须反馈回下一帧的 h 输入"
    },
    {
      "name": "cn",
      "type": "tensor(float32)",
      "shape": [1, 1, 64],
      "description": "更新后的 LSTM cell state，必须反馈回下一帧的 c 输入"
    }
  ]
}
```

### 推理调用时序

```json
{
  "重复周期": "每 32ms 执行一次（Timer.periodic）",
  "前置条件": "VAD 内部缓冲区累积 ≥512 个 Float64 采样点",
  "状态管理": "每次推理后提取 hn/cn 覆盖 _h/_c，供下一帧使用",
  "重置时机": "SileroVadEngine.load() / resetStates() 时 _h/_c 归零",
  "帧对齐":  "输入不足 512 采样点时补零，超出时截断到前 512 个"
}
```

---

## 附录

### 通道汇总表

| 通道名 | 协议 | 方向 | 数据量 | 实时性要求 |
|--------|------|------|--------|-----------|
| `com.aiassistant.mobile/state` | MethodChannel | 智能体1 → 对端 | 极少（事件驱动） | 低 |
| `com.aiassistant.mobile/state_events` | EventChannel | 对端 → 智能体1 | 极少（指令驱动） | 低 |
| `com.aiassistant.mobile/audio_data` | BasicMessageChannel | 智能体1 → 对端 | 高（~32KB/s） | 高 |
| `com.aiassistant.mobile/foreground_service` | MethodChannel | Dart → 原生 | 极少 | 低 |
| `com.aiassistant.mobile/noise_suppression` | MethodChannel | Dart → 原生 | 中（~32KB/s，当前占位） | 中 |

### 配置参考表

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 采样率 | 16000 Hz | 固定 |
| 位深 | 16 bit | 固定 |
| 声道 | 1 (mono) | 固定 |
| VAD 帧大小 | 512 采样点 | 对应 32ms |
| VAD 检测间隔 | 32ms | 与帧大小同频 |
| 语音阈值 | 0.5 | Silero VAD sigmoid 输出 |
| 最小录音触发帧 | 3 帧 | 对应 ~96ms 连续语音 |
| 静音超时帧数 | 48 帧 | 对应 ~1.5s 静音 |
| 降噪原生可用 | 取决于设备 | 否时回退到噪声门 |
| 前台服务类型 | microphone | Android 14+ 要求 |
| WakeLock 时长 | 最长 4 小时 | PARTIAL_WAKE_LOCK |
