/**
 * Vitest 配置
 *
 * 目标:
 * - 测 React Hooks(useChat 等)用 @testing-library/react
 *   需要 react-dom(用 happy-dom 提供 DOM 环境)
 * - 不跑 main.ts 入口(stdin/stdout 占用 TTY 会挂住)
 * - 路径别名与 tsconfig 一致(./src/*)
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src/main.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      // 让 import './types/xxx.js' 解析到 .ts 源码(vitest 原生支持)
    },
  },
});
