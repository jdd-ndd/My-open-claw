// Vitest 全局 setup.
// v1.1.9: Web 组件测试起步. 挂 jest-dom matchers.
// v1.2.0: 加 afterEach cleanup, 避免 test 之间 DOM 累积, 引发 "Found multiple elements" 误报.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
