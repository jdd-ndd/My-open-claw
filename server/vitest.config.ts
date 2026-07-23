import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
      },
      exclude: ['dist/**', 'tests/**', '**/*.config.ts', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@gateway': resolve(__dirname, 'src/gateway'),
      '@channels': resolve(__dirname, 'src/channels'),
      '@agents': resolve(__dirname, 'src/agents'),
      '@tools': resolve(__dirname, 'src/tools'),
      '@skills': resolve(__dirname, 'src/skills'),
      '@memory': resolve(__dirname, 'src/memory'),
      '@hooks': resolve(__dirname, 'src/hooks'),
    },
  },
});
