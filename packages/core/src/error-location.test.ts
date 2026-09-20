/**
 * Saying which line a scene failed on, and why a name was refused.
 *
 * A scene used to be a handful of lines, where "wash.dim is not a function"
 * was the whole answer. A file that holds a whole performance is long enough
 * that the same message leaves you scrolling — and the editor has no search to
 * help — so the line is carried out of the sandbox with the message.
 *
 * The rule the other way round matters just as much: a line that cannot be
 * trusted is not reported at all. Sending an operator to the wrong look
 * mid-show is worse than sending them to none.
 *
 * The errors here are produced the way the sandbox produces them — compiled
 * with new Function, under "use strict", with the sandbox's own names as
 * parameters — so the stack frames being read are the real shape.
 */

import { describe, it, expect } from 'vitest';

// websocket.ts reads window.location.hostname at module-load time, and the
// module graph pulls it in for real. One property is all it reaches for.
const g = globalThis as { window?: { location: { hostname: string } } };
if (g.window === undefined) g.window = { location: { hostname: 'localhost' } };

const { locatedError, methodHint, reservedNameHint } = await import('./eval.js');

/** Compile and run `code` the way the sandbox does, returning what it threw. */
function runAndCatch(code: string, names: string[] = []): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...names, `"use strict";\n${code}`) as (...a: unknown[]) => unknown;
    fn(...names.map(() => undefined));
    return null;
  } catch (err) {
    return err;
  }
}

/** The located message for a scene expected to throw at runtime. */
function failureOf(code: string, names: string[] = [], globals: string[] = []): string {
  const err = runAndCatch(code, names);
  expect(err).not.toBeNull();
  return locatedError(err, code, globals);
}

describe('runtime errors carry their line', () => {
  it('reports the line a throw came from', () => {
    const error = failureOf(['const a = 1', 'const b = 2', 'throw new Error("boom")'].join('\n'));
    expect(error).toBe('line 3: boom');
  });

  it('reports the first line when that is where it went wrong', () => {
    expect(failureOf('nope()')).toMatch(/^line 1: /);
  });

  it('finds the failing line inside a look function', () => {
    // The shape this exists for: looks written as functions, one of them
    // called. The line that matters is inside the one that ran, not the call.
    const code = [
      'const verse = () => {',
      '  return 1',
      '}',
      '',
      'const chorus = () => {',
      '  throw new Error("no such channel")',
      '}',
      '',
      'chorus()',
    ].join('\n');
    expect(failureOf(code)).toBe('line 6: no such channel');
  });

  it('puts the line first, so it survives a clipped status bar', () => {
    expect(failureOf('throw new Error("boom")')).toMatch(/^line \d+: /);
  });

  it('still reports the message when a line cannot be read', () => {
    // Not an Error at all, so there is no stack and nothing to locate.
    expect(locatedError('a bare string', 'whatever')).toBe('a bare string');
  });

  it('never points past the end of the scene', () => {
    const code = 'throw new Error("boom")';
    const match = /^line (\d+):/.exec(failureOf(code));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(code.split('\n').length);
  });

  it('does not read the compiler own module path as the scene line', () => {
    // The regression that shipped for exactly one build. Under Vite the frame
    // for the module doing the compiling is an "@fs/…" path, and a pattern
    // loose enough to accept a Firefox frame accepted that too — so the line
    // reported was this file's, not the scene's. Wrong, not missing.
    const err = new Error('boom');
    err.stack = [
      'Error: boom',
      '    at eval (eval at lineOffset (http://localhost:3000/@fs/Users/x/eval.ts?t=1:310:5), <anonymous>:4:7)',
    ].join('\n');
    // Line 4 of the compiled body, minus the preamble — never 310.
    const located = locatedError(err, Array.from({ length: 40 }, () => 'x').join('\n'));
    expect(located).not.toContain('310');
    expect(located).toMatch(/^line \d+: boom$/);
  });

  it('reads a Firefox frame', () => {
    const err = new Error('boom');
    err.stack = 'boom\nanonymous@http://localhost:3000/ line 12 > Function:4:7';
    expect(locatedError(err, ['a', 'b', 'c', 'd'].join('\n'))).toMatch(/^line \d+: boom$/);
  });

  it('drops a line that falls outside the scene rather than quoting it', () => {
    // A hand-made error whose stack points a long way past the end. Better to
    // say only what went wrong than to send someone to a line that is not there.
    const err = new Error('from somewhere else');
    err.stack = 'Error: from somewhere else\n    at <anonymous>:9999:1';
    expect(locatedError(err, 'one line')).toBe('from somewhere else');
  });
});

describe('a name gobo already uses explains itself', () => {
  const NAMES = ['strobe', 'flash', 'red', 'pulse'];

  /** The message the sandbox would return for a scene that will not compile. */
  function clashOf(code: string): string {
    let message = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(...NAMES, `"use strict";\n${code}`);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).not.toBe('');
    return reservedNameHint(message, NAMES);
  }

  it('names the clash, says it is callable, and suggests both renames', () => {
    const error = clashOf('const strobe = () => {}');
    expect(error).toContain('strobe(…)');
    expect(error).toContain('myStrobe');
    expect(error).toContain('strobeLook');
  });

  it('mentions that a function declaration does not clash', () => {
    // Verified behaviour, not a guess: const and let are lexical declarations
    // and collide with a parameter name; a function declaration does not.
    expect(clashOf('const flash = () => {}')).toContain('function flash');
    expect(() => new Function(...NAMES, '"use strict";\nfunction flash() {}')).not.toThrow();
    expect(() => new Function(...NAMES, '"use strict";\nvar flash = 1')).not.toThrow();
  });

  it('covers a colour name, which is the other tempting look name', () => {
    expect(clashOf('const red = () => {}')).toContain('myRed');
  });

  it('leaves a redeclaration of the user own name alone', () => {
    // Not one of gobo's names, so there is nothing to explain and the engine's
    // own message is already the whole answer.
    const error = clashOf(['const mine = 1', 'const mine = 2'].join('\n'));
    expect(error).not.toContain("gobo's own");
  });

  it('leaves an unrelated message untouched', () => {
    expect(reservedNameHint('Unexpected end of input', NAMES)).toBe('Unexpected end of input');
  });
});

/**
 * "x.y is not a function", which is the message three different mistakes
 * arrive as. What the engine says names the variable and the method and stops
 * there, which is the half the scene already knows.
 */
describe('a method a light does not have', () => {
  const GLOBALS = ['screen', 'fixture', 'rgbStrip', 'flash', 'sine', 'red', 'amber'];
  const hint = (message: string): string => methodHint(message, GLOBALS);

  it('says a factory needs its brackets', () => {
    const error = hint('screen.flash is not a function');
    expect(error).toContain('screen()');
    expect(error).toContain('const myLight = screen()');
  });

  it('covers every light-maker, not just screen', () => {
    for (const name of ['fixture', 'rgbStrip', 'rgbwStrip', 'monoStrip', 'group']) {
      expect(hint(`${name}.dim is not a function`)).toContain(`${name}()`);
    }
  });

  it('answers .dim on a strip with the call that works', () => {
    const error = hint('wash.dim is not a function');
    expect(error).toContain('.mono(');
    // And says why it is not simply an alias, since .mono() would recolour.
    expect(error).toContain('the colour itself');
  });

  it('answers .white on an rgb strip', () => {
    expect(hint('wash.white is not a function')).toContain('.mono(');
  });

  it('sends a gobo function into a setter rather than onto a light', () => {
    const error = hint('wash.flash is not a function');
    expect(error).toContain('wash.dim(flash())');
    expect(error).toContain('wash.mono(flash())');
  });

  it('sends a colour to a colour setter, not a level one', () => {
    // A hint that leads into a second error is worse than none: .dim(red)
    // hands a colour to something that wants a level.
    const error = hint('wash.amber is not a function');
    expect(error).toContain('wash.color(amber)');
    expect(error).not.toContain('.dim(');
  });

  it('reads the sandbox binding list rather than a second copy of it', () => {
    // 'punch' is not bound here, so there is nothing to say about it.
    expect(hint('wash.punch is not a function')).toBe('wash.punch is not a function');
    expect(methodHint('wash.punch is not a function', [...GLOBALS, 'punch']))
      .toContain("gobo's own");
  });

  it('leaves any other message alone', () => {
    expect(hint('Cannot read properties of undefined')).toBe('Cannot read properties of undefined');
    expect(hint('wash.dim is not a fun')).toBe('wash.dim is not a fun');
  });

  it('still carries the line when it adds a hint', () => {
    const error = failureOf(
      ['const wash = {}', 'wash.dim(1)'].join('\n'),
      [],
      GLOBALS,
    );
    expect(error).toMatch(/^line 2: /);
    expect(error).toContain('.mono(');
  });
});
