#!/usr/bin/env node
/**
 * npx entry point for the connector.
 *
 * A browser cannot open a UDP socket, so Art-Net and sACN need something
 * native running. This is that, for anyone who already has Node:
 *
 *   npx gobo-connector@latest
 *
 * No download, no unsigned binary, no security warning to click through. It
 * points at the app and opens it, as the downloaded connector does.
 *
 * A separate wrapper rather than a shebang in the source, so the compiled
 * output stays a plain module and tsc has nothing to preserve.
 */

// Tells the connector it was started from the npm package, so it behaves like
// the downloaded one without recording a login item: under npx it runs from a
// cache directory that npm clears when it likes, and a login item pointing in
// there would one day start nothing. Set before the import, which is dynamic so
// that it runs after this line rather than being hoisted above it.
globalThis.goboViaNpm = true;
await import('../dist/index.js');
