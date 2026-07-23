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
});
