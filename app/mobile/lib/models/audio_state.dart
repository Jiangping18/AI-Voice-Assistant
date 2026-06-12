/// 音频采集器的工作状态枚举
enum AudioWorkState {
  /// 空闲/未启动
  idle,

  /// 监听中（VAD 静音，等待人声）
  listening,

  /// 录音中（VAD 检测到人声，正在缓存）
  recording,

  /// 发生错误
  error,
}

/// 状态类型 —— 用于外部消息桥接
enum StatusType {
  /// 状态变更
  status,

  /// 音频数据
  audio,

  /// 错误信息
  error,
}

/// 标准化状态消息，用于智能体1 → 智能体2 的状态桥接
///
/// 序列化格式: {"type":"status","state":"listening|recording|error","detail":""}
class StatusMessage {
  final StatusType type;
  final AudioWorkState state;
  final String detail;

  const StatusMessage({
    required this.type,
    required this.state,
    this.detail = '',
  });

  /// 便捷构造：状态变更消息
  factory StatusMessage.status(AudioWorkState state, {String detail = ''}) {
    return StatusMessage(
      type: StatusType.status,
      state: state,
      detail: detail,
    );
  }

  /// 便捷构造：错误消息
  factory StatusMessage.error(String detail) {
    return StatusMessage(
      type: StatusType.error,
      state: AudioWorkState.error,
      detail: detail,
    );
  }

  /// 序列化为 JSON Map（供桥接层转发）
  Map<String, dynamic> toJson() => {
        'type': type.name,
        'state': state.name,
        if (detail.isNotEmpty) 'detail': detail,
      };

  /// 序列化为 JSON 字符串
  String toJsonString() {
    final buf = StringBuffer();
    buf.write('{"type":"${type.name}","state":"${state.name}"');
    if (detail.isNotEmpty) {
      buf.write(',"detail":"${_escapeJson(detail)}"');
    }
    buf.write('}');
    return buf.toString();
  }

  static String _escapeJson(String s) {
    return s
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\t', '\\t');
  }

  @override
  String toString() => 'StatusMessage(${type.name}, ${state.name}, $detail)';
}

/// VAD 检测结果
class VadResult {
  /// 语音概率 (0.0 ~ 1.0)
  final double probability;

  /// 是否判定为有语音
  final bool isSpeech;

  /// 时间戳 (毫秒)
  final int timestampMs;

  const VadResult({
    required this.probability,
    required this.isSpeech,
    required this.timestampMs,
  });

  @override
  String toString() =>
      'VadResult(speech=$isSpeech, prob=${probability.toStringAsFixed(3)}, ts=${timestampMs}ms)';
}

/// PCM 音频数据包，供智能体2 传输使用
class PcmPacket {
  /// 16kHz / 16bit / mono PCM 字节数据
  final List<int> data;

  /// 采样率 (固定 16000)
  final int sampleRate;

  /// 位深 (固定 16)
  final int bitsPerSample;

  /// 声道数 (固定 1)
  final int channels;

  /// 时间戳 (毫秒)
  final int timestampMs;

  /// 序列号，用于对端重组
  final int sequenceNumber;

  const PcmPacket({
    required this.data,
    this.sampleRate = 16000,
    this.bitsPerSample = 16,
    this.channels = 1,
    required this.timestampMs,
    required this.sequenceNumber,
  });

  /// 数据时长 (毫秒)
  int get durationMs => (data.length / (sampleRate * channels * (bitsPerSample ~/ 8)) * 1000).round();

  /// 序列化为 JSON Map
  Map<String, dynamic> toJson() => {
        'sampleRate': sampleRate,
        'bitsPerSample': bitsPerSample,
        'channels': channels,
        'timestampMs': timestampMs,
        'sequenceNumber': sequenceNumber,
        'dataLength': data.length,
      };

  @override
  String toString() =>
      'PcmPacket(seq=$sequenceNumber, ${data.length}B, ${durationMs}ms)';
}
