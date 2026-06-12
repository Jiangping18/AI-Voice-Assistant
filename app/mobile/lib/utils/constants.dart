/// ====================================================================
///  全局常量定义
/// ====================================================================

/// 音频参数
class AudioConstants {
  AudioConstants._();

  /// 目标采样率 (Hz)
  static const int sampleRate = 16000;

  /// 位深
  static const int bitsPerSample = 16;

  /// 声道数（单声道）
  static const int channels = 1;

  /// 每个 VAD 推理帧的采样点数 (Silero VAD 推荐)
  static const int vadFrameSamples = 512;

  /// VAD 帧时长 ≈ 32ms @ 16kHz
  static const double vadFrameDurationMs = 32.0;

  /// PCM 读取缓冲区大小 (4096 采样点 ≈ 256ms)
  static const int readBufferSamples = 4096;

  /// 降噪处理帧大小 (WebRTC NS 要求 160 采样点 / 10ms)
  static const int nsFrameSamples = 160;
}

/// VAD 阈值与时间参数
class VadConstants {
  VadConstants._();

  /// 语音判定阈值（Silero VAD 默认建议 0.5）
  static const double speechThreshold = 0.5;

  /// 静音判定阈值
  static const double silenceThreshold = 0.3;

  /// 触发录音前需要的连续语音帧数
  static const int minSpeechFrames = 3;

  /// 停止录音前允许的连续静音帧数 (约 1.5 秒)
  static const int maxSilenceFrames = 48;

  /// VAD 检测间隔 (毫秒)
  static const int vadIntervalMs = 32;
}

/// 前台服务常量
class ServiceConstants {
  ServiceConstants._();

  /// 通知渠道 ID
  static const String notificationChannelId = 'ai_voice_assistant_channel';

  /// 通知渠道名称
  static const String notificationChannelName = 'AI 录音助手';

  /// 通知渠道描述
  static const String notificationChannelDesc = '显示录音助手运行状态';

  /// 通知 ID
  static const int notificationId = 1001;

  /// 前台服务 ID
  static const int foregroundServiceId = 1001;
}

/// 外部桥接消息 key
class BridgeConstants {
  BridgeConstants._();

  /// 状态通道名称 (MethodChannel)
  static const String stateChannelName = 'com.aiassistant.mobile/state';

  /// 状态事件通道名称 (EventChannel)
  static const String stateEventChannelName = 'com.aiassistant.mobile/state_events';
}
