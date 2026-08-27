#!/usr/bin/env node
/**
 * npx entry point for the connector.
 *
 * A browser cannot open a UDP socket, so Art-Net and sACN need something
 * native running. This is that, for anyone who already has Node:
 *
 *   npx gobo-connector
 *
 * No download, no unsigned binary, no security warning to click through. Then
 * open https://nicholaspjm.github.io/gobo-dmx-live-code/ and press ctrl+enter.
 *
 * A separate wrapper rather than a shebang in the source, so the compiled
 * output stays a plain module and tsc has nothing to preserve.
 */
import '../dist/index.js';
