import 'package:flutter_test/flutter_test.dart';
import 'package:ai_voice_assistant_mobile/models/audio_state.dart';
import 'package:ai_voice_assistant_mobile/audio/vad/vad_engine.dart';

/// ====================================================================
///  VAD 状态机单元测试
/// ====================================================================
void main() {
  late VadStateMachine machine;

  setUp(() {
    machine = VadStateMachine();
  });

  group('初始状态', () {
    test('默认状态为 idle', () {
      expect(machine.currentState, AudioWorkState.idle);
    });

    test('idle 状态下 feedVadResult 不改变状态', () {
      final result = VadResult(probability: 0.9, isSpeech: true, timestampMs: 0);
      machine.feedVadResult(result);
      expect(machine.currentState, AudioWorkState.idle);
    });
  });

  group('idle → listening → recording 转换', () {
    test('startListening 切换到 listening', () {
      machine.startListening();
      expect(machine.currentState, AudioWorkState.listening);
    });

    test('连续 3 帧语音进入 recording', () {
      machine.startListening();
      expect(machine.currentState, AudioWorkState.listening);

      // 前 2 帧: 仍 listening
      for (int i = 0; i < 2; i++) {
        final result = VadResult(probability: 0.9, isSpeech: true, timestampMs: i * 32);
        machine.feedVadResult(result);
      }
      expect(machine.currentState, AudioWorkState.listening);

      // 第 3 帧: 切换到 recording
      final result = VadResult(probability: 0.9, isSpeech: true, timestampMs: 64);
      machine.feedVadResult(result);
      expect(machine.currentState, AudioWorkState.recording);
    });

    test('非连续语音不触发 recording', () {
      machine.startListening();

      // 2 帧语音, 1 帧静音, 再 2 帧语音
      for (int i = 0; i < 2; i++) {
        machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: i * 32));
      }
      machine.feedVadResult(VadResult(probability: 0.1, isSpeech: false, timestampMs: 64));
      for (int i = 0; i < 2; i++) {
        machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: (i + 3) * 32));
      }

      // 静音帧重置了计数, 所以仍为 listening
      expect(machine.currentState, AudioWorkState.listening);
    });
  });

  group('recording → listening 转换', () {
    test('连续 48 帧静音回到 listening', () {
      machine.startListening();

      // 先进入 recording
      for (int i = 0; i < 3; i++) {
        machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: i * 32));
      }
      expect(machine.currentState, AudioWorkState.recording);

      // 连续 48 帧静音
      for (int i = 0; i < 48; i++) {
        machine.feedVadResult(VadResult(probability: 0.1, isSpeech: false, timestampMs: (i + 3) * 32));
      }
      expect(machine.currentState, AudioWorkState.listening);
    });

    test('recording 期间再次出现语音不会回到 listening', () {
      machine.startListening();
      for (int i = 0; i < 3; i++) {
        machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: i * 32));
      }
      expect(machine.currentState, AudioWorkState.recording);

      // 40 帧静音 (不到阈值) 然后 1 帧语音
      for (int i = 0; i < 40; i++) {
        machine.feedVadResult(VadResult(probability: 0.1, isSpeech: false, timestampMs: (i + 3) * 32));
      }
      machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: 999));

      // 仍在 recording
      expect(machine.currentState, AudioWorkState.recording);
    });
  });

  group('重置', () {
    test('reset 回到 idle', () {
      machine.startListening();
      machine.feedVadResult(VadResult(probability: 0.9, isSpeech: true, timestampMs: 0));
      machine.reset();
      expect(machine.currentState, AudioWorkState.idle);
    });
  });
}
