# AI 录音助手 — 移动端 (Flutter)

## 智能体1：音频采集与 VAD 引擎

本模块实现移动端（Android/iOS）的音频采集、语音活动检测（VAD）和状态管理，作为整个 AI 录音助手的感知层。

---

## 目录结构

```
app/mobile/
├── lib/
│   ├── main.dart                    # 应用入口 + 调试 UI
│   ├── audio/
│   │   ├── audio_capture.dart       # PCM 音频采集 (16kHz/16bit/mono)
│   │   ├── audio_processor.dart     # WebRTC 降噪处理 + 格式转换
│   │   ├── audio_pipeline.dart      # 顶层管线: 编排采集→降噪→VAD→输出
│   │   └── vad/
│   │       ├── vad_engine.dart       # VAD 抽象接口 + 状态机
│   │       └── silero_vad.dart      # Silero VAD ONNX 推理引擎
│   ├── bridge/
│   │   └── state_channel.dart       # 状态消息桥接 (智能体1→智能体2)
│   ├── models/
│   │   └── audio_state.dart         # 数据模型定义
│   ├── permission/
│   │   └── permission_manager.dart  # 运行时权限管理
│   ├── service/
│   │   ├── foreground_service.dart  # 前台服务管理器 (Dart)
│   │   └── notification_manager.dart# 通知栏管理
│   └── utils/
│       ├── constants.dart           # 全局常量
│       └── logger.dart              # 日志工具
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml      # 权限声明 + Service 注册
│       └── kotlin/com/aiassistant/mobile/
│           ├── MainActivity.kt      # Flutter 入口 + 插件注册
│           ├── service/
│           │   ├── AudioForegroundService.kt     # 前台 Service
│           │   └── ForegroundServicePlugin.kt    # MethodChannel 插件
│           └── permission/
│               └── NoiseSuppressionPlugin.kt     # 降噪桥接 (占位)
├── ios/
│   ├── Podfile                      # CocoaPods 配置
│   └── Runner/Info.plist            # 权限描述 + 后台模式
├── assets/models/                   # ONNX 模型文件 (需手动下载)
├── scripts/
│   └── download_silero_vad.sh       # 模型下载脚本
├── test/
│   └── vad_state_machine_test.dart  # VAD 状态机单元测试
└── pubspec.yaml                     # 依赖声明
```

---

## 架构流程

```
┌─────────────────────────────────────────────────────────────────┐
│                  AudioPipeline (顶层编排)                       │
├──────────┬──────────┬──────────────┬───────────┬───────────────┤
│ Permission│ Audio    │ Audio        │ VAD       │ StateChannel  │
│ Manager   │ Capture  │ Processor    │ Engine    │ (Bridge)      │
│           │          │              │           │               │
│ 权限申请   │ 16kHz    │ WebRTC NS   │ Silero    │ 状态消息 →    │
│ 麦克风     │ 16bit    │ 噪声门降级   │ ONNX 推理  │ PCM 流 →      │
│ 通知       │ mono     │ 格式转换     │ 状态机     │ 智能体2       │
└──────────┴──────────┴──────────────┴───────────┴───────────────┘
```

### 数据流

```
麦克风 → PCM (16kHz/16bit/mono) → 降噪处理 → VAD 检测 → 状态输出
                                          ↘ PCM 流 → 智能体2 (P2P)
```

### 状态机

```
idle → (start) → listening → (语音检测) → recording → (静音超时) → listening
                    ↓                                              ↓
                 (错误) → error → (重置) → idle          (停止) → idle
```

---

## 核心模块说明

### 1. 权限管理 (`PermissionManager`)

- 请求麦克风、通知、忽略电池优化权限
- 检查权限状态（不弹窗）
- 引导用户打开系统设置（被永久拒绝时）

### 2. 音频采集 (`AudioCapture`)

- 基于 `record` 包实现
- 参数：16000Hz / 16bit / 单声道 / PCM
- 输出：`ByteData` 流

### 3. 降噪处理 (`AudioProcessor`)

- 优先调用原生 WebRTC NS (通过 MethodChannel)
- 原生不可用时回退到自适应噪声门
- 提供 ByteData ↔ Float64 格式转换工具

### 4. VAD 检测 (`SileroVadEngine`)

- 基于 Silero VAD v5 ONNX 模型
- 使用 `onnxruntime_flutter` 推理引擎
- 输入：512 采样点 / 帧 (32ms @ 16kHz)
- 管理 LSTM hidden state (64维)
- 输出：语音概率 (0.0~1.0)

### 5. 前台服务 (`ForegroundService` + Kotlin 原生)

- Android foreground service 保活
- 常驻通知栏，显示当前状态（监听中/录音中/异常）
- WakeLock 防止 CPU 休眠
- START_STICKY 自动重启

### 6. 状态桥接 (`StateChannel`)

- MethodChannel 发布状态消息
- EventChannel 接收外部指令
- BasicMessageChannel 传输 PCM 数据
- **状态格式**: `{"type":"status","state":"listening|recording|error","detail":""}`

---

## 快速开始

### 前置条件

- Flutter SDK >= 3.2.0
- Dart SDK >= 3.2.0
- Android Studio / Xcode
- Android: minSdk 24, targetSdk 34

### 1. 下载 VAD 模型

```bash
cd app/mobile
chmod +x scripts/download_silero_vad.sh
./scripts/download_silero_vad.sh
```

### 2. 安装依赖

```bash
flutter pub get
cd ios && pod install && cd ..
```

### 3. 运行

```bash
# Android
flutter run

# iOS
flutter run --no-sound-null-safety
```

### 4. 运行测试

```bash
flutter test
```

---

## 对外接口

### 状态消息格式

```json
{
  "type": "status",
  "state": "listening|recording|error",
  "detail": ""
}
```

### PCM 音频格式

| 参数 | 值 |
|------|-----|
| 采样率 | 16000 Hz |
| 位深 | 16 bit (signed LE) |
| 声道数 | 1 (mono) |
| 编码 | 原始 PCM |

---

## 依赖

| 包 | 用途 | 版本 |
|----|------|------|
| `permission_handler` | 运行时权限管理 | ^11.3.0 |
| `flutter_foreground_task` | 前台服务保活 | ^8.12.0 |
| `flutter_local_notifications` | 通知栏管理 | ^17.2.0 |
| `record` | 音频采集 | ^5.1.2 |
| `onnxruntime_flutter` | ONNX 推理引擎 | ^1.0.4 |
| `synchronized` | 异步锁 | ^3.1.0 |
| `logging` | 日志输出 | ^1.2.0 |
| `path_provider` | 应用目录 | ^2.1.2 |

---

## 后续优化

- [ ] 集成 WebRTC NS 原生库
- [ ] 自适应噪声门算法优化
- [ ] 音量表 (VU Meter)
- [ ] 音频录制缓存
- [ ] iOS 原生前台 Service (AVAudioSession)
