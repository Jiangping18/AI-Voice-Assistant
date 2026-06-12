import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../utils/logger.dart';
import '../utils/constants.dart';

/// ====================================================================
///  本地通知管理器
///
///  用于前台服务常驻通知栏 + 状态变更通知
/// ====================================================================
class NotificationManager {
  final AppLogger _log = AppLogger('NotificationManager');
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  bool _initialized = false;

  /// 初始化通知渠道（在应用启动时调用）
  Future<void> init() async {
    if (_initialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );

    const settings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _plugin.initialize(settings);
    _initialized = true;
    _log.i('通知管理器初始化完成');
  }

  /// 创建通知渠道（Android 必须）
  Future<void> createChannel() async {
    // flutter_local_notifications 会自动创建渠道
    // 这里确保渠道配置存在
    _log.i('通知渠道已就绪: ${ServiceConstants.notificationChannelId}');
  }

  /// 显示前台服务常驻通知
  ///
  /// [stateText] - 当前状态文本（监听中/录音中等）
  Future<void> showPersistentNotification(String stateText) async {
    const androidDetails = AndroidNotificationDetails(
      ServiceConstants.notificationChannelId,
      ServiceConstants.notificationChannelName,
      channelDescription: ServiceConstants.notificationChannelDesc,
      importance: Importance.low,
      priority: Priority.low,
      ongoing: true,          // 不可滑动清除
      autoCancel: false,
      showWhen: false,
      visibility: NotificationVisibility.public,
    );

    const details = NotificationDetails(android: androidDetails);

    await _plugin.show(
      ServiceConstants.notificationId,
      'AI 录音助手',
      '状态: $stateText',
      details,
    );
  }

  /// 更新通知内容
  Future<void> updateState(String stateText) async {
    if (!_initialized) return;
    await showPersistentNotification(stateText);
  }

  /// 取消通知
  Future<void> cancel() async {
    await _plugin.cancel(ServiceConstants.notificationId);
  }

  /// 释放
  void dispose() {
    _plugin.cancelAll();
  }
}
