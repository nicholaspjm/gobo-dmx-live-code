/**
 * Writes a fixture definition back out as the `defineFixture` code that makes it.
 *
 * Every fixture in the library is a worked channel map, the part people find
 * hardest to write from scratch, so the panel can show any of them as a
 * starting template.
 *
 * The source is generated from the def so it always matches the fixture, and it
 * works for imported fixtures as well as the built-ins.
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
  // Pixel-strip geometry: the fields most often copied, and most often wrong
  // on a first attempt.
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
 * Round-trips: running the output defines a fixture equal to the input, so it
 * is safe to offer as a template to edit and run.
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
