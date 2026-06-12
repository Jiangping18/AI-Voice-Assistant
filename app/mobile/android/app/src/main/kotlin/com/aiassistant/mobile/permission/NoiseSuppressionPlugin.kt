package com.aiassistant.mobile.permission

import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * ====================================================================
 *  WebRTC 降噪桥接插件 (Android)
 *
 *  通道: com.aiassistant.mobile/noise_suppression
 *
 *  当前实现: 占位 — 直接转发原始数据
 *  未来: 集成 WebRTC NS (NoiseSuppression) JNI 库
 *
 *  集成 WebRTC NS 的步骤:
 *  1. 在 build.gradle 添加依赖:
 *     implementation 'io.github.webrtc-sdk:android:latest'
 *  2. 在 process() 中调用 Native NS API:
 *     NoiseSuppression.create(...).process(..., ...)
 * ====================================================================
 */
class NoiseSuppressionPlugin private constructor() :
    MethodChannel.MethodCallHandler {

    companion object {
        private const val TAG = "NoiseSuppression"
        private const val CHANNEL = "com.aiassistant.mobile/noise_suppression"

        @Volatile
        private var instance: NoiseSuppressionPlugin? = null

        fun register(engine: FlutterEngine) {
            if (instance == null) {
                synchronized(NoiseSuppressionPlugin::class.java) {
                    if (instance == null) {
                        instance = NoiseSuppressionPlugin()
                    }
                }
            }
            val channel = MethodChannel(
                engine.dartExecutor.binaryMessenger,
                CHANNEL
            )
            channel.setMethodCallHandler(instance)
            Log.i(TAG, "NoiseSuppressionPlugin 已注册")
        }
    }

    /** WebRTC NS 实例 (未来集成) */
    // private var ns: NoiseSuppression? = null

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "init" -> {
                try {
                    // TODO: 集成 WebRTC NoiseSuppression
                    // val lib = webrtc::NoiseSuppression::Create(/* config */)
                    // ns = lib
                    result.success(true)
                    Log.i(TAG, "降噪引擎初始化成功（占位模式）")
                } catch (e: Exception) {
                    Log.e(TAG, "降噪引擎初始化失败", e)
                    result.success(false)
                }
            }

            "process" -> {
                try {
                    val audioData = call.argument<ByteArray>("audioData")
                    if (audioData != null) {
                        // TODO: 调用 WebRTC NS 处理
                        // val processed = ShortArray(audioData.size / 2)
                        // ns?.process(..., audioData, ..., processed)
                        // 当前: 直接返回原始数据
                        result.success(audioData)
                    } else {
                        result.success(null)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "降噪处理异常", e)
                    result.error("NS_PROCESS_ERROR", e.message, null)
                }
            }

            "release" -> {
                try {
                    // ns?.release()
                    result.success(null)
                    Log.i(TAG, "降噪引擎已释放")
                } catch (e: Exception) {
                    Log.e(TAG, "释放降噪引擎异常", e)
                    result.success(null)
                }
            }

            else -> result.notImplemented()
        }
    }
}
