/**
 * ReAct Loop — 感知-思考-执行闭环
 *
 * @module @myopenclaw/server/agents
 */

export class ReActLoop {
  /** 循环计数器 */
  private stepCount = 0;

  /** 增加步骤计数 */
  incrementStep(): number {
    return ++this.stepCount;
  }

  /** 重置计数器 */
  reset(): void {
    this.stepCount = 0;
  }

  /** 是否达到最大步数 */
  isExceeded(maxSteps: number): boolean {
    return this.stepCount >= maxSteps;
  }
}
