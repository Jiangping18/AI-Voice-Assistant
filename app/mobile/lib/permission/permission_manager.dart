import 'dart:async';
import 'dart:io' show Platform;

import 'package:permission_handler/permission_handler.dart';

import '../utils/logger.dart';

/// 权限申请结果回调
typedef PermissionResultCallback = void Function(bool allGranted, List<String> deniedPermissions);

/// ====================================================================
///  权限管理器
///
///  统一管理：
///  - 麦克风权限 (microphone)
///  - 通知权限 (notification) — Android 13+ / iOS
///  - 前台服务权限 — Android 需要 MANAGE_OWN_CALLS / FOREGROUND_SERVICE
/// ====================================================================
class PermissionManager {
  final AppLogger _log = AppLogger('PermissionManager');

  /// 当前所有权限是否已授予
  bool _allGranted = false;
  bool get allGranted => _allGranted;

  /// 被拒绝的权限列表
  final List<String> _deniedPermissions = [];
  List<String> get deniedPermissions => List.unmodifiable(_deniedPermissions);

  /// 权限变更外部监听
  PermissionResultCallback? onResult;

  /// ========================================
  ///  请求全部所需权限
  /// ========================================
  Future<bool> requestAll() async {
    _log.i('开始请求运行时权限...');

    final permissions = <Permission>[
      Permission.microphone,
      Permission.notification,
    ];

    // Android 专属: 后台录音需要忽略电池优化
    if (isAndroid) {
      permissions.add(Permission.ignoreBatteryOptimizations);
    }

    // 逐个请求（允许用户拒绝后重试）
    _deniedPermissions.clear();
    for (final perm in permissions) {
      final status = await perm.request();
      _log.i('权限 ${perm.toString()} → $status');

      if (!status.isGranted) {
        _deniedPermissions.add(perm.toString());
      }
    }

    // 如果有拒绝的权限，尝试打开设置引导
    if (_deniedPermissions.isNotEmpty) {
      _log.w('以下权限被拒绝: $_deniedPermissions');
      _allGranted = false;

      // 如果用户之前选了"不再询问"，引导去设置页
      for (final perm in permissions) {
        if (await perm.isPermanentlyDenied) {
          _log.i('权限 ${perm.toString()} 被永久拒绝，引导用户去设置');
          // 这里不在 PermissionManager 内部打开设置，
          // 由上层决定是否调用 openSettings()
        }
      }
    } else {
      _allGranted = true;
      _log.i('所有权限已授予');
    }

    onResult?.call(_allGranted, _deniedPermissions);
    return _allGranted;
  }

  /// ========================================
  ///  检查权限状态（不弹窗）
  /// ========================================
  Future<bool> checkAll() async {
    final results = await Future.wait([
      Permission.microphone.status,
      Permission.notification.status,
    ]);

    _allGranted = results.every((s) => s.isGranted);
    return _allGranted;
  }

  /// ========================================
  ///  打开系统设置页
  /// ========================================
  Future<bool> openSettings() async {
    final opened = await openAppSettings();
    _log.i('打开系统设置: $opened');
    return opened;
  }

  /// ========================================
  ///  检查平台
  /// ========================================
  static bool get isAndroid => Platform.isAndroid;
  static bool get isIOS => Platform.isIOS;

  /// 释放资源
  void dispose() {
    onResult = null;
  }
}
