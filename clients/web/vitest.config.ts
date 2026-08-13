import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// v1.1.9: Web 端组件测试起步.
// 跟 server 端 vitest 1.3.0 同版本, 配 jsdom + @testing-library/jest-dom.
// 用 mergeConfig 复用 vite.config.ts 的 alias (`@/...` → src/) 跟 VITE_APP_VERSION.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // 跟 server 端风格一致: 不跑 coverage (CI 单独跑 test:coverage)
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['node_modules', 'dist', '**/*.d.ts'],
    },
  }),
);
