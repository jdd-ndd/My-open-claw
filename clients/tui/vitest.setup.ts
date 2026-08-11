/**
 * Vitest 全局 setup
 *
 * - 抑制 React 18 内部 "act()" 警告(我们用 @testing-library/react 的 act)
 * - happy-dom 不模拟 process.stdin/stdout;main.ts 入口已 exclude,这里不需要 mock
 */
import '@testing-library/jest-dom/vitest';
