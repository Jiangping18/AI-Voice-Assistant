import 'package:logging/logging.dart' as pkg_logging;

/// 应用日志工具（基于 package:logging 封装）
///
/// 使用方式：
/// ```dart
/// final log = AppLogger('AudioCapture');
/// log.i('音频采集已启动');
/// log.e('采集错误', error, stackTrace);
/// ```
class AppLogger {
  final pkg_logging.Logger _inner;

  AppLogger(String name) : _inner = pkg_logging.Logger('AI-Voice-Assistant.$name');

  /// 初始化日志系统（在 main 入口调用一次）
  static void init({pkg_logging.Level level = pkg_logging.Level.ALL}) {
    pkg_logging.hierarchicalLoggingEnabled = true;
    pkg_logging.Logger.root.level = level;
    pkg_logging.Logger.root.onRecord.listen((record) {
      // 格式化: [时间] [级别] [名称] 消息
      final time = record.time.toIso8601String().substring(11, 23);
      final level = record.level.name.padRight(5);
      final name = record.loggerName;
      final msg = record.message;
      final err = record.error != null ? ' | ${record.error}' : '';
      final stack = record.stackTrace != null ? '\n${record.stackTrace}' : '';

      // ignore: avoid_print
      print('[$time] [$level] [$name] $msg$err$stack');
    });
  }

  /// verbose
  void v(String msg) => _inner.fine(msg);

  /// debug
  void d(String msg) => _inner.finer(msg);

  /// info
  void i(String msg) => _inner.info(msg);

  /// warning
  void w(String msg) => _inner.warning(msg);

  /// error
  void e(String msg, [Object? error, StackTrace? stackTrace]) {
    _inner.severe(msg, error, stackTrace);
  }
}
