/**
 * Fixture library panel — UI over the core fixture-library storage.
 *
 * Lists every saved fixture with export / delete controls, plus any
 * session-only custom fixtures (declared via `defineFixture` in the
 * user's code but not yet saved) so the user can promote them into
 * persistent storage. Also hosts the "import from file" flow.
 *
 * Everything lives under a sliding side-panel keyed off a topbar button,
 * mirroring the docs panel's UX.
 */

import {
  getLibraryFixtures,
  saveToLibrary,
  removeFromLibrary,
  isInLibrary,
  toExportString,
  parseImportString,
  getCustomFixtures,
  defineFixture,
  type FixtureDef,
} from '@lumen/core';
import { getPublicFixtures } from './public-fixtures.js';

/** Destination of the GitHub "share" flow. Kept here so a repo rename
 *  is a one-line change. */
const PUBLIC_REPO_SLUG = 'nicholaspjm/lumen-dmx-live-code';

/** Mount the library panel inside the page. The caller is responsible for
 *  the toggle button visibility — we just wire its click handler. */
export function mountLibraryPanel(opts: {
  panelEl: HTMLElement;
  bodyEl: HTMLElement;
  toggleEl: HTMLButtonElement;
  closeEl: HTMLButtonElement;
}): { refresh: () => void } {
  const { panelEl, bodyEl, toggleEl, closeEl } = opts;

  function setOpen(open: boolean): void {
    panelEl.classList.toggle('open', open);
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleEl.classList.toggle('active', open);
    if (open) refresh();
  }

  toggleEl.addEventListener('click', () => setOpen(!panelEl.classList.contains('open')));
  closeEl.addEventListener('click', () => setOpen(false));
  // Escape closes, same as docs panel.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) setOpen(false);
  });

  // Body-level click delegation — buttons are rebuilt on every refresh, so
  // we read the action off the clicked element's data attributes.
  bodyEl.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-lib-action]');
    if (!btn) return;
    const action = btn.dataset.libAction;
    const id = btn.dataset.libId ?? '';
    switch (action) {
      case 'save':      handleSave(id);         break;
      case 'delete':    handleDelete(id);       break;
      case 'export':    handleExport(id);       break;
      case 'import':    openFilePicker();       break;
      case 'share':     handleShare(id);        break;
    }
  });

  // File input lives outside the panel body (hidden) so its click doesn't
  // race the body's delegated listener. Re-used for every import.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    await handleImportFile(file);
  });

  function openFilePicker(): void {
    fileInput.click();
  }

  function handleSave(id: string): void {
    const def = getCustomFixtures()[id];
    if (!def) {
      flashBanner(`No fixture named "${id}" in this session.`, 'error');
      return;
    }
    saveToLibrary(id, def);
    flashBanner(`Saved "${id}" to library.`);
    refresh();
  }

  function handleDelete(id: string): void {
    if (!confirm(`Remove "${id}" from your library? This doesn't affect any currently running code.`)) return;
    removeFromLibrary(id);
    flashBanner(`Removed "${id}" from library.`);
    refresh();
  }

  /** Look up a fixture def by id across all three registries (public,
   *  saved library, session). Public is checked last so a user-owned
   *  version wins if ids happen to match. */
  function findDef(id: string): FixtureDef | null {
    return (
      getCustomFixtures()[id]
        ?? getLibraryFixtures().find((e) => e.id === id)?.def
        ?? getPublicFixtures().find((e) => e.id === id)?.def
        ?? null
    );
  }

  function handleExport(id: string): void {
    const def = findDef(id);
    if (!def) return;
    const blob = new Blob([toExportString(id, def)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.lumen-fixture.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer revoke to next tick so the download actually starts.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Open a GitHub pre-filled new-file page so the user can propose this
   * fixture as a PR to the public library. GitHub's web UI accepts
   * `filename` + `value` query params on /new routes — it lands the user
   * on a "create new file in fork" page with everything filled in. They
   * click "propose change" and the PR is open.
   */
  function handleShare(id: string): void {
    const def = findDef(id);
    if (!def) return;
    const body = toExportString(id, def);

    const confirmed = confirm(
      `Propose "${id}" for the public library?\n\n` +
      `A new tab will open on GitHub with the fixture pre-filled into fixtures/${id}.json. ` +
      `You'll click "Propose change" — GitHub forks the repo for you and opens a pull request. ` +
      `Once reviewed and merged, the fixture ships to everyone using lumen.`,
    );
    if (!confirmed) return;

    const url =
      `https://github.com/${PUBLIC_REPO_SLUG}/new/main/fixtures` +
      `?filename=${encodeURIComponent(`${id}.json`)}` +
      `&value=${encodeURIComponent(body)}`;
    // New tab, opener-safe.
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleImportFile(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      flashBanner(`Couldn't read file: ${(err as Error).message}`, 'error');
      return;
    }
    const parsed = parseImportString(text);
    if (!parsed.ok || !parsed.id || !parsed.def) {
      flashBanner(parsed.error ?? 'Invalid fixture file.', 'error');
      return;
    }
    // Register in runtime immediately, then persist.
    try {
      defineFixture(parsed.id, parsed.def);
    } catch (err) {
      flashBanner(`Registration failed: ${(err as Error).message}`, 'error');
      return;
    }
    saveToLibrary(parsed.id, parsed.def);
    flashBanner(`Imported "${parsed.id}".`);
    refresh();
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function channelSummary(def: FixtureDef): string {
    const pieces: string[] = [];
    const manufacturer = def.manufacturer && def.manufacturer !== 'Generic' ? `${def.manufacturer} · ` : '';
    pieces.push(`${manufacturer}${def.channelCount} channels`);
    const stripChs = def.channels.filter((c) => c.type === 'strip');
    for (const sc of stripChs) {
      const layout = sc.pixelLayout ?? 'rgb';
      pieces.push(`${sc.pixelCount} × ${layout.toUpperCase()} pixels`);
    }
    return pieces.join(' · ');
  }

  type RowTier = 'public' | 'saved' | 'session';

  function renderRow(entry: { id: string; def: FixtureDef }, tier: RowTier): string {
    const idAttr = escapeAttr(entry.id);
    // Action buttons differ per tier:
    //   public  — community-contributed, already usable in code, can export
    //   saved   — user-pinned locally, can export / share / delete
    //   session — defined in current code but not yet pinned, can save / export / share
    let actions = '';
    if (tier === 'public') {
      actions = `
        <button type="button" class="lib-action" data-lib-action="export" data-lib-id="${idAttr}">export</button>`;
    } else if (tier === 'saved') {
      actions = `
        <button type="button" class="lib-action" data-lib-action="export" data-lib-id="${idAttr}">export</button>
        <button type="button" class="lib-action" data-lib-action="share"  data-lib-id="${idAttr}" title="Propose this fixture for the public library">share</button>
        <button type="button" class="lib-action lib-danger" data-lib-action="delete" data-lib-id="${idAttr}">delete</button>`;
    } else {
      actions = `
        <button type="button" class="lib-action lib-primary" data-lib-action="save"   data-lib-id="${idAttr}">save to library</button>
        <button type="button" class="lib-action"            data-lib-action="export" data-lib-id="${idAttr}">export</button>
        <button type="button" class="lib-action"            data-lib-action="share"  data-lib-id="${idAttr}" title="Propose this fixture for the public library">share</button>`;
    }
    const extraClass = tier === 'session' ? ' lib-row-unsaved' : '';
    const tierTag = tier === 'public' ? ` <span class="lib-row-tag">public</span>` : '';
    return `
      <div class="lib-row${extraClass}">
        <div class="lib-row-meta">
          <div class="lib-row-title">
            <span class="lib-row-id">${escapeText(entry.id)}</span>
            <span class="lib-row-name">${escapeText(entry.def.name)}</span>${tierTag}
          </div>
          <div class="lib-row-sub">${escapeText(channelSummary(entry.def))}</div>
        </div>
        <div class="lib-row-actions">${actions}</div>
      </div>`;
  }

  function refresh(): void {
    const publicFixtures = getPublicFixtures();
    const saved = getLibraryFixtures();
    const runtime = Object.entries(getCustomFixtures())
      .map(([id, def]) => ({ id, def }))
      // Don't surface session entries that also happen to be in the library
      // or already shipped in the public bundle — would just be confusing
      // duplicates.
      .filter((e) => !isInLibrary(e.id) && !publicFixtures.some((p) => p.id === e.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    const publicBlock = publicFixtures.length
      ? publicFixtures.map((e) => renderRow(e, 'public')).join('')
      : `<div class="lib-empty">No public fixtures bundled.</div>`;

    const savedBlock = saved.length
      ? saved.map((e) => renderRow(e, 'saved')).join('')
      : `<div class="lib-empty">Nothing pinned locally yet — save a session fixture or import one.</div>`;

    const runtimeBlock = runtime.length
      ? `<h3 class="lib-heading">Defined this session</h3>${runtime.map((e) => renderRow(e, 'session')).join('')}`
      : '';

    bodyEl.innerHTML = `
      <div class="lib-toolbar">
        <button type="button" class="lib-action lib-primary" data-lib-action="import">import from file…</button>
      </div>
      <div class="lib-banner" id="lib-banner"></div>

      <h3 class="lib-heading">Public library</h3>
      <p class="lib-note">Community-contributed, bundled with the app. Use any of these in your code without clicking anything.</p>
      ${publicBlock}

      <h3 class="lib-heading">Your library</h3>
      <p class="lib-note">Pinned to this browser — auto-restored on reload.</p>
      ${savedBlock}

      ${runtimeBlock}
    `;
  }

  function flashBanner(msg: string, kind: 'ok' | 'error' = 'ok'): void {
    const banner = bodyEl.querySelector<HTMLElement>('#lib-banner');
    if (!banner) return;
    banner.textContent = msg;
    banner.className = `lib-banner visible lib-banner-${kind}`;
    setTimeout(() => { banner.className = 'lib-banner'; }, 2400);
  }

  return { refresh };
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
