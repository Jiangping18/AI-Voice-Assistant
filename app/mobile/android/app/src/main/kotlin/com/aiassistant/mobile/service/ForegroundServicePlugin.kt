package com.aiassistant.mobile.service

import android.content.Intent
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * ====================================================================
 *  Flutter MethodChannel 插件 — 前台服务桥接
 *
 *  注册通道: com.aiassistant.mobile/foreground_service
 *
 *  Flutter 侧调用:
 *   - start()   → 启动前台 Service
 *   - stop()    → 停止前台 Service
 *   - updateState(text) → 更新通知栏状态
 * ====================================================================
 */
class ForegroundServicePlugin private constructor(
    private val flutterEngine: FlutterEngine
) : MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "FgServicePlugin"
        private const val CHANNEL = "com.aiassistant.mobile/foreground_service"

        @Volatile
        private var instance: ForegroundServicePlugin? = null

        /**
         * 注册到 Flutter Engine（在 MainActivity.configureFlutterEngine 中调用）
         */
        fun register(engine: FlutterEngine) {
            if (instance == null) {
                synchronized(ForegroundServicePlugin::class.java) {
                    if (instance == null) {
                        instance = ForegroundServicePlugin(engine)
                    }
                }
            }
            val channel = MethodChannel(engine.dartExecutor.binaryMessenger, CHANNEL)
            channel.setMethodCallHandler(instance)
            Log.i(TAG, "ForegroundServicePlugin 已注册")
        }
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "start" -> {
                try {
                    val intent = Intent(
                        flutterEngine.appContext,
                        AudioForegroundService::class.java
                    )
                    flutterEngine.appContext.startForegroundService(intent)
                    result.success(true)
                    Log.i(TAG, "前台服务启动命令已发送")
                } catch (e: Exception) {
                    Log.e(TAG, "启动前台服务失败", e)
                    result.success(false)
                }
            }

            "stop" -> {
                try {
                    val intent = Intent(
                        flutterEngine.appContext,
                        AudioForegroundService::class.java
                    )
                    flutterEngine.appContext.stopService(intent)
                    result.success(null)
                    Log.i(TAG, "前台服务停止命令已发送")
                } catch (e: Exception) {
                    Log.e(TAG, "停止前台服务失败", e)
                    result.error("STOP_ERROR", e.message, null)
                }
            }

            "updateState" -> {
                val stateText = call.argument<String>("state")
                    ?: call.arguments as? String
                    ?: "未知"
                try {
                    // 如果服务在运行，更新通知
                    val intent = Intent(
                        flutterEngine.appContext,
                        AudioForegroundService::class.java
                    ).apply {
                        action = "UPDATE_STATE"
                        putExtra("state_text", stateText)
                    }
                    flutterEngine.appContext.startService(intent)
                    result.success(null)
                } catch (e: Exception) {
                    Log.w(TAG, "更新通知状态失败", e)
                    result.success(null)
                }
            }

            else -> {
                result.notImplemented()
            }
        }
    }
}
