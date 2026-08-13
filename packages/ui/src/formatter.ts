/**
 * Code formatter: Prettier, loaded on demand.
 *
 * Prettier's standalone browser build is ~1 MB of JS (core, parser and
 * plugins). In the initial bundle it would slow first paint for a feature
 * most sessions don't use, so it is lazy-imported the first time the user
 * hits Ctrl+Shift+F and cached after that.
 *
 * Format options are baked in; there is no per-scene Prettier config. The
 * defaults match the codebase's own style (2-space indent, single quotes,
 * 80 columns) so a formatted sample scene looks like the rest of the
 * project.
 */

/** Minimal type for Prettier v3's format() to avoid importing its
 *  types eagerly. */
interface PrettierLike {
  format(code: string, options: Record<string, unknown>): Promise<string>;
}

let _cached: { prettier: PrettierLike; plugins: unknown[] } | null = null;

async function loadPrettier(): Promise<{ prettier: PrettierLike; plugins: unknown[] }> {
  if (_cached) return _cached;
  // The babel parser handles the superset of ES2020+ we run in the eval
  // sandbox. estree is the shared printer plugin the JS parsers depend on.
  // Dynamic imports so the bundler code-splits these out of the main chunk.
  const [prettierMod, babelMod, estreeMod] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ]);
  // Vite wraps CJS-ish modules, so exports can land on .default or on the
  // root. Try both.
  const prettier = (prettierMod.default ?? prettierMod) as unknown as PrettierLike;
  const babel = (babelMod.default ?? babelMod) as unknown;
  const estree = (estreeMod.default ?? estreeMod) as unknown;
  _cached = { prettier, plugins: [babel, estree] };
  return _cached;
}

/**
 * Format a chunk of gobo code. Resolves to the formatted string, or
 * rejects with the parser's error. Callers should catch it and surface the
 * message in the UI; for syntax errors Prettier throws "unexpected token
 * at line N".
 */
export async function formatGoboCode(src: string): Promise<string> {
  const { prettier, plugins } = await loadPrettier();
  return prettier.format(src, {
    parser: 'babel',
    plugins,
    tabWidth: 2,
    useTabs: false,
    singleQuote: true,
    semi: false,
    printWidth: 80,
    trailingComma: 'all',
    arrowParens: 'always',
  });
}
