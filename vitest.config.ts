import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Root test config.
 *
 * `include` is scoped to package sources so the default glob doesn't sweep
 * the whole repo and pick up scratch harnesses or the built output.
 *
 * The alias and the inlining are what let the real @strudel/core load under
 * vitest, for the tests that run scenes through it (*.engine.test.ts). Its
 * bundle imports a name @kabelsalat/web's package entry does not export; the
 * ES build exports it, so the import is pointed there.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@kabelsalat/web': fileURLToPath(new URL('./node_modules/@kabelsalat/web/dist/index.mjs', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.{ts,mts,js,mjs}'],
    server: { deps: { inline: [/@strudel/, /@kabelsalat/] } },
  },
});
