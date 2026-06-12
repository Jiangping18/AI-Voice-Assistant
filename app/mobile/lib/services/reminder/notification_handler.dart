/// ====================================================================
///  系统通知触达 — Android/iOS 通知权限 + 点击跳转 + TTS 语音播报
///
///  职责:
///    1. Android：通知渠道适配 + POST_NOTIFICATIONS 权限请求
///    2. iOS：UserNotifications 授权
///    3. 点击通知跳转到应用对应详情页
///    4. 可选 TTS 语音播报
/// ====================================================================
library;

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';
import '../utils/logger.dart';

/// 通知权限状态
enum NotificationPermissionState {
  granted,
  denied,
  permanentlyDenied,
  notRequested,
}

/// 系统通知触达处理器
class NotificationHandler {
  final AppLogger _log = AppLogger('NotificationHandler');

  /// 当前权限状态
  NotificationPermissionState _permissionState =
      NotificationPermissionState.notRequested;

  /// TTS 是否启用
  bool _ttsEnabled = false;

  /// TTS 回调（由应用层注入，如使用 flutter_tts 插件）
  void Function(String text)? ttsSpeak;

  /// 通知点击跳转路由（由应用层注入）
  String? _detailRoute;
  String? _lastTappedReminderId;

  // ── 权限管理 ────────────────────────────────────────────────────

  /// 请求通知权限（同时适配 Android 13+ POST_NOTIFICATIONS）
  Future<NotificationPermissionState> requestPermission() async {
    // Android 13 (API 33) 以上需要运行时权限
    if (defaultTargetPlatform == TargetPlatform.android) {
      final status = await Permission.notification.request();
      _permissionState = _mapPermissionStatus(status);
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      // iOS 通过 UNUserNotificationCenter 请求（由 AppDelegate 处理）
      _permissionState = NotificationPermissionState.granted;
    } else {
      // 桌面平台视为已授权
      _permissionState = NotificationPermissionState.granted;
    }

    _log.i('通知权限状态: $_permissionState');
    return _permissionState;
  }

  /// 检查当前权限状态
  Future<NotificationPermissionState> checkPermission() async {
    if (defaultTargetPlatform == TargetPlatform.android) {
      final status = await Permission.notification.status;
      _permissionState = _mapPermissionStatus(status);
    }
    return _permissionState;
  }

  /// 打开应用权限设置
  Future<bool> openSettings() async {
    final opened = await openAppSettings();
    if (opened) {
      _log.i('已打开应用权限设置');
    }
    return opened;
  }

  NotificationPermissionState _mapPermissionStatus(PermissionStatus status) {
    switch (status) {
      case PermissionStatus.granted:
      case PermissionStatus.limited:
        return NotificationPermissionState.granted;
      case PermissionStatus.denied:
        return NotificationPermissionState.denied;
      case PermissionStatus.permanentlyDenied:
        return NotificationPermissionState.permanentlyDenied;
      case PermissionStatus.restricted:
        return NotificationPermissionState.denied;
      case PermissionStatus.provisional:
        return NotificationPermissionState.granted;
    }
  }

  // ── 通知点击跳转 ────────────────────────────────────────────────

  /// 设置点击通知时的跳转路由
  void setDetailRoute(String route) {
    _detailRoute = route;
  }

  /// 处理通知点击（由提醒服务调用）
  String? handleNotificationTap(String reminderId) {
    _lastTappedReminderId = reminderId;
    _log.i('通知点击: reminderId=$reminderId route=$_detailRoute');
    // 实际路由跳转由应用层通过回调处理
    return _detailRoute;
  }

  /// 获取最后点击的提醒 ID
  String? get lastTappedReminderId => _lastTappedReminderId;

  // ── TTS 语音播报 ───────────────────────────────────────────────

  /// 启用/关闭 TTS
  void setTtsEnabled(bool enabled) {
    _ttsEnabled = enabled;
    _log.i('TTS 播报: ${enabled ? "已启用" : "已关闭"}');
  }

  /// 播报提醒内容
  Future<void> speakReminder(String content, {String? assignee}) async {
    if (!_ttsEnabled) return;
    if (ttsSpeak == null) {
      _log.w('TTS 未注册，请注入 ttsSpeak 回调');
      return;
    }

    final text = assignee != null && assignee.isNotEmpty
        ? '$assignee，你有新的待办：$content'
        : '你有新的待办：$content';

    try {
      await ttsSpeak!(text);
      _log.i('TTS 播报: $text');
    } catch (e) {
      _log.e('TTS 播报失败: $e');
    }
  }

  // ── 工具 ────────────────────────────────────────────────────────

  bool get isGranted =>
      _permissionState == NotificationPermissionState.granted;

  bool get ttsEnabled => _ttsEnabled;

  void dispose() {
    _lastTappedReminderId = null;
  }
}
