import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/gobo-dmx-live-code/' : '/',
  server: {
    port: 3000,
    // This computer only unless asked, the same rule the connector follows. It
    // used to be 0.0.0.0, which put the dev server, and the source it serves,
    // on every network the machine joined. For a phone or tablet on the LAN,
    // GOBO_LAN=1 npm run dev opens up this and the connector together.
    host: process.env.GOBO_LAN && /^(1|true|yes)$/i.test(process.env.GOBO_LAN) ? true : 'localhost',
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
