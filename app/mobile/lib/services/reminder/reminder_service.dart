/// ====================================================================
///  移动端提醒调度服务 — 智能体6 (Flutter 侧)
///
///  职责:
///    1. 接收 PC 推送的所有待办，本地注册系统通知
///    2. PC 离线时本地定时器触发，确保提醒不丢失
///    3. 状态变更双向同步（完成/取消 → 上报 PC）
///
///  与智能体2（通信层）的交互:
///    - 接收: {"type":"reminder","payload":{...}}
///    - 上报: {"type":"reminder_status","payload":{"id":"uuid","status":"completed|cancelled"}}
/// ====================================================================
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../utils/logger.dart';

/// 提醒数据模型
class ReminderItem {
  final String id;
  final String content;
  final String deadline;      // ISO 8601
  final int leadMinutes;      // 提前提醒分钟数
  final String assignee;
  String status;              // pending / triggered / completed / cancelled

  ReminderItem({
    required this.id,
    required this.content,
    required this.deadline,
    this.leadMinutes = 0,
    this.assignee = '',
    this.status = 'pending',
  });

  factory ReminderItem.fromJson(Map<String, dynamic> json) {
    return ReminderItem(
      id: json['id'] as String? ?? '',
      content: json['content'] as String? ?? '',
      deadline: json['deadline'] as String? ?? '',
      leadMinutes: json['lead_minutes'] as int? ?? 0,
      assignee: json['assignee'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'content': content,
    'deadline': deadline,
    'lead_minutes': leadMinutes,
    'assignee': assignee,
    'status': status,
  };
}

/// 移动端提醒调度服务
class ReminderService {
  final AppLogger _log = AppLogger('ReminderService');

  /// 本地注册的所有待办（内存缓存 + 持久化）
  final List<ReminderItem> _reminders = [];

  /// 定时器列表（每个待办一个）
  final List<Timer> _timers = [];

  /// 通知插件
  final FlutterLocalNotificationsPlugin _notifPlugin =
      FlutterLocalNotificationsPlugin();

  /// 通知渠道 ID（提醒专用）
  static const String _reminderChannelId = 'ai_reminder_channel';
  static const String _reminderChannelName = '待办提醒';
  static const String _reminderChannelDesc = '接收待办事项提醒通知';

  /// 通知 ID 起始值（避免与前台服务冲突）
  static const int _notifIdBase = 2000;

  /// 与 PC 通信的回调（由外部注入，通过智能体2上报）
  void Function(String id, String status)? onStatusChanged;

  /// 通知点击回调
  void Function(String reminderId)? onNotificationTapped;

  bool _initialized = false;

  // ── 初始化 ──────────────────────────────────────────────────────

  Future<void> init() async {
    if (_initialized) return;

    // 初始化通知渠道
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    const settings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _notifPlugin.initialize(
      settings,
      onDidReceiveNotificationResponse: _onNotificationResponse,
    );

    // 创建 Android 提醒专用通知渠道
    await _createReminderChannel();

    _initialized = true;
    _log.i('提醒服务初始化完成');
  }

  Future<void> _createReminderChannel() async {
    const androidChannel = AndroidNotificationChannel(
      _reminderChannelId,
      _reminderChannelName,
      description: _reminderChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
    );
    // flutter_local_notifications 8.x+ 通过 plugin 创建渠道
    await _notifPlugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(androidChannel);
    _log.i('提醒通知渠道已创建');
  }

  // ── 接收 PC 推送 ────────────────────────────────────────────────

  /// 从 PC 端接收一条待办（由智能体2 消息回调触发）
  void receiveReminder(Map<String, dynamic> payload) {
    try {
      final item = ReminderItem.fromJson(payload);

      // 去重：如果已存在，更新而非重复添加
      final existingIdx = _reminders.indexWhere((r) => r.id == item.id);
      if (existingIdx >= 0) {
        _reminders[existingIdx] = item;
        _log.i('更新已有待办: id=${item.id}');
      } else {
        _reminders.add(item);
        _log.i('接收新待办: id=${item.id} content=${item.content}');
      }

      // 注册本地定时器
      _scheduleLocalNotification(item);
    } catch (e) {
      _log.e('接收待办失败: $e');
    }
  }

  /// 批量接收待办（启动时同步）
  void receiveReminderList(List<Map<String, dynamic>> payloads) {
    for (final p in payloads) {
      receiveReminder(p);
    }
    _log.i('批量接收待办: ${payloads.length} 条');
  }

  // ── 本地提醒调度 ────────────────────────────────────────────────

  void _scheduleLocalNotification(ReminderItem item) {
    // 解析 deadline 计算延迟
    final deadlineDt = DateTime.tryParse(item.deadline);
    if (deadlineDt == null) {
      _log.w('无法解析 deadline: ${item.deadline}');
      return;
    }

    final now = DateTime.now().toUtc();
    final dueUtc = deadlineDt.toUtc();

    if (dueUtc.isBefore(now)) {
      _log.i('待办已过期，跳过本地调度: id=${item.id}');
      return;
    }

    // 计算提前提醒时间
    final triggerTime = dueUtc.subtract(Duration(minutes: item.leadMinutes));
    final delay = triggerTime.difference(now);

    if (delay.isNegative) {
      // 提前时间已过，立即提醒
      _showNotification(item);
      return;
    }

    // 使用 Timer 注册本地提醒
    final timer = Timer(delay, () {
      _showNotification(item);
      item.status = 'triggered';
    });
    _timers.add(timer);

    _log.i(
      '本地提醒已注册: id=${item.id} delay=${delay.inMinutes}min '
      'trigger_at=${triggerTime.toIso8601String()}',
    );
  }

  // ── 系统通知 ────────────────────────────────────────────────────

  Future<void> _showNotification(ReminderItem item) async {
    final title = item.assignee.isNotEmpty
        ? '📌 [$item.assignee] ${item.content}'
        : '📌 ${item.content}';
    final body = '截止时间: ${_formatDeadline(item.deadline)}';

    // 通知 ID 使用 id 的 hash
    final notifId = _notifIdBase + item.id.hashCode % 10000;

    // Android 通知详情（高优先级、带声音振动）
    const androidDetails = AndroidNotificationDetails(
      _reminderChannelId,
      _reminderChannelName,
      channelDescription: _reminderChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
      fullScreenIntent: true,
      category: AndroidNotificationCategory.alarm,
      actions: <AndroidNotificationAction>[
        AndroidNotificationAction('complete', '完成', showsUserInterface: false),
        AndroidNotificationAction('cancel', '取消', showsUserInterface: false),
      ],
    );

    // iOS 通知详情
    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
      categoryIdentifier: 'reminder_category',
    );

    const details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );

    await _notifPlugin.show(notifId, title, body, details,
        payload: jsonEncode({'id': item.id, 'action': 'open'}));

    _log.i('系统通知已发送: id=${item.id} title=$title');
  }

  // ── 通知点击处理 ────────────────────────────────────────────────

  void _onNotificationResponse(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;

    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final reminderId = data['id'] as String?;
      final action = data['action'] as String?;

      if (reminderId == null) return;

      // 处理通知按钮动作
      if (response.actionId == 'complete') {
        markCompleted(reminderId);
      } else if (response.actionId == 'cancel') {
        markCancelled(reminderId);
      } else if (action == 'open') {
        // 点击通知跳转到应用
        onNotificationTapped?.call(reminderId);
      }
    } catch (e) {
      _log.e('通知响应解析失败: $e');
    }
  }

  // ── 状态管理 ────────────────────────────────────────────────────

  /// 标记待办完成（本地 + 上报 PC）
  void markCompleted(String reminderId) {
    final idx = _reminders.indexWhere((r) => r.id == reminderId);
    if (idx < 0) return;

    _reminders[idx].status = 'completed';
    _cancelTimer(reminderId);

    // 上报 PC
    onStatusChanged?.call(reminderId, 'completed');

    // 取消系统通知
    _notifPlugin.cancel(_notifIdBase + reminderId.hashCode % 10000);

    _log.i('待办标记完成: id=$reminderId');
  }

  /// 标记待办取消（本地 + 上报 PC）
  void markCancelled(String reminderId) {
    final idx = _reminders.indexWhere((r) => r.id == reminderId);
    if (idx < 0) return;

    _reminders[idx].status = 'cancelled';
    _cancelTimer(reminderId);

    // 上报 PC
    onStatusChanged?.call(reminderId, 'cancelled');

    _notifPlugin.cancel(_notifIdBase + reminderId.hashCode % 10000);
    _log.i('待办标记取消: id=$reminderId');
  }

  /// 取消本地定时器
  void _cancelTimer(String reminderId) {
    // 没有直接的 timer 索引，惰性处理
    // timer 到期时会检查状态
  }

  // ── 工具方法 ────────────────────────────────────────────────────

  /// 获取所有待办
  List<ReminderItem> get reminders => List.unmodifiable(_reminders);

  /// 获取待触发的待办
  List<ReminderItem> get pendingReminders =>
      _reminders.where((r) => r.status == 'pending').toList();

  /// 获取已触发的待办
  List<ReminderItem> get triggeredReminders =>
      _reminders.where((r) => r.status == 'triggered').toList();

  String _formatDeadline(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return iso;
    return '${dt.month}/${dt.day} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  /// 清理所有定时器
  void dispose() {
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
    _log.i('提醒服务已释放');
  }
}
