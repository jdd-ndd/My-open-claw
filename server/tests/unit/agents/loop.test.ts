/**
 * ReActLoop 单元测试
 */
import { describe, it, expect } from 'vitest';
import { ReActLoop } from '../../../src/agents/loop/index.js';

describe('agents - ReActLoop', () => {
  it('初始状态应为空闲', () => {
    const loop = new ReActLoop();
    expect(loop.getIteration()).toBe(0);
    expect(loop.getStepCount()).toBe(0);
    expect(loop.isRunning()).toBe(false);
    expect(loop.getHistory()).toHaveLength(0);
  });

  it('应正确累加步骤计数', () => {
    const loop = new ReActLoop();
    expect(loop.incrementStep()).toBe(1);
    expect(loop.incrementStep()).toBe(2);
    expect(loop.getStepCount()).toBe(2);
  });

  it('应正确推进迭代轮数', () => {
    const loop = new ReActLoop();
    expect(loop.nextIteration()).toBe(1);
    expect(loop.getIteration()).toBe(1);
    expect(loop.getStepCount()).toBe(0);
    expect(loop.isRunning()).toBe(true);
  });

  it('isExceeded 应判断步骤上限', () => {
    const loop = new ReActLoop();
    expect(loop.isExceeded(5)).toBe(false);
    for (let i = 0; i < 5; i++) loop.incrementStep();
    expect(loop.isExceeded(5)).toBe(true);
  });

  it('isIterationExceeded 应判断迭代上限', () => {
    const loop = new ReActLoop();
    loop.nextIteration();
    loop.nextIteration();
    expect(loop.isIterationExceeded(3)).toBe(false);
    loop.nextIteration();
    expect(loop.isIterationExceeded(3)).toBe(true);
  });

  it('recordStep 应记录阶段事件', () => {
    const loop = new ReActLoop();
    loop.nextIteration();
    const evt = loop.recordStep('perceive', 'received msg');
    expect(evt.iteration).toBe(1);
    expect(evt.phase).toBe('perceive');
    expect(evt.detail).toBe('received msg');
    expect(typeof evt.timestamp).toBe('number');
    expect(loop.getHistory()).toHaveLength(1);
  });

  it('reset 应清零所有计数与历史', () => {
    const loop = new ReActLoop();
    loop.nextIteration();
    loop.incrementStep();
    loop.recordStep('think', 'call llm');
    loop.reset();
    expect(loop.getIteration()).toBe(0);
    expect(loop.getStepCount()).toBe(0);
    expect(loop.getHistory()).toHaveLength(0);
    expect(loop.isRunning()).toBe(false);
  });

  it('abort 应记录中止事件', () => {
    const loop = new ReActLoop();
    loop.nextIteration();
    loop.abort('user cancel');
    const hist = loop.getHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].detail).toContain('user cancel');
  });
});