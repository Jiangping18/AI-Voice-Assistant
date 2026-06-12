/// ====================================================================
///  移动端提醒服务 — 统一导出
///
///  对外统一接口:
///    ReminderService       — 主服务（接收推送、本地调度、通知展示）
///    NotificationHandler   — 通知权限 + TTS + 点击跳转
///    ReminderStateSync     — 状态变更双向同步
///    ReminderItem          — 提醒数据模型
///
///  典型用法:
///    ```dart
///    final reminder = ReminderService();
///    final notifHandler = NotificationHandler();
///    final stateSync = ReminderStateSync();
///
///    // 初始化
///    await reminder.init();
///    await notifHandler.requestPermission();
///
///    // 注入通信回调
///    stateSync.sendStatusUpdate = (id, status) {
///      return commEngine.sendControl(peerId, 'reminder_status', {
///        'id': id, 'status': status,
///      });
///    };
///    reminder.onStatusChanged = stateSync.reportStatus;
///
///    // 接收 PC 推送
///    reminder.receiveReminder(payload);
///
///    // 启动离线补报
///    stateSync.startAutoRetry();
///    ```
/// ====================================================================
library;

export 'reminder_service.dart' show ReminderService, ReminderItem;
export 'notification_handler.dart' show NotificationHandler, NotificationPermissionState;
export 'state_sync.dart' show ReminderStateSync, StatusChangeEvent;
