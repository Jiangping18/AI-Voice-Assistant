/**
 * 文本清洗模块单元测试
 *
 * 运行：npx jest --config jest.config.js
 */

import { TextCleaner, cleanText } from '../index';

describe('TextCleaner', () => {
  const cleaner = new TextCleaner({
    enablePunctuation: true,
    enableFillerFilter: true,
    enableNumberFormat: true,
  });

  describe('语气词过滤', () => {
    test('过滤开头语气词', () => {
      expect(cleaner.cleanQuick('嗯嗯今天天气不错')).toBe('今天天气不错。');
    });

    test('过滤中间语气词', () => {
      expect(cleaner.cleanQuick('我觉得 呃 这个事情可以')).toBe('我觉得这个事情可以。');
    });

    test('过滤结尾语气词', () => {
      expect(cleaner.cleanQuick('好的 呵呵')).toBe('好的。');
    });

    test('保留有语义的词语', () => {
      // "嗯" 在表示肯定时也应过滤（当前策略保守过滤）
      const result = cleaner.cleanQuick('嗯好的');
      expect(result).not.toContain('嗯');
    });
  });

  describe('标点补全', () => {
    test('句末补句号', () => {
      const result = cleaner.cleanQuick('今天天气真不错');
      expect(result).toMatch(/。$/);
    });

    test('疑问句补问号', () => {
      const result = cleaner.cleanQuick('你吃饭了吗');
      expect(result).toMatch(/？$/);
    });

    test('关联词前补逗号', () => {
      const result = cleaner.cleanQuick('我去但是没找到');
      expect(result).toContain('，');
    });

    test('连续标点去重', () => {
      const result = cleaner.clean('你好。。嗯嗯好的。。');
      // 过滤后应该只有一个句号
      expect(result.text).not.toContain('。。');
    });
  });

  describe('数字格式化', () => {
    test('中文数字转阿拉伯数字', () => {
      expect(cleaner.cleanQuick('一共三十个人')).toBe('一共30个人。');
    });

    test('百分数格式化', () => {
      expect(cleaner.cleanQuick('百分之八十的人同意')).toBe('80%的人同意。');
    });

    test('序数格式化', () => {
      expect(cleaner.cleanQuick('第三组')).toBe('第3组。');
    });

    test('复杂数字转换', () => {
      expect(cleaner.cleanQuick('一百二十三')).toBe('123。');
      expect(cleaner.cleanQuick('三千五百六十')).toBe('3560。');
    });
  });

  describe('完整流水线', () => {
    test('综合场景：去除语气词+标点+数字', () => {
      const input = '嗯嗯今天 呃 一共有 三十 个人 呵呵 参加 这个 会议';
      const expected = '今天一共有30个人参加会议。';
      expect(cleaner.cleanQuick(input)).toBe(expected);
    });

    test('操作记录完整性', () => {
      const result = cleaner.clean('嗯嗯百分之五十');
      expect(result.operations.length).toBeGreaterThanOrEqual(1);
      expect(result.operations[0]).toHaveProperty('name');
      expect(result.operations[0]).toHaveProperty('before');
      expect(result.operations[0]).toHaveProperty('after');
    });
  });
});

describe('cleanText 便捷函数', () => {
  test('快速调用', () => {
    expect(cleanText('嗯嗯测试')).toBe('测试。');
  });
});
