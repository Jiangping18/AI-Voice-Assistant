import 'dart:async';
import 'dart:typed_data';

import '../utils/logger.dart';
import '../utils/constants.dart';
import '../models/audio_state.dart';
import '../bridge/state_channel.dart';
import '../service/foreground_service.dart';
import 'audio_capture.dart';
import 'audio_processor.dart';
import 'vad/vad_engine.dart';

/// 状态变更回调
typedef StateChangedCallback = void Function(AudioWorkState state);

/// ====================================================================
///  音频采集顶层管线
///
///  编排:
///  AudioCapture → AudioProcessor(降噪) → Silero VAD → StateChannel
///                                    ↘  PCM 流 → 智能体2
///
///  状态机: idle → listening → recording → listening → ... → idle
///
///  对外接口:
///   - start(): 启动采集管线
///   - stop():  停止采集管线
///   - currentState: 当前状态
/// ====================================================================
class AudioPipeline {
  final AppLogger _log = AppLogger('AudioPipeline');

  final AudioCapture _audioCapture;
  final AudioProcessor _audioProcessor;
  final VadEngine _vadEngine;
  final StateChannel _stateChannel;
  final ForegroundService _foregroundService;
  final StateChangedCallback? _onStateChanged;

  /// VAD 状态机
  final VadStateMachine _vadStateMachine = VadStateMachine();

  /// VAD 帧缓冲区 (累积到 512 采样点)
  final List<double> _vadBuffer = [];

  /// 音频流订阅
  StreamSubscription<ByteData>? _pcmSub;

  /// 运行标志
  bool _isRunning = false;
  bool get isRunning => _isRunning;

  /// 当前状态
  AudioWorkState _currentState = AudioWorkState.idle;
  AudioWorkState get currentState => _currentState;

  /// VAD 检测定时器
  Timer? _vadTimer;

  /// 帧时间戳 (毫秒)
  int _frameTimestampMs = 0;

  /// 连续无 VAD 帧计数 (降级检测用)
  int _idleFrameCount = 0;

  AudioPipeline({
    required AudioCapture audioCapture,
    required AudioProcessor audioProcessor,
    required VadEngine vadEngine,
    required StateChannel stateChannel,
    ForegroundService? foregroundService,
    StateChangedCallback? onStateChanged,
  })  : _audioCapture = audioCapture,
        _audioProcessor = audioProcessor,
        _vadEngine = vadEngine,
        _stateChannel = stateChannel,
        _foregroundService = foregroundService ?? ForegroundService(),
        _onStateChanged = onStateChanged {

    // 监听 VAD 状态机变化
    _vadStateMachine.onStateChange = _onVadMachineStateChange;
  }

  // ========================================
  //  生命周期
  // ========================================

  /// 启动采集管线
  Future<void> start() async {
    if (_isRunning) {
      _log.w('管线已在运行');
      return;
    }

    _log.i('===== 启动音频采集管线 =====');

    try {
      // 1) 初始化降噪
      await _audioProcessor.init();

      // 2) 确保 VAD 模型已加载
      if (!_vadEngine.isLoaded) {
        await _vadEngine.load();
      }

      // 3) 启动前台 Service
      await _foregroundService.start(text: '正在启动...');

      // 4) 启动音频采集
      final started = await _audioCapture.start(onData: _onPcmData);
      if (!started) {
        throw StateError('音频采集启动失败');
      }

      // 5) 启动 VAD 定时检测
      _startVadTimer();

      // 6) 切换到 listening
      _isRunning = true;
      _updateState(_vadStateMachine.startListening());

      _log.i('音频采集管线启动完成');
      _foregroundService.updateNotification('监听中');
    } catch (e, s) {
      _log.e('启动管线失败', e, s);
      _updateState(AudioWorkState.error);
      _stateChannel.broadcastError('启动失败: $e');
      await _cleanup();
    }
  }

  /// 停止采集管线
  Future<void> stop() async {
    if (!_isRunning) return;
    _log.i('===== 停止音频采集管线 =====');

    _vadTimer?.cancel();
    _isRunning = false;

    await _cleanup();

    _updateState(AudioWorkState.idle);
    _foregroundService.updateNotification('已停止');
  }

  /// 清理资源
  Future<void> _cleanup() async {
    await _pcmSub?.cancel();
    _pcmSub = null;
    await _audioCapture.stop();
    _vadBuffer.clear();
    _idleFrameCount = 0;

    await _foregroundService.stop();
    _log.i('管线资源已释放');
  }

  // ========================================
  //  PCM 数据回调 (来自 AudioCapture)
  // ========================================

  void _onPcmData(ByteData pcmData) {
    if (!_isRunning) return;

    _frameTimestampMs = DateTime.now().millisecondsSinceEpoch;

    // 1) 降噪处理
    _audioProcessor.process(pcmData).then((processed) {
      if (!_isRunning) return;

      // 2) 转发 PCM 给智能体2
      _stateChannel.sendAudioData(
        processed.buffer.asUint8List(),
      );

      // 3) 提取 Float64 采样点 → 送入 VAD 缓冲区
      final samples = AudioProcessor.byteDataToFloat64(processed);
      _vadBuffer.addAll(samples);

      // 4) 缓冲区满 → 触发 VAD 检测 (在定时器中处理)
    });
  }

  // ========================================
  //  VAD 定时检测 (每 ~32ms)
  // ========================================

  void _startVadTimer() {
    _vadTimer?.cancel();
    _vadTimer = Timer.periodic(
      Duration(milliseconds: AudioConstants.vadFrameDurationMs.round()),
      (_) => _runVadCycle(),
    );
  }

  void _runVadCycle() {
    if (!_isRunning) return;

    // 检查缓冲区是否足够
    if (_vadBuffer.length < _vadEngine.frameSize) {
      return;
    }

    // 取出一个 VAD 帧
    final frame = _vadBuffer.sublist(0, _vadEngine.frameSize);
    _vadBuffer.removeRange(0, _vadEngine.frameSize);

    // 执行 VAD
    try {
      final vadResult = _vadEngine.detectSync(frame);

      // 送入状态机
      final result = VadResult(
        probability: vadResult,
        isSpeech: vadResult >= 0.5,
        timestampMs: _frameTimestampMs,
      );

      final newState = _vadStateMachine.feedVadResult(result);

      // 更新状态 (仅在发生变化时)
      if (newState != _currentState) {
        _updateState(newState);
      }
    } catch (e, s) {
      _log.e('VAD 检测异常', e, s);
      _idleFrameCount++;

      if (_idleFrameCount > 300) {
        // 连续失败超过 10 秒 → 报错
        _updateState(AudioWorkState.error);
        _stateChannel.broadcastError('VAD 引擎异常');
      }
    }
  }

  // ========================================
  //  状态管理
  // ========================================

  void _updateState(AudioWorkState newState) {
    if (newState == _currentState) return;

    final oldState = _currentState;
    _currentState = newState;
    _log.i('状态变更: ${oldState.name} → ${newState.name}');

    // 广播状态消息
    _stateChannel.broadcastState(newState);

    // 更新通知栏
    String stateText;
    switch (newState) {
      case AudioWorkState.listening:
        stateText = '监听中';
        break;
      case AudioWorkState.recording:
        stateText = '录音中';
        break;
      case AudioWorkState.error:
        stateText = '异常';
        break;
      default:
        stateText = '就绪';
    }
    _foregroundService.updateNotification(stateText);

    // 外部回调
    _onStateChanged?.call(newState);
  }

  void _onVadMachineStateChange(AudioWorkState oldState, AudioWorkState newState) {
    _log.i('VAD 状态机: ${oldState.name} → ${newState.name}');

    if (newState == AudioWorkState.recording) {
      // 进入录音状态: 记录开始时间
      _stateChannel.broadcastState(AudioWorkState.recording, detail: 'start');
    } else if (newState == AudioWorkState.listening && oldState == AudioWorkState.recording) {
      // 从录音回到监听: 发送结束标记
      _stateChannel.broadcastState(AudioWorkState.listening, detail: 'segment_end');
    }
  }

  /// 释放全部资源
  Future<void> dispose() async {
    await stop();
    _vadEngine.unload();
    _audioCapture.dispose();
    await _audioProcessor.dispose();
    _foregroundService.dispose();
    _stateChannel.dispose();
    _log.i('音频管线已完全释放');
  }
}
