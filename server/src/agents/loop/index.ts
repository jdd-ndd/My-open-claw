/**
 * ReActLoop — 感知-思考-执行闭环计数器
 *
 * 文档参考：docs/05-Agent运行时模块.md §2.1
 *
 * 负责追踪 Lobster 循环的迭代次数，
 * 超过 maxIterations 时主动终止以避免无限循环。
 *
 * @module @myopenclaw/server/agents
 */

import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('agent:react-loop');

/** Lobster 循环阶段 */
export type LoopPhase = 'perceive' | 'think' | 'plan' | 'act' | 'observe' | 'reflect';

/** 循环阶段事件 */
export interface LoopStepEvent {
  iteration: number;
  phase: LoopPhase;
  detail: string;
  timestamp: number;
}

export class ReActLoop {
  private stepCount = 0;
  private iterationCount = 0;
  private history: LoopStepEvent[] = [];

  /** 推进一次步骤计数（用于阶段级别） */
  incrementStep(): number {
    return ++this.stepCount;
  }

  /** 推进一轮完整循环 */
  nextIteration(): number {
    this.iterationCount += 1;
    this.stepCount = 0;
    return this.iterationCount;
  }

  /** 记录一个阶段事件 */
  recordStep(phase: LoopPhase, detail: string): LoopStepEvent {
    const evt: LoopStepEvent = {
      iteration: this.iterationCount,
      phase,
      detail,
      timestamp: Date.now(),
    };
    this.history.push(evt);
    return evt;
  }

  /** 重置所有计数 */
  reset(): void {
    this.stepCount = 0;
    this.iterationCount = 0;
    this.history = [];
  }

  /** 是否达到最大迭代步数（步骤级别） */
  isExceeded(maxSteps: number): boolean {
    return this.stepCount >= maxSteps;
  }

  /** 是否达到最大迭代轮数 */
  isIterationExceeded(maxIterations: number): boolean {
    return this.iterationCount >= maxIterations;
  }

  /** 获取当前迭代轮数 */
  getIteration(): number {
    return this.iterationCount;
  }

  /** 获取当前步骤计数 */
  getStepCount(): number {
    return this.stepCount;
  }

  /** 获取所有阶段事件历史 */
  getHistory(): LoopStepEvent[] {
    return [...this.history];
  }

  /** 是否正在运行（已开始且未结束） */
  isRunning(): boolean {
    return this.iterationCount > 0;
  }

  /** 主动终止循环（由 abort() 触发） */
  abort(reason: string): void {
    log.warn({ reason, iteration: this.iterationCount }, 'ReAct 循环被中止');
    this.history.push({
      iteration: this.iterationCount,
      phase: 'reflect',
      detail: `aborted: ${reason}`,
      timestamp: Date.now(),
    });
  }
}