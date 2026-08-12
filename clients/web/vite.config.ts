import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18780',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:18780',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // 入口拆分策略：
        //   - main:        业务代码 (按需加载)
        //   - vendor-react:  React + ReactDOM
        //   - vendor-router: react-router-dom
        //   - vendor-state:  zustand
        //   - vendor-md:     react-markdown + remark-gfm + syntax highlighter（最大块）
        //   - vendor-ui:     @radix-ui/* + lucide-react
        //   - vendor-utils:  axios + class-variance-authority + clsx + tailwind-merge + zod
        //   - vendor-styles: tailwind + autoprefixer 运行时
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // ── Markdown 渲染链（最大头，单独拆） ──
          if (
            id.includes('react-markdown') ||
            id.includes('remark-gfm') ||
            id.includes('react-syntax-highlighter') ||
            id.includes('refractor') ||
            id.includes('lowlight') ||
            id.includes('hast-') ||
            id.includes('mdast-') ||
            id.includes('micromark') ||
            id.includes('unified') ||
            id.includes('vfile')
          ) {
            return 'vendor-md';
          }

          // ── UI 基础库 ──
          if (
            id.includes('@radix-ui') ||
            id.includes('lucide-react') ||
            id.includes('class-variance-authority') ||
            id.includes('clsx') ||
            id.includes('tailwind-merge')
          ) {
            return 'vendor-ui';
          }

          // ── 状态管理 ──
          if (id.includes('zustand')) {
            return 'vendor-state';
          }

          // ── 路由 ──
          if (id.includes('react-router') || id.includes('@remix-run/router')) {
            return 'vendor-router';
          }

          // ── React 核心 ──
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }

          // ── 工具/网络/校验 ──
          if (
            id.includes('axios') ||
            id.includes('zod') ||
            id.includes('use-sync-external-store') ||
            id.includes('nanoid')
          ) {
            return 'vendor-utils';
          }

          return undefined;
        },
        // 让 chunk 文件名更易读
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 800,
  },
});
