/**
 * A fixture definition, written back out as the code that would make it.
 *
 * Every fixture in the library is a worked example of the thing people find
 * hardest to start: a channel map. The definitions were already there and
 * only their summaries were shown, so the answer to "how do I write one of
 * these" was to read the docs and guess, with a dozen finished examples in the
 * panel and no way to see how any of them was built.
 *
 * Generated from the def rather than stored beside it, so it cannot drift from
 * what the fixture actually is, and so it works for a fixture someone imported
 * five minutes ago as well as for the built-ins.
 */

import type { FixtureDef, ChannelDef, ChannelSlot } from './fixtures.js';

/** A JS string literal, single-quoted, for a value we control the shape of. */
function str(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Key as written in an object literal: bare when it is a plain identifier. */
function key(k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : str(k);
}

function slotSource(slot: ChannelSlot): string {
  const parts: string[] = [`name: ${str(slot.name)}`];
  if (slot.value !== undefined) parts.push(`value: ${slot.value}`);
  if (slot.from !== undefined) parts.push(`from: ${slot.from}`);
  if (slot.to !== undefined) parts.push(`to: ${slot.to}`);
  return `{ ${parts.join(', ')} }`;
}

function channelSource(ch: ChannelDef, indent: string): string {
  const parts: string[] = [`offset: ${ch.offset}`, `name: ${str(ch.name)}`, `type: ${str(ch.type)}`];
  // Strip geometry, which is the part worth copying and the part nobody
  // guesses right first time.
  if (ch.pixelCount !== undefined) parts.push(`pixelCount: ${ch.pixelCount}`);
  if (ch.pixelLayout !== undefined) parts.push(`pixelLayout: ${str(ch.pixelLayout)}`);
  if (ch.columns !== undefined) parts.push(`columns: ${ch.columns}`);
  if (ch.serpentine !== undefined) parts.push(`serpentine: ${ch.serpentine}`);
  if (ch.origin !== undefined) parts.push(`origin: ${str(ch.origin)}`);

  const head = `${indent}{ ${parts.join(', ')}`;

  // Slots go one per line: a wheel with eight of them is unreadable inline,
  // and they are exactly what someone adapting this will edit.
  if (ch.slots !== undefined && ch.slots.length > 0) {
    const inner = ch.slots.map((s) => `${indent}    ${slotSource(s)},`).join('\n');
    return `${head}, slots: [\n${inner}\n${indent}  ] },`;
  }
  // A description can be long; keep it last and on its own line when it is.
  if (ch.description !== undefined && ch.description.length > 40) {
    return `${head},\n${indent}  description: ${str(ch.description)} },`;
  }
  if (ch.description !== undefined) return `${head}, description: ${str(ch.description)} },`;
  return `${head} },`;
}

/**
 * The `defineFixture(...)` call that would produce this definition.
 *
 * Round-trips: running the output defines a fixture equal to the input. That
 * is what makes it safe to offer as a template, since the first thing anyone
 * does with it is change one number and run it.
 */
export function defineFixtureSource(id: string, def: FixtureDef): string {
  const head = [
    `defineFixture(${str(id)}, {`,
    `  name: ${str(def.name)},`,
    `  manufacturer: ${str(def.manufacturer)},`,
    `  type: ${str(def.type)},`,
    `  channelCount: ${def.channelCount},`,
    `  channels: [`,
  ];
  const body = def.channels.map((ch) => channelSource(ch, '    '));
  return [...head, ...body, '  ],', '})'].join('\n');
}
