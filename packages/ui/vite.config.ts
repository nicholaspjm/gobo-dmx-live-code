import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/dmx-live-code/' : '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    target: 'es2022',
    outDir: '../../dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['@strudel/core'],
  },
});
