import 'package:flutter/material.dart';

import 'utils/logger.dart';
import 'utils/constants.dart';
import 'models/audio_state.dart';
import 'permission/permission_manager.dart';
import 'audio/vad/vad_engine.dart';
import 'audio/vad/silero_vad.dart';
import 'audio/audio_capture.dart';
import 'audio/audio_processor.dart';
import 'audio/audio_pipeline.dart';
import 'bridge/state_channel.dart';

/// ====================================================================
///  AI 录音助手 — 移动端入口
///  智能体1：音频采集 + VAD 引擎
/// ====================================================================
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  AppLogger.init();
  runApp(const AiVoiceAssistantApp());
}

/// Flutter 应用根组件
class AiVoiceAssistantApp extends StatelessWidget {
  const AiVoiceAssistantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI 录音助手',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
        brightness: Brightness.light,
      ),
      home: const HomePage(),
    );
  }
}

/// 主页面 —— 显示采集状态与控制按钮
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final PermissionManager _permissionManager = PermissionManager();
  final StateChannel _stateChannel = StateChannel();
  AudioPipeline? _pipeline;

  bool _isRunning = false;

  @override
  void initState() {
    super.initState();
    _stateChannel.ensureInitialized();
  }

  @override
  void dispose() {
    _pipeline?.stop();
    super.dispose();
  }

  /// 启动采集管线
  Future<void> _start() async {
    // 1) 检查权限
    final granted = await _permissionManager.requestAll();
    if (!granted) {
      _showSnack('权限未授予，请检查设置');
      return;
    }

    // 2) 构造依赖
    final vad = SileroVadEngine();
    await vad.load();

    final capture = AudioCapture();
    final processor = AudioProcessor();

    final pipeline = AudioPipeline(
      audioCapture: capture,
      audioProcessor: processor,
      vadEngine: vad,
      stateChannel: _stateChannel,
      onStateChanged: (state) {
        setState(() {});
        _stateChannel.broadcastState(state);
      },
    );

    // 3) 启动
    await pipeline.start();
    setState(() {
      _pipeline = pipeline;
      _isRunning = true;
    });
    _showSnack('音频采集已启动');
  }

  /// 停止采集管线
  Future<void> _stop() async {
    await _pipeline?.stop();
    setState(() {
      _isRunning = false;
    });
    _showSnack('音频采集已停止');
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pipelineState = _pipeline?.currentState;
    final stateText = _describeState(pipelineState);
    final stateColor = _stateColor(pipelineState);

    return Scaffold(
      appBar: AppBar(title: const Text('AI 录音助手')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 状态指示器
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: stateColor.withOpacity(0.15),
                border: Border.all(color: stateColor, width: 3),
              ),
              child: Center(
                child: Text(
                  stateText,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: stateColor,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              _isRunning ? '采集运行中' : '点击下方按钮启动',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            if (pipelineState != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '当前状态: ${pipelineState.name}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.grey,
                      ),
                ),
              ),
            const SizedBox(height: 32),
            // 控制按钮
            FilledButton.icon(
              onPressed: _isRunning ? _stop : _start,
              icon: Icon(_isRunning ? Icons.stop : Icons.mic),
              label: Text(_isRunning ? '停止采集' : '启动采集'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(200, 52),
                textStyle: const TextStyle(fontSize: 18),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _describeState(AudioWorkState? state) {
    if (!_isRunning) return '已停止';
    switch (state) {
      case AudioWorkState.listening:
        return '监听中';
      case AudioWorkState.recording:
        return '录音中';
      case AudioWorkState.error:
        return '异常';
      case AudioWorkState.idle:
      case null:
        return '就绪';
    }
  }

  Color _stateColor(AudioWorkState? state) {
    switch (state) {
      case AudioWorkState.recording:
        return Colors.red;
      case AudioWorkState.listening:
        return Colors.green;
      case AudioWorkState.error:
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }
}
