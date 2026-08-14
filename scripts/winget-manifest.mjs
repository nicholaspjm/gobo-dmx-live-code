#!/usr/bin/env node
/**
 * Generate winget manifests for the connector.
 *
 * winget is built into Windows 11, so `winget install gobo` downloads and sets
 * up the connector with no browser download and no SmartScreen warning. That
 * removes the trust problem for anyone who has it, without paying for a code
 * signing certificate.
 *
 * winget manifests reference a published release asset by URL and SHA256, so
 * this reads them from the actual release rather than being hand-maintained.
 *
 *   npm run winget                 use the latest release
 *   npm run winget -- --tag v0.2.0 pin a version
 *
 * Writes to packaging/winget/. Submitting them is a pull request to
 * microsoft/winget-pkgs, printed at the end.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * Unauthenticated GitHub API calls are rate limited hard enough to fail on a
 * shared address, so borrow the gh CLI's token when there is one.
 */
function ghHeaders() {
  const headers = { 'User-Agent': 'gobo-winget', Accept: 'application/vnd.github+json' };
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // No gh, or not logged in. Unauthenticated may still work.
  }
  return headers;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'packaging', 'winget');

const REPO = 'nicholaspjm/gobo-dmx-live-code';
const PACKAGE_ID = 'nicholaspjm.gobo';
const ASSET = 'gobo-connector-windows.exe';

const args = process.argv.slice(2);
const tagArg = args.indexOf('--tag');
const wantTag = tagArg !== -1 ? args[tagArg + 1] : null;

const relUrl = wantTag
  ? `https://api.github.com/repos/${REPO}/releases/tags/${wantTag}`
  : `https://api.github.com/repos/${REPO}/releases/latest`;

console.log(`[winget] reading ${wantTag ?? 'the latest release'}`);
const rel = await fetch(relUrl, { headers: ghHeaders() }).then((r) => {
  if (!r.ok) throw new Error(`GitHub returned ${r.status} for ${relUrl}`);
  return r.json();
});

const tag = rel.tag_name;
const version = tag.replace(/^v/, '');
const asset = (rel.assets ?? []).find((a) => a.name === ASSET);
if (!asset) {
  console.error(`[winget] ${tag} has no ${ASSET}. Assets: ${(rel.assets ?? []).map((a) => a.name).join(', ') || 'none'}`);
  process.exit(1);
}

// winget verifies the download against this hash, so it has to come from the
// bytes actually published rather than from a local build.
console.log(`[winget] hashing ${asset.name} (${(asset.size / 1024 / 1024).toFixed(0)} MB)`);
const bytes = Buffer.from(await fetch(asset.browser_download_url, { headers: ghHeaders() }).then((r) => {
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  return r.arrayBuffer();
}));
const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase();
console.log(`[winget] sha256 ${sha256}`);

const SCHEMA = 'https://aka.ms/winget-manifest';
const MANIFEST_VERSION = '1.6.0';

const files = {
  [`${PACKAGE_ID}.yaml`]: `# yaml-language-server: $schema=${SCHEMA}.version.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: ${MANIFEST_VERSION}
`,

  [`${PACKAGE_ID}.installer.yaml`]: `# yaml-language-server: $schema=${SCHEMA}.installer.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
InstallerType: portable
Commands:
  - gobo-connector
ReleaseDate: ${(rel.published_at ?? '').slice(0, 10)}
Installers:
  - Architecture: x64
    InstallerUrl: ${asset.browser_download_url}
    InstallerSha256: ${sha256}
ManifestType: installer
ManifestVersion: ${MANIFEST_VERSION}
`,

  [`${PACKAGE_ID}.locale.en-US.yaml`]: `# yaml-language-server: $schema=${SCHEMA}.defaultLocale.${MANIFEST_VERSION}.schema.json
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: nicholaspjm
PublisherUrl: https://github.com/nicholaspjm
PublisherSupportUrl: https://github.com/${REPO}/issues
PackageName: gobo connector
PackageUrl: https://github.com/${REPO}
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
ShortDescription: Sends DMX from the gobo browser app to Art-Net, sACN or OSC.
Description: |-
  gobo is a browser based live coding environment for DMX lighting. A browser
  cannot open a UDP socket, so it cannot speak Art-Net itself. The connector is
  the piece that can: run it, open the app, and lighting output works.

  It sets itself to start at login the first time it runs, so this is a one
  time step. Run it with --uninstall to undo that.
Tags:
  - dmx
  - art-net
  - sacn
  - lighting
  - live-coding
ManifestType: defaultLocale
ManifestVersion: ${MANIFEST_VERSION}
`,
};

mkdirSync(outDir, { recursive: true });
for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(outDir, name), body, 'utf8');
  console.log(`[winget] wrote packaging/winget/${name}`);
}

const dest = `manifests/n/nicholaspjm/gobo/${version}/`;
console.log(`
Next, submit them. Either:

  winget validate --manifest packaging/winget
  wingetcreate submit --token <a GitHub token> packaging/winget

or open a pull request on microsoft/winget-pkgs putting these three files in:

  ${dest}

Their CI validates the manifest and installs the package before a human looks
at it. Once merged: winget install ${PACKAGE_ID}
`);
