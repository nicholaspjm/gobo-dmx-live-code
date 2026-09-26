/**
 * Patching a rig from the fixtures tab.
 *
 * The fixtures tab listed every light gobo knows, with an example to copy, and
 * left the rest to the reader: pick addresses, name each light, work out where
 * the next one starts. That is the first ten minutes with a real rig, done by
 * hand, and it is arithmetic nobody should be doing while a room waits. So a
 * row can write the patch: how many, starting where, and the lines go into the
 * scene as ordinary code, one named light per line, the way a scene would be
 * written by hand. Nothing is hidden behind the panel. Edit an address in the
 * code and that is the patch.
 *
 * This file is the planning, with no DOM in it. library.ts draws the form and
 * main.ts writes the lines into the editor.
 */

import { findLights } from './declared-lights.js';

export interface PatchRequest {
  /** The fixture id as a scene writes it: fixture(1, id). */
  id: string;
  /** Channels one of these lights takes. */
  channelCount: number;
  /** What to call it: 'par' becomes par, or par1, par2 … for several. */
  name: string;
  count: number;
  /** 1-based DMX address of the first light. */
  start: number;
  universe: number;
}

export interface PatchPlan {
  /** The lines to put in the scene, joined with newlines. */
  code: string;
  /** The light names, in order, plus the group's last if there is one. */
  names: string[];
  /** Addresses taken, first to last, for the status line. */
  first: number;
  last: number;
}

/** What the lines a plan writes look like when something is wrong with it. */
export type PatchResult = { ok: true; plan: PatchPlan } | { ok: false; error: string };

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * A short name for a light of this kind, as someone rigging would say it.
 *
 * Read off the id, which is where a fixture's kind is written in words; the
 * definition's type is the fallback. A name only has to be a good first guess:
 * it is one word in the code, and renaming it is typing.
 */
export function baseName(id: string, type?: string): string {
  const words = id.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const has = (w: string): boolean => words.includes(w);
  if (has('par')) return 'par';
  if (has('strobe') || type === 'strobe') return 'strb';
  if (has('moving') || has('head') || type === 'moving-head') return 'head';
  if (has('bar') || has('pixel') || has('strip')) return 'bar';
  if (has('blinder')) return 'blinder';
  if (id === 'dim' || type === 'dimmer') return 'dimmer';
  if (/^(dim-)?rgb[aw]?$/.test(id) || type === 'rgb' || type === 'rgbw' || type === 'rgba') return 'wash';
  return 'light';
}

/** The plural a group of these gets: par → pars, wash → washes. */
export function plural(name: string): string {
  return /(s|sh|ch|x)$/.test(name) ? `${name}es` : `${name}s`;
}

/** Every name the document already binds, which a new light must not reuse. */
export function namesInUse(doc: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) out.add(m[1]);
  return out;
}

/**
 * The first address after every light the document patches on `universe`, or
 * 1 if it patches none there.
 *
 * Read from declarations whose address is written as a number, which is how a
 * patch is usually written and how this file writes one. A light made in a
 * loop is not counted, so the answer can land on it; the form shows the
 * address and it can be changed.
 */
export function nextFreeAddress(
  doc: string,
  universe: number,
  channelsOf: (fixtureId: string) => number | undefined,
): number {
  let next = 1;
  for (const d of findLights(doc)) {
    const start = /^\d+$/.test(d.args[0] ?? '') ? Number(d.args[0]) : null;
    if (start === null) continue;
    let size: number | undefined;
    let uniArg: string | undefined;
    if (d.kind === 'fixture') {
      const id = /^['"`]([^'"`]+)['"`]$/.exec(d.args[1] ?? '')?.[1];
      size = id === undefined ? undefined : channelsOf(id);
      uniArg = d.args[2];
    } else if (d.kind === 'rgbStrip' || d.kind === 'rgbwStrip' || d.kind === 'monoStrip') {
      const pixels = /^\d+$/.test(d.args[1] ?? '') ? Number(d.args[1]) : null;
      const per = d.kind === 'rgbStrip' ? 3 : d.kind === 'rgbwStrip' ? 4 : 1;
      size = pixels === null ? undefined : pixels * per;
      uniArg = d.args[2];
    }
    if (size === undefined) continue;
    const uni = uniArg === undefined ? 0 : /^\d+$/.test(uniArg) ? Number(uniArg) : null;
    if (uni !== universe) continue;
    next = Math.max(next, start + size);
  }
  return next;
}

/**
 * Names for `count` lights called `base`, and for the group over them, that
 * clash with nothing in `taken`. One light keeps the bare name if it is free;
 * several are numbered from 1, skipping any number already used.
 */
export function pickNames(base: string, count: number, taken: ReadonlySet<string>): { lights: string[]; group: string | null } {
  const lights: string[] = [];
  if (count === 1 && !taken.has(base)) {
    lights.push(base);
  } else {
    for (let n = 1; lights.length < count; n++) {
      const name = `${base}${n}`;
      if (!taken.has(name)) lights.push(name);
    }
  }
  let group: string | null = null;
  if (count > 1) {
    group = plural(base);
    for (let n = 2; taken.has(group); n++) group = `${plural(base)}${n}`;
  }
  return { lights, group };
}

/** Plan the lines for a request, or say why it cannot be patched. */
export function planPatch(req: PatchRequest, taken: ReadonlySet<string>): PatchResult {
  const { id, channelCount, count, start, universe } = req;
  const name = req.name.trim();
  if (!IDENT.test(name)) {
    return { ok: false, error: 'A name is one word of letters and digits, starting with a letter, like par or frontWash.' };
  }
  if (!Number.isInteger(count) || count < 1 || count > 64) {
    return { ok: false, error: 'How many is a whole number from 1 to 64.' };
  }
  if (!Number.isInteger(start) || start < 1 || start > 512) {
    return { ok: false, error: 'The address is the one set on the first light, from 1 to 512.' };
  }
  if (!Number.isInteger(universe) || universe < 0) {
    return { ok: false, error: 'The universe is a whole number, 0 or more.' };
  }
  const last = start + count * channelCount - 1;
  if (last > 512) {
    return {
      ok: false,
      error: `${count} of these from ${start} would run to channel ${last}, past 512. Start lower, or put some on the next universe.`,
    };
  }

  const { lights, group } = pickNames(name, count, taken);
  const uni = universe === 0 ? '' : `, ${universe}`;
  const lines = lights.map((light, i) =>
    `const ${light} = fixture(${start + i * channelCount}, '${id}'${uni})`);
  if (group !== null) lines.push(`const ${group} = group(${lights.join(', ')})`);
  return {
    ok: true,
    plan: {
      code: lines.join('\n'),
      names: group === null ? lights : [...lights, group],
      first: start,
      last,
    },
  };
}

/**
 * Where new patch lines go: after the last light the document declares on a
 * line of its own, so a patch reads as one block, or else under the comments
 * and the output and tempo lines at the top. A 0-based line index to insert
 * before.
 */
export function patchInsertLine(doc: string): number {
  const lines = doc.split('\n');
  const decl = /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:fixture|rgbStrip|rgbwStrip|monoStrip|group)\s*\(.*\)[^()]*$/;
  let last = -1;
  lines.forEach((l, i) => { if (decl.test(l)) last = i; });
  if (last >= 0) return last + 1;
  let i = 0;
  const preamble = /^\s*(?:\/\/.*|(?:artnet|sacn|osc|mock|usb|td|setBPM|setcps|setcpm)\s*\(.*\)\s*;?\s*(?:\/\/.*)?|)$/;
  while (i < lines.length && preamble.test(lines[i]) && lines[i].trim() !== '') i++;
  return i;
}
