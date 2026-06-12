import 'dart:async';
import 'dart:typed_data';
import 'package:record/record.dart';

import '../utils/logger.dart';
import '../utils/constants.dart';

/// 音频数据回调
typedef PcmCallback = void Function(ByteData pcmData);

/// ====================================================================
///  音频采集器
///
///  使用 record 包实现 16kHz / 16bit / 单声道 PCM 采集。
///
///  输出: Float32List / ByteData 格式的 PCM 采样点
/// ====================================================================
class AudioCapture {
  final AppLogger _log = AppLogger('AudioCapture');

  final AudioRecorder _recorder = AudioRecorder();

  /// 采集状态
  bool _isCapturing = false;
  bool get isCapturing => _isCapturing;

  /// PCM 数据输出流（广播）
  final StreamController<ByteData> _pcmStreamController =
      StreamController<ByteData>.broadcast();
  Stream<ByteData> get pcmStream => _pcmStreamController.stream;

  /// 音频流订阅
  StreamSubscription<RecordState>? _recorderStateSub;

  /// 开始采集
  ///
  /// [onData] - 可选，每帧 PCM 数据回调
  Future<bool> start({PcmCallback? onData}) async {
    if (_isCapturing) {
      _log.w('采集器已在运行');
      return true;
    }

    try {
      // 检查麦克风是否可用
      final hasMic = await _recorder.hasPermission();
      if (!hasMic) {
        _log.e('麦克风权限未授予');
        return false;
      }

      // 配置音频编码参数
      // record 包支持的 encoder: pcm16bits, wav, aac, etc.
      // 这里使用原始 PCM 流获取最底层数据
      final config = RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        numChannels: AudioConstants.channels,     // 1 (单声道)
        sampleRate: AudioConstants.sampleRate,     // 16000 Hz
        bitRate: AudioConstants.sampleRate * AudioConstants.bitsPerSample, // 256000
      );

      _log.i('开始音频采集: ${config.sampleRate}Hz/${config.numChannels}ch/${AudioConstants.bitsPerSample}bit');

      // 启动音频流
      final stream = await _recorder.startStream(config);

      // 监听 PCM 数据流
      _recorderStateSub = _recorder.onStateChanged().listen((state) {
        _log.v('录音器状态: $state');
      });

      // 处理流数据
      _isCapturing = true;
      _processStream(stream, onData);

      return true;
    } catch (e, s) {
      _log.e('启动音频采集失败', e, s);
      _isCapturing = false;
      return false;
    }
  }

  /// 处理音频流
  void _processStream(Stream<Uint8List> stream, PcmCallback? onData) {
    stream.listen(
      (Uint8List data) {
        if (!_isCapturing) return;

        // 转换为 ByteData 供下游处理
        final byteData = ByteData.view(data.buffer, 0, data.length);
        _pcmStreamController.add(byteData);
        onData?.call(byteData);
      },
      onError: (error) {
        _log.e('音频流错误', error);
        _isCapturing = false;
      },
      onDone: () {
        _log.i('音频流结束');
        _isCapturing = false;
      },
      cancelOnError: false,
    );
  }

  /// 停止采集
  Future<void> stop() async {
    if (!_isCapturing) return;

    _isCapturing = false;
    await _recorderStateSub?.cancel();
    _recorderStateSub = null;

    try {
      await _recorder.stop();
      _log.i('音频采集已停止');
    } catch (e, s) {
      _log.e('停止音频采集异常', e, s);
    }
  }

  /// 释放资源
  void dispose() {
    _pcmStreamController.close();
    _recorder.dispose();
  }
}
