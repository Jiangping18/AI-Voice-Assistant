import 'dart:async';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/services.dart';

import '../utils/logger.dart';
import '../utils/constants.dart';

/// ====================================================================
///  音频处理器
///
///  功能:
///  1. WebRTC 降噪 (通过原生平台通道)
///  2. 降噪不可用时的降级处理 (简单噪声门)
///  3. PCM 格式标准化 (16kHz/16bit/mono)
/// ====================================================================
class AudioProcessor {
  final AppLogger _log = AppLogger('AudioProcessor');

  /// WebRTC NS 原生通道 (Android JNI / iOS)
  static const MethodChannel _nsChannel = MethodChannel(
    'com.aiassistant.mobile/noise_suppression',
  );

  /// 是否已初始化原生降噪引擎
  bool _nsInitialized = false;

  /// 原生降噪是否可用
  bool _nsAvailable = false;

  /// 处理后的 PCM 输出流
  final StreamController<ByteData> _outputStreamController =
      StreamController<ByteData>.broadcast();
  Stream<ByteData> get outputStream => _outputStreamController.stream;

  /// 内部缓冲区 (ByteData → Float32 转换用)
  final List<double> _floatBuffer = [];

  // ========================================
  //  初始化
  // ========================================

  /// 初始化降噪引擎
  Future<void> init() async {
    try {
      final result = await _nsChannel.invokeMethod<bool>('init');
      _nsAvailable = result == true;
      _nsInitialized = true;
      _log.i('原生降噪引擎初始化: ${_nsAvailable ? "可用" : "不可用"}');
    } catch (e) {
      _nsInitialized = true;
      _nsAvailable = false;
      _log.w('原生降噪不可用，使用降级处理: $e');
    }
  }

  // ========================================
  //  降噪处理
  // ========================================

  /// 处理 PCM 数据块
  ///
  /// [pcmData] - 原始 PCM 字节 (16bit little-endian)
  /// 返回降噪后的 PCM 字节
  Future<ByteData> process(ByteData pcmData) async {
    if (_nsAvailable) {
      return _processWithNative(pcmData);
    }
    return _processWithNoiseGate(pcmData);
  }

  /// 原生 WebRTC 降噪
  Future<ByteData> _processWithNative(ByteData pcmData) async {
    try {
      final params = <String, dynamic>{
        'audioData': pcmData.buffer.asUint8List(),
        'sampleRate': AudioConstants.sampleRate,
      };

      final result = await _nsChannel.invokeMethod<Uint8List>('process', params);
      if (result != null) {
        return ByteData.view(result.buffer, 0, result.length);
      }
    } catch (e) {
      _log.w('原生降噪失败，回退到噪声门: $e');
      _nsAvailable = false;
    }
    return _processWithNoiseGate(pcmData);
  }

  /// 噪声门降级处理 (简易自适应噪声门)
  ///
  /// 原理:
  /// 1. 估算背景噪声能量
  /// 2. 低于阈值时静音
  /// 3. 高于阈值时增益恢复
  ByteData _processWithNoiseGate(ByteData pcmData) {
    final sampleCount = pcmData.lengthInBytes ~/ 2;
    if (sampleCount == 0) return pcmData;

    // 读取所有采样点 (16bit LE → double)
    final samples = Float64List(sampleCount);
    double sumSq = 0;
    for (int i = 0; i < sampleCount; i++) {
      final s = pcmData.getInt16(i * 2, Endian.little).toDouble();
      samples[i] = s;
      sumSq += s * s;
    }

    // 计算 RMS 能量
    final rms = sqrt(sumSq / sampleCount);

    // 自适应噪声门限 (基于历史最小值)
    // 简化为固定阈值 (-50dB ≈ 3.16 对于 16bit 信号)
    const double noiseGateThreshold = 10.0; // 16bit 范围 0~32768

    if (rms < noiseGateThreshold) {
      // 低于门限 → 静音
      final silent = ByteData(pcmData.lengthInBytes);
      for (int i = 0; i < pcmData.lengthInBytes; i++) {
        silent.setInt8(i, 0);
      }
      return silent;
    }

    // 高于门限 → 轻微增益补偿 (1.0x 不变)
    return pcmData;
  }

  // ========================================
  //  格式转换工具
  // ========================================

  /// ByteData (16bit LE) → Float32List (-1.0 ~ 1.0)
  static Float64List byteDataToFloat64(ByteData data) {
    final count = data.lengthInBytes ~/ 2;
    final result = Float64List(count);
    for (int i = 0; i < count; i++) {
      result[i] = data.getInt16(i * 2, Endian.little) / 32768.0;
    }
    return result;
  }

  /// Float32List (-1.0 ~ 1.0) → ByteData (16bit LE)
  static ByteData float64ToByteData(Float64List samples) {
    final data = ByteData(samples.length * 2);
    for (int i = 0; i < samples.length; i++) {
      // 裁剪到 [-1.0, 1.0]
      final clamped = samples[i].clamp(-1.0, 1.0);
      data.setInt16(i * 2, (clamped * 32767).round(), Endian.little);
    }
    return data;
  }

  /// 从 ByteData 提取 VAD 所需的 Float64 帧
  static Float64List extractFrame(ByteData data, int frameSize) {
    final samples = byteDataToFloat64(data);
    if (samples.length >= frameSize) {
      return samples.sublist(0, frameSize);
    }
    // 不足则补零
    final result = Float64List(frameSize);
    result.setAll(0, samples);
    return result;
  }

  // ========================================
  //  释放
  // ========================================

  Future<void> dispose() async {
    if (_nsAvailable) {
      try {
        await _nsChannel.invokeMethod<void>('release');
      } catch (_) {}
    }
    _outputStreamController.close();
  }
}

