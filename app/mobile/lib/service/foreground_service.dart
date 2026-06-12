import 'dart:async';
import 'package:flutter/services.dart';

import '../utils/logger.dart';
import '../utils/constants.dart';
import 'notification_manager.dart';

/// ====================================================================
///  前台服务管理器
///
///  职责：
///  - 通过 MethodChannel 与 Android 原生 ForegroundService 通信
///  - 控制常驻通知栏状态显示
///  - 防止进程被系统杀死（Android OOM_ADJ 调整）
///
///  对外暴露状态消息格式:
///  接收: {"type":"foreground","state":"started|stopped|error","detail":""}
/// ====================================================================
class ForegroundService {
  final AppLogger _log = AppLogger('ForegroundService');

  /// 与 Android 原生通信的 MethodChannel
  static const MethodChannel _channel = MethodChannel(
    'com.aiassistant.mobile/foreground_service',
  );

  final NotificationManager _notificationManager = NotificationManager();

  bool _isRunning = false;
  bool get isRunning => _isRunning;

  /// 启动前台服务
  Future<bool> start({
    String title = 'AI 录音助手',
    String text = '正在准备...',
  }) async {
    if (_isRunning) {
      _log.w('前台服务已在运行');
      return true;
    }

    try {
      // 初始化通知
      await _notificationManager.init();
      await _notificationManager.createChannel();

      // 调用原生启动
      final result = await _channel.invokeMethod<bool>('start') ?? false;
      if (result) {
        _isRunning = true;
        // 显示常驻通知
        await _notificationManager.showPersistentNotification(text);
        _log.i('前台服务已启动');
      } else {
        _log.w('前台服务启动失败（原生返回 false）');
      }
      return result;
    } catch (e, s) {
      _log.e('启动前台服务异常', e, s);
      return false;
    }
  }

  /// 停止前台服务
  Future<bool> stop() async {
    if (!_isRunning) return true;

    try {
      await _channel.invokeMethod<void>('stop');
      await _notificationManager.cancel();
      _isRunning = false;
      _log.i('前台服务已停止');
      return true;
    } catch (e, s) {
      _log.e('停止前台服务异常', e, s);
      return false;
    }
  }

  /// 更新通知栏状态文本
  Future<void> updateNotification(String stateText) async {
    if (!_isRunning) return;
    await _notificationManager.updateState(stateText);
  }

  /// 释放资源
  void dispose() {
    _notificationManager.dispose();
  }
}
