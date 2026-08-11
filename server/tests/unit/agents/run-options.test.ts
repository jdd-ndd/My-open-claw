/**
 * P1.3 run-options 单元测试
 *
 * 覆盖:
 * - 类型守卫 isWorkMode / isIntensity
 * - extractRunOptions 容忍缺失/类型错误
 * - intensityToLLMOptions 4 档映射
 * - workModeSystemPromptAddon plan/build 两段提示词
 */
import { describe, it, expect } from 'vitest';
import {
  extractRunOptions,
  intensityToLLMOptions,
  isIntensity,
  isWorkMode,
  workModeSystemPromptAddon,
} from '../../../src/agents/run-options.js';

describe('agents/run-options - type guards', () => {
  it('isWorkMode 接受 plan/build, 拒绝其他字符串', () => {
    expect(isWorkMode('plan')).toBe(true);
    expect(isWorkMode('build')).toBe(true);
    expect(isWorkMode('Plan')).toBe(false);   // 大小写敏感
    expect(isWorkMode('foo')).toBe(false);
    expect(isWorkMode(null)).toBe(false);
    expect(isWorkMode(undefined)).toBe(false);
    expect(isWorkMode(123)).toBe(false);
  });

  it('isIntensity 接受 4 档, 拒绝其他值', () => {
    expect(isIntensity('low')).toBe(true);
    expect(isIntensity('medium')).toBe(true);
    expect(isIntensity('high')).toBe(true);
    expect(isIntensity('max')).toBe(true);
    expect(isIntensity('MIN')).toBe(false);
    expect(isIntensity('turbo')).toBe(false);
    expect(isIntensity(undefined)).toBe(false);
  });
});

describe('agents/run-options - extractRunOptions', () => {
  it('空 metadata 返回空 options', () => {
    expect(extractRunOptions(undefined)).toEqual({});
    expect(extractRunOptions({})).toEqual({});
  });

  it('正确字段全提取', () => {
    expect(extractRunOptions({
      workMode: 'plan',
      intensity: 'high',
      model: 'deepseek-v4-flash',
    })).toEqual({
      workMode: 'plan',
      intensity: 'high',
      model: 'deepseek-v4-flash',
    });
  });

  it('错类型字段被丢弃, 不会崩', () => {
    expect(extractRunOptions({
      workMode: 123,
      intensity: ['x'],
      model: null,
    })).toEqual({});
  });

  it('混合: 部分字段错类型, 部分正确', () => {
    const result = extractRunOptions({
      workMode: 'build',     // 正确
      intensity: 'turbo',    // 错
      model: 'gpt-4o',       // 正确
    });
    expect(result).toEqual({ workMode: 'build', model: 'gpt-4o' });
  });

  it('忽略未知字段, 不抛', () => {
    const result = extractRunOptions({
      workMode: 'plan',
      unknownField: 'whatever',
      __proto__: { evil: true },
    } as Record<string, unknown>);
    expect(result.workMode).toBe('plan');
  });
});

describe('agents/run-options - intensityToLLMOptions', () => {
  it('undefined 返回空对象 (不调参)', () => {
    expect(intensityToLLMOptions(undefined)).toEqual({});
  });

  it('low: 低温度, 小 max tokens', () => {
    expect(intensityToLLMOptions('low')).toEqual({
      temperature: 0.3,
      maxTokens: 2048,
      reasoningEffort: 'low',
    });
  });

  it('medium: 中等调参', () => {
    expect(intensityToLLMOptions('medium')).toEqual({
      temperature: 0.5,
      maxTokens: 4096,
      reasoningEffort: 'medium',
    });
  });

  it('high: 较强调参', () => {
    expect(intensityToLLMOptions('high')).toEqual({
      temperature: 0.7,
      maxTokens: 8192,
      reasoningEffort: 'high',
    });
  });

  it('max: 全力', () => {
    expect(intensityToLLMOptions('max')).toEqual({
      temperature: 0.7,
      maxTokens: 16384,
      reasoningEffort: 'max',
    });
  });

  it('4 档 maxTokens 严格递增, 温度 low<medium<high=max', () => {
    const low = intensityToLLMOptions('low')!;
    const med = intensityToLLMOptions('medium')!;
    const high = intensityToLLMOptions('high')!;
    const max = intensityToLLMOptions('max')!;
    expect(low.maxTokens!).toBeLessThan(med.maxTokens!);
    expect(med.maxTokens!).toBeLessThan(high.maxTokens!);
    expect(high.maxTokens!).toBeLessThan(max.maxTokens!);
    expect(low.temperature!).toBeLessThan(med.temperature!);
    expect(med.temperature!).toBeLessThanOrEqual(high.temperature!);
    expect(high.temperature).toBe(max.temperature);
  });
});

describe('agents/run-options - workModeSystemPromptAddon', () => {
  it('undefined 返回空字符串', () => {
    expect(workModeSystemPromptAddon(undefined)).toBe('');
  });

  it('plan: 明确禁止工具调用, 强调只读', () => {
    const prompt = workModeSystemPromptAddon('plan');
    expect(prompt).toContain('Plan');
    expect(prompt).toContain('禁止调用任何工具');
    expect(prompt).toContain('切回 Build 模式');
  });

  it('build: 允许工具调用, 简洁指令', () => {
    const prompt = workModeSystemPromptAddon('build');
    expect(prompt).toContain('Build');
    expect(prompt).toContain('自由使用工具');
    expect(prompt).not.toContain('禁止');
  });

  it('plan 和 build 提示词互不重复 (避免冗余)', () => {
    const plan = workModeSystemPromptAddon('plan');
    const build = workModeSystemPromptAddon('build');
    // 公共字串 (如 "当前模式") 不算, 比较核心内容
    expect(plan).not.toBe(build);
  });
});
