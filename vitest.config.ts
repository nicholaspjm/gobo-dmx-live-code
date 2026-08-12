import { defineConfig } from 'vitest/config';

/**
 * Root test config.
 *
 * `include` is scoped to package sources so the default glob doesn't sweep
 * the whole repo and pick up scratch harnesses or the built output.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,mts,js,mjs}'],
  },
});
