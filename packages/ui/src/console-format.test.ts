/**
 * Console format directives in the log panel.
 *
 * The panel started showing a library's styled banner as the raw thing —
 * "%c🌀 @strudel/core loaded 🌀 background-color: black;color:white" — because
 * it joined the arguments and devtools does not. There is no styling to apply
 * in a plain text panel, so the directive and its CSS are dropped and the
 * words are kept.
 */

import { describe, it, expect } from 'vitest';
import { formatArgs } from './console-log.js';

describe('formatArgs', () => {
  it('drops a %c directive and the style that goes with it', () => {
    expect(formatArgs(['%c@strudel/core loaded', 'background-color: black;color:white']))
      .toBe('@strudel/core loaded');
  });

  it('leaves an ordinary call alone', () => {
    expect(formatArgs(['patched', 4, 'lights'])).toBe('patched 4 lights');
  });

  it('substitutes strings and numbers', () => {
    expect(formatArgs(['%s is at %d%%', 'wash', 80])).toBe('wash is at 80%');
  });

  it('truncates for %d and keeps the fraction for %f', () => {
    expect(formatArgs(['%d', 3.7])).toBe('3');
    expect(formatArgs(['%f', 3.5])).toBe('3.5');
  });

  it('keeps arguments the directives did not consume', () => {
    expect(formatArgs(['%s said', 'wash', 'and then stopped'])).toBe('wash said and then stopped');
  });

  it('leaves a directive with nothing to consume as written', () => {
    expect(formatArgs(['%s and %s', 'one'])).toBe('one and %s');
  });

  it('does not treat a percent in ordinary text as a directive', () => {
    expect(formatArgs(['dimmer at 50% of full'])).toBe('dimmer at 50% of full');
  });
});
