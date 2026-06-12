/// ====================================================================
///  待办状态同步 — 与 PC 端双向同步
///
///  职责:
///    1. 手机端状态变更（完成/取消）上报到 PC（通过智能体2）
///    2. PC 端状态变更同步到手机端
///    3. 断线时缓存状态变更，重连后批量补报
///
///  消息格式:
///    手机 → PC: {"type":"reminder_status","payload":{"id":"uuid","status":"completed|cancelled"}}
///    PC → 手机: {"type":"reminder","payload":{...}}
/// ====================================================================
library;

import 'dart:async';
import 'dart:collection';
import '../utils/logger.dart';

/// 待办状态变更事件
class StatusChangeEvent {
  final String reminderId;
  final String status;   // completed / cancelled
  final DateTime timestamp;

  StatusChangeEvent({
    required this.reminderId,
    required this.status,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 待办状态同步服务
class ReminderStateSync {
  final AppLogger _log = AppLogger('ReminderStateSync');

  /// 发送回调（由应用层注入，实际通过智能体2发送）
  bool Function(String reminderId, String status)? sendStatusUpdate;

  /// 待上报的变更队列（断线时缓存）
  final Queue<StatusChangeEvent> _pendingQueue = Queue();

  /// 已同步但待确认的变更
  final Map<String, StatusChangeEvent> _pendingConfirm = {};

  bool _syncing = false;
  Timer? _retryTimer;

  // ── 上报状态变更 ───────────────────────────────────────────────

  /// 上报一条状态变更到 PC
  ///
  /// 返回 true 表示立即发送成功；false 表示入队等待重试
  bool reportStatus(String reminderId, String status) {
    if (sendStatusUpdate == null) {
      _log.w('未注册 sendStatusUpdate 回调，无法上报');
      return false;
    }

    try {
      final result = sendStatusUpdate!(reminderId, status);
      if (result) {
        _log.i('状态上报成功: id=$reminderId status=$status');
        return true;
      }
    } catch (e) {
      _log.e('状态上报异常: $e');
    }

    // 发送失败，入队缓存
    _enqueue(reminderId, status);
    return false;
  }

  // ── 离线缓存与补报 ─────────────────────────────────────────────

  /// 将变更加入待上报队列
  void _enqueue(String reminderId, String status) {
    // 去重：如果队列中已有同 id 的变更，移除旧的
    _pendingQueue.removeWhere((e) => e.reminderId == reminderId);
    _pendingQueue.add(StatusChangeEvent(
      reminderId: reminderId,
      status: status,
    ));
    _log.i('状态变更已入队: id=$reminderId status=$status (队列长度=${_pendingQueue.length})');
  }

  /// 尝试补报所有待上报的变更
  ///
  /// 返回成功上报的数量
  int flushPending() {
    if (_pendingQueue.isEmpty) return 0;
    if (sendStatusUpdate == null) return 0;

    int successCount = 0;
    final remaining = <StatusChangeEvent>[];

    while (_pendingQueue.isNotEmpty) {
      final event = _pendingQueue.removeFirst();
      try {
        final result = sendStatusUpdate!(event.reminderId, event.status);
        if (result) {
          successCount++;
        } else {
          remaining.add(event);
        }
      } catch (e) {
        remaining.add(event);
        _log.e('补报失败: id=${event.reminderId} error=$e');
      }
    }

    // 将剩余失败的重新入队
    for (final e in remaining) {
      _pendingQueue.add(e);
    }

    if (successCount > 0) {
      _log.i(
        '补报完成: $successCount/${successCount + remaining.length} 成功',
      );
    }
    return successCount;
  }

  /// 启动自动补报（周期性尝试）
  void startAutoRetry({Duration interval = const Duration(seconds: 30)}) {
    _retryTimer?.cancel();
    _retryTimer = Timer.periodic(interval, (_) {
      if (_pendingQueue.isNotEmpty) {
        flushPending();
      }
    });
    _log.i('自动补报已启动 (interval=${interval.inSeconds}s)');
  }

  /// 停止自动补报
  void stopAutoRetry() {
    _retryTimer?.cancel();
    _retryTimer = null;
  }

  // ── 状态查询 ────────────────────────────────────────────────────

  /// 待上报队列长度
  int get pendingCount => _pendingQueue.length;

  /// 是否有待上报的变更
  bool get hasPending => _pendingQueue.isNotEmpty;

  /// 清空待上报队列
  void clearPending() {
    _pendingQueue.clear();
    _log.i('待上报队列已清空');
  }

  /// 释放资源
  void dispose() {
    stopAutoRetry();
    _pendingQueue.clear();
    _pendingConfirm.clear();
  }
}
