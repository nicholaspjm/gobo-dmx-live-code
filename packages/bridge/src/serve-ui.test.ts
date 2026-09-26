/**
 * What the connector will serve when it is also serving the app.
 *
 * Two faults, both reachable by anyone who could open tcp/3001 — which
 * at the time was every interface, not only loopback.
 *
 * The containment check was `candidate.startsWith(root)`, a string test rather
 * than a path test, so a root of /srv/dist also matched /srv/dist-backup. A
 * build with a versioned or backup sibling beside it — the ordinary case — let
 * a request for /../dist-backup/.env resolve outside the build and be served.
 *
 * The decode that produced that path ran outside the handler's try, so a single
 * `GET /%` threw URIError and took the process down. It died without blacking
 * out, so every receiver held its last frame and the rig stayed lit.
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'path';

import { isInsideRoot } from './serve-ui.js';

const ROOT = resolve('/srv/gobo/dist');

describe('isInsideRoot', () => {
  it('accepts the root itself and files within it', () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
    expect(isInsideRoot(ROOT, resolve(ROOT, 'index.html'))).toBe(true);
    expect(isInsideRoot(ROOT, resolve(ROOT, 'assets/app.js'))).toBe(true);
  });

  it('refuses a sibling whose name merely extends the root', () => {
    // The whole bug: these all pass a bare startsWith(root).
    expect(isInsideRoot(ROOT, resolve('/srv/gobo/dist-backup/.env'))).toBe(false);
    expect(isInsideRoot(ROOT, resolve('/srv/gobo/dist.bak/config.json'))).toBe(false);
    expect(isInsideRoot(ROOT, resolve('/srv/gobo/dist2/index.html'))).toBe(false);
  });

  it('refuses an escape that leaves the tree altogether', () => {
    expect(isInsideRoot(ROOT, resolve('/etc/passwd'))).toBe(false);
    expect(isInsideRoot(ROOT, resolve('/srv/gobo/notes.txt'))).toBe(false);
  });

  it('handles a root given with a trailing separator', () => {
    expect(isInsideRoot(ROOT + sep, resolve(ROOT, 'index.html'))).toBe(true);
    expect(isInsideRoot(ROOT + sep, resolve('/srv/gobo/dist-backup/.env'))).toBe(false);
  });
});
