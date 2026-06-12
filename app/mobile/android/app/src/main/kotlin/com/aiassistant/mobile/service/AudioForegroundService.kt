package com.aiassistant.mobile.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * ====================================================================
 *  AI 录音助手 — Android 前台音频采集 Service
 *
 *  职责:
 *  1. 提供 foreground 保活，防止进程被系统回收
 *  2. 持有 WakeLock，防止 CPU 休眠导致音频中断
 *  3. 常驻通知栏，显示当前采集状态
 *  4. 作为 MethodChannel 原生端，与 Flutter Dart 层通信
 *
 *  foregroundServiceType = "microphone" (Android 14+)
 * ====================================================================
 */
class AudioForegroundService : Service() {

    companion object {
        private const val TAG = "AudioForegroundService"
        private const val CHANNEL_ID = "ai_voice_assistant_channel"
        private const val NOTIFICATION_ID = 1001

        /** 服务当前状态文本 */
        var currentStateText: String = "正在准备..."
            private set
    }

    private var wakeLock: PowerManager.WakeLock? = null

    // ================================================================
    //  生命周期
    // ================================================================

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "前台服务创建")

        // 创建通知渠道
        createNotificationChannel()

        // 获取 WakeLock（部分唤醒锁，防止 CPU 休眠）
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "UPDATE_STATE" -> {
                // 仅更新通知栏状态文本
                val stateText = intent.getStringExtra("state_text") ?: currentStateText
                updateState(stateText)
                return START_STICKY
            }
            else -> {
                Log.i(TAG, "前台服务启动 (action=${intent?.action ?: "none"})")
                val notification = buildNotification(currentStateText)
                startForeground(NOTIFICATION_ID, notification)
            }
        }

        // 如果被系统杀死，自动重启
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        Log.i(TAG, "前台服务销毁")
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    // ================================================================
    //  WakeLock 管理
    // ================================================================

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "${packageName}:audio_capture_wakelock"
            )
            wakeLock?.acquire(4 * 60 * 60 * 1000L) // 最长 4 小时
            Log.i(TAG, "WakeLock 已获取")
        } catch (e: Exception) {
            Log.w(TAG, "获取 WakeLock 失败", e)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.i(TAG, "WakeLock 已释放")
            }
        }
        wakeLock = null
    }

    // ================================================================
    //  通知管理
    // ================================================================

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AI 录音助手",
                NotificationManager.IMPORTANCE_LOW  // 低优先级，不在屏幕弹出
            ).apply {
                description = "显示录音助手运行状态"
                setShowBadge(false)
                enableVibration(false)
                enableLights(false)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
            Log.i(TAG, "通知渠道已创建")
        }
    }

    private fun buildNotification(stateText: String): Notification {
        currentStateText = stateText

        // 使用 NotificationCompat 以兼容低版本
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.Notification.Builder(this, CHANNEL_ID)
        } else {
            android.app.Notification.Builder(this)
        }

        return builder
            .setContentTitle("AI 录音助手")
            .setContentText("状态: $stateText")
            .setSmallIcon(android.R.drawable.ic_menu_manage)  // 替换为应用图标
            .setOngoing(true)           // 不可滑动清除
            .setAutoCancel(false)
            .setShowWhen(false)
            .setVisibility(android.app.Notification.VISIBILITY_PUBLIC)
            .build()
    }

    /**
     * 更新通知栏状态文本（由 Flutter 侧通过 MethodChannel 调用）
     */
    fun updateState(stateText: String) {
        currentStateText = stateText
        val notification = buildNotification(stateText)
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, notification)
        Log.d(TAG, "通知更新: $stateText")
    }
}
