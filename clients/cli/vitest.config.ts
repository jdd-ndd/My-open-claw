/**
 * Vitest 测试配置
 *
 * 配置 CLI 客户端的单元测试环境，包括：
 * - 测试文件匹配规则
 * - 环境设置
 * - 覆盖率配置
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    // 测试文件匹配
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // 排除的文件
    exclude: ['**/node_modules/**', '**/dist/**'],
    // 测试环境
    environment: 'node',
    // 全局设置文件
    setupFiles: [],
    // 测试超时时间
    testTimeout: 10000,
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/types/**'],
    },
    // 类型检查
    typecheck: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
