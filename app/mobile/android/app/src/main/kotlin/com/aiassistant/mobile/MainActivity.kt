package com.aiassistant.mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import com.aiassistant.mobile.service.ForegroundServicePlugin
import com.aiassistant.mobile.permission.NoiseSuppressionPlugin

/**
 * AI 录音助手 — Android 入口 Activity
 *
 * 注册所有原生插件到 Flutter Engine
 */
class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // 注册前台服务桥接插件
        ForegroundServicePlugin.register(flutterEngine)

        // 注册降噪桥接插件
        NoiseSuppressionPlugin.register(flutterEngine)
    }
}
