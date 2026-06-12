import '../../models/audio_state.dart';

/// ====================================================================
///  VAD 引擎抽象接口
///
///  支持不同 VAD 模型实现 (Silero / WebRTC VAD 等)
/// ====================================================================
abstract class VadEngine {
  /// 加载模型（异步，可能耗时）
  Future<void> load();

  /// 卸载模型，释放资源
  Future<void> unload();

  /// 是否已加载
  bool get isLoaded;

  /// 输入的采样率要求 (Hz)
  int get requiredSampleRate;

  /// 每次推理需要的采样点数
  int get frameSize;

  /// 对一段 PCM 数据进行语音活动检测
  ///
  /// [pcmSamples] - 原始 PCM 采样点 (Float32, 范围 -1.0 ~ 1.0)
  /// 返回语音概率 (0.0 ~ 1.0)
  Future<double> detectAsync(List<double> pcmSamples);

  /// 同步检测（用于低延迟场景）
  double detectSync(List<double> pcmSamples);

  /// 重置内部状态 (LSTM hidden state 等)
  void resetStates();
}

/// ====================================================================
///  VAD 状态机
///
///  管理 idle → listening → recording 状态转换
/// ====================================================================
class VadStateMachine {
  /// 当前工作状态
  AudioWorkState _state = AudioWorkState.idle;

  /// 连续语音帧计数
  int _speechFrameCount = 0;

  /// 连续静音帧计数
  int _silenceFrameCount = 0;

  /// 外部状态变更回调
  void Function(AudioWorkState oldState, AudioWorkState newState)? onStateChange;

  AudioWorkState get currentState => _state;

  /// 重置为 idle
  void reset() {
    final old = _state;
    _state = AudioWorkState.idle;
    _speechFrameCount = 0;
    _silenceFrameCount = 0;
    if (old != AudioWorkState.idle) {
      onStateChange?.call(old, AudioWorkState.idle);
    }
  }

  /// 喂入一次 VAD 检测结果，更新状态
  ///
  /// 返回当前工作状态
  AudioWorkState feedVadResult(VadResult result) {
    if (_state == AudioWorkState.idle) {
      // idle 状态下不处理 VAD，需要外部调用 start()
      return _state;
    }

    if (_state == AudioWorkState.error) {
      return _state;
    }

    if (result.isSpeech) {
      _speechFrameCount++;
      _silenceFrameCount = 0;

      if (_state == AudioWorkState.listening &&
          _speechFrameCount >= 3) {
        // 连续 N 帧语音 → 切换到 recording
        return _transitionTo(AudioWorkState.recording);
      }
    } else {
      _silenceFrameCount++;
      _speechFrameCount = 0;

      if (_state == AudioWorkState.recording &&
          _silenceFrameCount >= 48) {
        // 连续静音超时 → 切回 listening
        _speechFrameCount = 0;
        _silenceFrameCount = 0;
        return _transitionTo(AudioWorkState.listening);
      }
    }

    return _state;
  }

  /// 启动监听
  AudioWorkState startListening() {
    _speechFrameCount = 0;
    _silenceFrameCount = 0;
    return _transitionTo(AudioWorkState.listening);
  }

  /// 强制切换到错误状态
  AudioWorkState setError() {
    return _transitionTo(AudioWorkState.error);
  }

  AudioWorkState _transitionTo(AudioWorkState newState) {
    final old = _state;
    _state = newState;
    if (old != newState) {
      onStateChange?.call(old, newState);
    }
    return _state;
  }
}
