/**
 * Code formatter — Prettier, loaded on demand.
 *
 * Prettier's standalone browser build is ~1 MB of JS (parser + plugins
 * + core). Pulling it into the initial bundle would bloat first-paint
 * for a feature most sessions don't use, so we lazy-import it the first
 * time the user hits Ctrl+Shift+F. Subsequent formats are instant
 * because the module is cached.
 *
 * Format options are baked in — users don't configure Prettier per
 * scene. The defaults here match the codebase's own style (2-space
 * indent, single quotes, 80 columns) so formatting a sample scene
 * doesn't produce output that looks alien against the rest of the
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
  // Vite wraps CJS-ish modules so exports can land on .default or the
  // root — try both for defensiveness.
  const prettier = (prettierMod.default ?? prettierMod) as unknown as PrettierLike;
  const babel = (babelMod.default ?? babelMod) as unknown;
  const estree = (estreeMod.default ?? estreeMod) as unknown;
  _cached = { prettier, plugins: [babel, estree] };
  return _cached;
}

/**
 * Format a chunk of lumen code. Resolves to the formatted string or
 * rejects with the parser's error — callers should catch and surface
 * the message in the UI (typical: Prettier throws a friendly "unexpected
 * token at line N" for syntax errors).
 */
export async function formatLumenCode(src: string): Promise<string> {
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
