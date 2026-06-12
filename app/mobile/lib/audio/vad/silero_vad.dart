import 'dart:typed_data';
import 'package:flutter/services.dart' show rootBundle;
import 'package:onnxruntime_flutter/onnxruntime_flutter.dart';

import '../../utils/logger.dart';
import '../../utils/constants.dart';
import '../../models/audio_state.dart' show VadResult;
import 'vad_engine.dart';

/// ====================================================================
///  Silero VAD ONNX 引擎
///
///  基于 Silero VAD v5 模型 的 ONNX 推理实现。
///
///  模型特征:
///  - 输入: float32[1,512] 音频 + float32[1,1,64] h/c + int64[1] sr
///  - 输出: float32[1,1] 语音概率 + float32[1,1,64] hn/cn
///  - 采样率: 16kHz 固定
///  - 体积: ~1.7MB (ONNX)
/// ====================================================================
class SileroVadEngine implements VadEngine {
  final AppLogger _log = AppLogger('SileroVAD');

  OrtSession? _session;
  OrtEnv? _env;
  bool _loaded = false;

  /// LSTM 内部状态 (每个维度 1×1×64)
  Float64List _h = Float64List(64);
  Float64List _c = Float64List(64);

  /// 模型资产路径
  final String modelAssetPath;

  /// 语音判定阈值
  final double threshold;

  SileroVadEngine({
    this.modelAssetPath = 'assets/models/silero_vad.onnx',
    this.threshold = 0.5,
  });

  // ========================================
  //  VadEngine 接口实现
  // ========================================

  @override
  bool get isLoaded => _loaded;

  @override
  int get requiredSampleRate => AudioConstants.sampleRate;

  @override
  int get frameSize => AudioConstants.vadFrameSamples;

  @override
  Future<void> load() async {
    if (_loaded) return;
    _log.i('加载 Silero VAD 模型: $modelAssetPath');

    try {
      // 1) 初始化 ONNX Runtime (单例)
      _env ??= OrtEnv.instance;
      _log.i('ONNX Runtime 版本: ${_env?.version ?? "unknown"}');

      // 2) 从 assets 读取模型二进制
      final modelBytes = await rootBundle.load(modelAssetPath);
      _log.i('模型大小: ${modelBytes.lengthInBytes} bytes');

      // 3) 创建推理会话
      final opts = OrtSessionOptions();
      opts.setIntraOpNumThreads(2); // 移动端双线程
      opts.setGraphOptimizationLevel(GraphOptimizationLevel.ortEnableAll);

      _session = OrtSession.fromBuffer(
        modelBytes.buffer.asUint8List(),
        opts,
      );

      // 4) 打印输入输出签名（调试用）
      for (final e in _session!.inputs.entries) {
        _log.i('  输入: ${e.key} shape=${e.value.shape} type=${e.value.type}');
      }
      for (final e in _session!.outputs.entries) {
        _log.i('  输出: ${e.key} shape=${e.value.shape} type=${e.value.type}');
      }

      // 5) 复位状态
      resetStates();
      _loaded = true;
      _log.i('Silero VAD 加载成功');
    } catch (e, s) {
      _log.e('模型加载失败', e, s);
      rethrow;
    }
  }

  @override
  Future<void> unload() async {
    _session?.release();
    _session = null;
    _loaded = false;
    _log.i('Silero VAD 已卸载');
  }

  @override
  Future<double> detectAsync(List<double> pcmSamples) async {
    return detectSync(pcmSamples);
  }

  @override
  double detectSync(List<double> pcmSamples) {
    if (!_loaded || _session == null) {
      throw StateError('Silero VAD 模型未加载');
    }

    // 确保帧大小正确
    final samples = _alignFrame(pcmSamples);

    try {
      // ---- 构建输入张量 ----
      // input:  float32[1, 512]
      final inputData = Float32List(samples.length);
      for (int i = 0; i < samples.length; i++) {
        inputData[i] = samples[i].toDouble();
      }
      final inputTensor = OrtTensors.createTensor(inputData, [1, frameSize]);

      // h: float32[1, 1, 64]
      final hData = Float32List(64);
      for (int i = 0; i < 64; i++) {
        hData[i] = _h[i].toDouble();
      }
      final hTensor = OrtTensors.createTensor(hData, [1, 1, 64]);

      // c: float32[1, 1, 64]
      final cData = Float32List(64);
      for (int i = 0; i < 64; i++) {
        cData[i] = _c[i].toDouble();
      }
      final cTensor = OrtTensors.createTensor(cData, [1, 1, 64]);

      // sr: int64[1]
      final srTensor = OrtTensors.createTensor(
        Int64List.fromList([requiredSampleRate]),
        [1],
        OnnxRuntimeType.ORT_TYPE_INT64,
      );

      // ---- 推理 ----
      final outputs = _session!.run({
        'input': inputTensor,
        'h': hTensor,
        'c': cTensor,
        'sr': srTensor,
      });

      // ---- 提取结果 ----
      // output: float32[1, 1] → 语音概率
      // hn/cn:  float32[1, 1, 64] → 更新后状态
      final prob = outputs['output']?.data?.first ?? 0.0;

      final hnData = outputs['hn']?.data;
      final cnData = outputs['cn']?.data;
      if (hnData != null && hnData.length >= 64) {
        for (int i = 0; i < 64; i++) {
          _h[i] = hnData[i];
        }
      }
      if (cnData != null && cnData.length >= 64) {
        for (int i = 0; i < 64; i++) {
          _c[i] = cnData[i];
        }
      }

      // ---- 释放张量 ----
      for (final t in [inputTensor, hTensor, cTensor, srTensor]) {
        t.release();
      }
      for (final t in outputs.values) {
        t.release();
      }

      return prob;
    } catch (e, s) {
      _log.e('VAD 推理异常', e, s);
      rethrow;
    }
  }

  @override
  void resetStates() {
    _h = Float64List(64);
    _c = Float64List(64);
  }

  /// 便捷封装：检测并返回 VadResult
  VadResult detectAndWrap(List<double> pcmSamples, int timestampMs) {
    final prob = detectSync(pcmSamples);
    return VadResult(
      probability: prob,
      isSpeech: prob >= threshold,
      timestampMs: timestampMs,
    );
  }

  /// 对齐帧大小（填充或截断）
  List<double> _alignFrame(List<double> samples) {
    if (samples.length == frameSize) return samples;
    if (samples.length < frameSize) {
      return [...samples, ...List.filled(frameSize - samples.length, 0.0)];
    }
    return samples.sublist(0, frameSize);
  }

  /// 释放全部资源
  void dispose() {
    _session?.release();
    _session = null;
    _env?.dispose();
    _env = null;
    _loaded = false;
  }
}
