import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';

import '../utils/logger.dart';
import '../utils/constants.dart';
import '../models/audio_state.dart';

/// ====================================================================
///  状态消息桥接通道
///
///  智能体1 → 智能体2 的状态传输通道
///
///  功能:
///  1. 通过 MethodChannel 发布状态消息
///  2. 通过 EventChannel 接收外部指令（启动/停止）
///  3. 维护 PCM 数据包序列号
///  4. 输出格式: {"type":"status","state":"listening|recording|error","detail":""}
/// ====================================================================
class StateChannel {
  final AppLogger _log = AppLogger('StateChannel');

  /// 状态发布通道 (MethodChannel)
  static const MethodChannel _stateChannel = MethodChannel(
    BridgeConstants.stateChannelName,
  );

  /// 指令接收通道 (EventChannel)
  static const EventChannel _commandChannel = EventChannel(
    BridgeConstants.stateEventChannelName,
  );

  /// PCM 数据发布通道 (BasicMessageChannel 用于大数据传输)
  static const BasicMessageChannel _audioChannel = BasicMessageChannel(
    'com.aiassistant.mobile/audio_data',
    StandardMessageCodec(),
  );

  /// 外部监听: 收到来自智能体2 或 PC 端的指令
  final StreamController<Map<String, dynamic>> _commandController =
      StreamController<Map<String, dynamic>>.broadcast();

  /// PCM 包序号
  int _sequenceNumber = 0;

  StreamSubscription? _commandSubscription;

  /// 是否已初始化
  bool _initialized = false;

  /// 指令流（外部监听）
  Stream<Map<String, dynamic>> get commandStream => _commandController.stream;

  /// 初始化（监听指令通道）
  Future<void> ensureInitialized() async {
    if (_initialized) return;
    _initialized = true;
    _log.i('状态通道初始化');

    // 监听来自原生/对端的指令
    _commandSubscription = _commandChannel
        .receiveBroadcastStream()
        .listen((dynamic event) {
      if (event is Map) {
        final map = Map<String, dynamic>.from(event as Map);
        _log.i('收到指令: $map');
        _commandController.add(map);
      } else if (event is String) {
        try {
          final map = jsonDecode(event) as Map<String, dynamic>;
          _log.i('收到指令(JSON): $map');
          _commandController.add(map);
        } catch (e) {
          _log.w('指令解析失败: $event');
        }
      }
    }, onError: (error) {
      _log.e('指令通道错误', error);
    });
  }

  // ========================================
  //  状态发布
  // ========================================

  /// 广播状态变化 (格式: {"type":"status","state":"...","detail":"..."})
  void broadcastState(AudioWorkState state, {String detail = ''}) {
    final msg = StatusMessage.status(state, detail: detail);
    final jsonStr = msg.toJsonString();
    _log.i('广播状态: $jsonStr');

    try {
      _stateChannel.invokeMethod<void>('onStateChanged', msg.toJson());
    } catch (e) {
      // 通道未就绪时静默忽略
      _log.v('状态通道未就绪: $e');
    }
  }

  /// 广播错误消息
  void broadcastError(String detail) {
    final msg = StatusMessage.error(detail);
    _log.w('广播错误: ${msg.toJsonString()}');

    try {
      _stateChannel.invokeMethod<void>('onError', msg.toJson());
    } catch (_) {}
  }

  // ========================================
  //  PCM 数据发送
  // ========================================

  /// 发送 PCM 数据包给智能体2
  void sendAudioData(List<int> pcmBytes) {
    final timestampMs = DateTime.now().millisecondsSinceEpoch;
    final packet = PcmPacket(
      data: pcmBytes,
      timestampMs: timestampMs,
      sequenceNumber: _sequenceNumber++,
    );

    try {
      _audioChannel.send(<dynamic>[
        packet.sequenceNumber,
        packet.timestampMs,
        packet.sampleRate,
        packet.bitsPerSample,
        packet.channels,
        pcmBytes,
      ]);
    } catch (e) {
      _log.v('音频通道未就绪: $e');
    }
  }

  /// 重置序号
  void resetSequence() {
    _sequenceNumber = 0;
  }

  // ========================================
  //  释放
  // ========================================

  void dispose() {
    _commandSubscription?.cancel();
    _commandController.close();
    _initialized = false;
  }
}
