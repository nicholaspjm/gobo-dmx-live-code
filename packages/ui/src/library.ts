/**
 * Fixture library panel: UI over the core fixture-library storage.
 *
 * Lists every saved fixture with export / delete controls, plus any
 * session-only custom fixtures (declared via `defineFixture` in the
 * user's code but not yet saved) so the user can promote them into
 * persistent storage. Also hosts the "import from file" flow.
 *
 * It sits in a sliding side-panel keyed off a topbar button, mirroring
 * the docs panel.
 *
 * A search field in the toolbar filters every tier at once, ranked by
 * rankFixtures() at the bottom of this file. It shares nothing with the docs
 * panel's search except the look of the input: what a library holds is
 * fixture definitions, and the question asked of it is a different one.
 *
 * Every row carries a tag saying which of the four tiers its fixture came
 * from. The class names are shared with the docs panel and the colours behind
 * them live in index.html; see provenanceTag() below.
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
  isEmitterChannel,
  defineFixtureSource,
  BUILT_IN_FIXTURES,
  type FixtureDef,
} from '@gobo/core';
import { getPublicFixtures } from './public-fixtures.js';

/** Destination of the GitHub "share" flow. Kept here so a repo rename
 *  is a one-line change. */
const PUBLIC_REPO_SLUG = 'nicholaspjm/gobo-dmx-live-code';

/**
 * The four places a fixture on a row can have come from.
 *
 *   builtin  ships in the core, read-only, always there.
 *   public   community-contributed, bundled with the app.
 *   saved    pinned into this browser's storage by the user.
 *   session  declared with defineFixture() in the running scene, not saved.
 */
export type RowTier = 'builtin' | 'public' | 'saved' | 'session';

/** What the tag on a row says for each tier. Saved fixtures say "yours"
 *  because the question a row answers is whose fixture this is, not what
 *  happened to it. */
const TIER_LABEL: Record<RowTier, string> = {
  builtin: 'built-in',
  public: 'public',
  saved: 'yours',
  session: 'session',
};

/**
 * The provenance tag for one row.
 *
 * The class names are a contract shared with the docs panel, which tags
 * the fixtures it documents the same way. The colours behind them are
 * defined once in index.html rather than per panel, so the two cannot
 * drift into two colour codes for one set of words.
 *
 * The label is always written out. The colour says the same thing a
 * second way, so a reader who cannot separate the hues loses nothing, and
 * neither does anyone on the monochrome themes, which have no four hues
 * to give.
 */
export function provenanceTag(tier: RowTier): string {
  return `<span class="fx-tag fx-tag-${tier}">${TIER_LABEL[tier]}</span>`;
}

/** Mount the library panel inside the page. The caller owns the toggle
 *  button's visibility; this only wires its click handler. The optional
 *  `onOpen` callback fires when the panel becomes visible, letting the
 *  host close other sliding panels for mutual exclusion. */
export function mountLibraryPanel(opts: {
  panelEl: HTMLElement;
  bodyEl: HTMLElement;
  toggleEl: HTMLButtonElement;
  closeEl: HTMLButtonElement;
  onOpen?: () => void;
}): { refresh: () => void; setOpen: (open: boolean) => void; isOpen: () => boolean } {
  const { panelEl, bodyEl, toggleEl, closeEl, onOpen } = opts;

  // The panel's fixed furniture: the toolbar (import button and search
  // field), the banner, and the container everything else renders into.
  // Built once, not as part of refresh(), because a redraw mid-search would
  // take the field, its text and the caret with it. It also means a banner
  // survives the refresh that follows the action it is reporting on.
  //
  // The field is styled by the docs panel's own .doc-search rules: this
  // panel is a .docs-panel instance and already borrows its chrome, so the
  // search looks like the one people have used. Three properties are set
  // here because that bar is a sticky full-width row of its own and this one
  // shares the toolbar. Nothing but the appearance is shared; the ranking
  // lives at the bottom of this file.
  bodyEl.innerHTML = `
    <div class="lib-toolbar">
      <button type="button" class="lib-action lib-primary" data-lib-action="import">import from file…</button>
      <div class="doc-search" style="flex: 1; padding: 0; position: static">
        <input type="text" id="lib-search-input" placeholder="search fixtures…" autocomplete="off" spellcheck="false" />
        <button type="button" id="lib-search-clear" class="doc-search-clear" title="clear" aria-label="clear search">×</button>
      </div>
    </div>
    <div class="lib-banner" id="lib-banner"></div>
    <div id="lib-list"></div>`;

  const searchEl = bodyEl.querySelector<HTMLInputElement>('#lib-search-input')!;
  const searchClearEl = bodyEl.querySelector<HTMLButtonElement>('#lib-search-clear')!;
  const bannerEl = bodyEl.querySelector<HTMLElement>('#lib-banner')!;
  const listEl = bodyEl.querySelector<HTMLElement>('#lib-list')!;

  searchEl.addEventListener('input', () => {
    searchClearEl.classList.toggle('visible', searchEl.value.trim() !== '');
    refresh();
  });
  searchClearEl.addEventListener('click', () => {
    searchEl.value = '';
    searchClearEl.classList.remove('visible');
    refresh();
    searchEl.focus();
  });

  function setOpen(open: boolean): void {
    panelEl.classList.toggle('open', open);
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleEl.classList.toggle('active', open);
    if (open) {
      refresh();
      onOpen?.();
      // Straight into the search, the way the docs panel does it: the panel
      // is usually opened to find one fixture. Deferred so the slide-in
      // doesn't fight the focus. Any previous query is left selected, so
      // typing replaces it and Backspace still gets you the whole list.
      setTimeout(() => {
        searchEl.focus();
        searchEl.select();
      }, 50);
    }
  }
  function isOpen(): boolean { return panelEl.classList.contains('open'); }

  toggleEl.addEventListener('click', () => setOpen(!isOpen()));
  closeEl.addEventListener('click', () => setOpen(false));
  // Escape closes, same as docs panel.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) setOpen(false);
  });

  // Body-level click delegation. Buttons are rebuilt on every refresh, so
  // the action is read off the clicked element's data attributes.
  bodyEl.addEventListener('click', (ev) => {
    // The template's copy button, which is not a lib-action: it touches no
    // library state, it just puts the code on the clipboard to paste into a
    // scene. Says "copied" on itself, the way the share button does, because
    // a clipboard write is otherwise invisible.
    const copyBtn = (ev.target as HTMLElement).closest<HTMLElement>('[data-copy-id]');
    if (copyBtn) {
      const code = copyBtn.parentElement?.querySelector('.lib-row-template-code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(
        () => {
          copyBtn.textContent = 'copied';
          setTimeout(() => { copyBtn.textContent = 'copy'; }, 1600);
        },
        () => { copyBtn.textContent = 'clipboard blocked'; },
      );
      return;
    }
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
    a.download = `${id}.gobo-fixture.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer the revoke so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Open a GitHub pre-filled new-file page so the user can propose this
   * fixture as a PR to the public library. GitHub's web UI accepts
   * `filename` and `value` query params on /new routes, which lands the
   * user on a "create new file in fork" page with everything filled in.
   * They click "propose change" and the PR is open.
   */
  function handleShare(id: string): void {
    const def = findDef(id);
    if (!def) return;
    const body = toExportString(id, def);

    const confirmed = confirm(
      `Propose "${id}" for the public library?\n\n` +
      `A new tab will open on GitHub with the fixture pre-filled into fixtures/${id}.json. ` +
      `You'll click "Propose change"; GitHub forks the repo for you and opens a pull request. ` +
      `Once reviewed and merged, the fixture ships to everyone using gobo.`,
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

  /** `match` is set only in the search view, where it names the field the
   *  query landed on. */
  function renderRow(
    entry: { id: string; def: FixtureDef },
    tier: RowTier,
    match?: MatchField,
  ): string {
    const idAttr = escapeAttr(entry.id);
    // Action buttons differ per tier:
    //   builtin  shipped with the core, always present, view-only.
    //   public   community-contributed, already usable in code, can export.
    //   saved    user-pinned locally, can export / share / delete.
    //   session  defined in current code but not yet pinned, can save /
    //            export / share.
    let actions = '';
    if (tier === 'builtin') {
      // No actions. Built-ins are part of the core and can't be edited or
      // removed. Listed so users can see what's available.
      actions = '';
    } else if (tier === 'public') {
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
    const extraClass =
      tier === 'session' ? ' lib-row-unsaved' :
      tier === 'builtin' ? ' lib-row-builtin' : '';
    // Every row says where its fixture came from. The grouped view has a
    // heading over each block, but a heading scrolls away and a search
    // result is out of its block entirely, so provenance belongs on the
    // row rather than on the list around it.
    //
    // A search result adds a second tag for the field the query landed on.
    // Without it a fixture found by a sentence about one of its channels
    // reads as a mistake, since nothing visible on the row says the word.
    // That one is the plain pill: it is not provenance, and it should not
    // read as a fifth tier.
    const tags =
      ` ${provenanceTag(tier)}` +
      (match ? ` <span class="fx-tag">${MATCH_LABEL[match]}</span>` : '');
    return `
      <div class="lib-row${extraClass}">
        <div class="lib-row-meta">
          <div class="lib-row-title">
            <span class="lib-row-id">${escapeText(entry.id)}</span>
            <span class="lib-row-name">${escapeText(entry.def.name)}</span>${tags}
          </div>
          <div class="lib-row-sub">${escapeText(channelSummary(entry.def))} · ${escapeText(channelNamesSummary(entry.def))}</div>
          <pre class="lib-row-usage">${escapeText(usageExample(entry.id, entry.def))}</pre>
          <details class="lib-row-template">
            <summary class="lib-row-template-summary">the code that makes it</summary>
            <pre class="lib-row-template-code">${escapeText(defineFixtureSource(entry.id, entry.def))}</pre>
            <button type="button" class="scene-action lib-template-copy" data-copy-id="${escapeText(entry.id)}">copy</button>
          </details>
        </div>
        <div class="lib-row-actions">${actions}</div>
      </div>`;
  }

  /** Comma-joined channel names, so users can see which setters and
   *  generics will be available on a fixture instance. */
  function channelNamesSummary(def: FixtureDef): string {
    return def.channels.map((c) => c.name).join(', ');
  }

  /**
   * A worked example of patching and driving this fixture.
   *
   * The list used to say what a fixture HAS without ever saying how to reach
   * it, so the next step was to guess a name or go and read the docs for
   * something already on screen. Written out with the real id and a real
   * channel from this def, so it can be copied straight into a scene.
   *
   * The channel chosen to demonstrate is the first one that emits light,
   * because driving a pan or a gobo wheel proves nothing about whether the
   * patch is right.
   */
  function usageExample(id: string, def: FixtureDef): string {
    const lines = [`const light = fixture(1, '${id}')`];

    const strip = def.channels.find((c) => c.type === 'strip');
    const emitter = def.channels.find((c) => c.type !== 'strip' && isEmitterChannel(c));

    if (emitter) {
      lines.push(`light.${emitter.name}(sine().slow(4))`);
    }
    if (strip) {
      const args = strip.pixelLayout === 'rgbw' ? '1, 0, 0, 0'
        : strip.pixelLayout === 'mono' ? '1'
        : '1, 0, 0';
      lines.push(`light.${strip.name}.fill(${args})`);
      lines.push(`light.${strip.name}.each(p => sine().early(p).slow(2))`);
    }
    // A slotted channel is the one thing here that reads nothing like the
    // rest, so it is worth showing even on a fixture that already has an
    // emitter to demonstrate.
    const slotted = def.channels.find((c) => c.slots !== undefined && c.slots.length > 0);
    if (slotted) {
      lines.push(`light.${slotted.name}('${slotted.slots?.[0]?.name ?? 'open'}')`);
    }
    if (lines.length === 1) {
      // Nothing that emits and no strip: a control-only fixture, so show the
      // generic escape hatch rather than inventing a setter.
      lines.push(`light.set('${def.channels[0]?.name ?? 'dim'}', 0.5)`);
    }
    return lines.join('\n');
  }

  function refresh(): void {
    const publicFixtures = getPublicFixtures();
    const saved = getLibraryFixtures();
    // Built-ins straight from the core registry. Session entries that
    // shadow a built-in (defineFixture('rgbw', …)) are filtered out here
    // and surface in the session block instead.
    const builtIns = Object.entries(BUILT_IN_FIXTURES)
      .map(([id, def]) => ({ id, def }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const runtime = Object.entries(getCustomFixtures())
      .map(([id, def]) => ({ id, def }))
      // Session entries already in the library or in the public bundle
      // would show up twice, so drop them here.
      .filter((e) =>
        !isInLibrary(e.id) &&
        !publicFixtures.some((p) => p.id === e.id) &&
        !(e.id in BUILT_IN_FIXTURES),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    // One flat list of everything on show, tagged with the block it belongs
    // to. The search runs over this, so a query reaches all four tiers at
    // once: at a gig you want the fixture, not the tier it happens to be in.
    const all: Array<{ id: string; def: FixtureDef; tier: RowTier }> = [
      ...builtIns.map((e) => ({ ...e, tier: 'builtin' as const })),
      ...publicFixtures.map((e) => ({ ...e, tier: 'public' as const })),
      ...saved.map((e) => ({ ...e, tier: 'saved' as const })),
      ...runtime.map((e) => ({ ...e, tier: 'session' as const })),
    ];

    const query = searchEl.value;
    if (query.trim() !== '') {
      listEl.innerHTML = renderSearchResults(all, query);
      return;
    }

    const builtInBlock = builtIns.map((e) => renderRow(e, 'builtin')).join('');

    const publicBlock = publicFixtures.length
      ? publicFixtures.map((e) => renderRow(e, 'public')).join('')
      : `<div class="lib-empty">No public fixtures bundled.</div>`;

    const savedBlock = saved.length
      ? saved.map((e) => renderRow(e, 'saved')).join('')
      : `<div class="lib-empty">Nothing pinned locally yet. Save a session fixture or import one.</div>`;

    const runtimeBlock = runtime.length
      ? `<h3 class="lib-heading">Defined this session</h3>${runtime.map((e) => renderRow(e, 'session')).join('')}`
      : '';

    listEl.innerHTML = `
      <h3 class="lib-heading">Built-in</h3>
      <p class="lib-note">Shipped with gobo. Every fixture also has the generic helpers <code>.color(r,g,b[,w])</code>, <code>.off()</code>, <code>.full()</code> on top of its named channel setters.</p>
      ${builtInBlock}

      <h3 class="lib-heading">Public library</h3>
      <p class="lib-note">Community-contributed, bundled with the app. Use any of these in your code without clicking anything.</p>
      ${publicBlock}

      <h3 class="lib-heading">Your library</h3>
      <p class="lib-note">Pinned to this browser. Restored on reload.</p>
      ${savedBlock}

      ${runtimeBlock}
    `;
  }

  /** The search view: one ranked list across every tier, in place of the
   *  four blocks. */
  function renderSearchResults(
    rows: Array<{ id: string; def: FixtureDef; tier: RowTier }>,
    query: string,
  ): string {
    const hits = rankFixtures(rows, query);
    if (hits.length === 0) {
      return `<div class="lib-empty">Nothing matches "${escapeText(query.trim())}". Try a manufacturer, a channel count, or part of the name.</div>`;
    }
    const heading = `<h3 class="lib-heading">${hits.length} ${hits.length === 1 ? 'match' : 'matches'}</h3>`;
    return heading + hits.map((h) => renderRow(h.entry, h.entry.tier, h.where)).join('');
  }

  let bannerTimer: ReturnType<typeof setTimeout> | undefined;

  function flashBanner(msg: string, kind: 'ok' | 'error' = 'ok'): void {
    bannerEl.textContent = msg;
    bannerEl.className = `lib-banner visible lib-banner-${kind}`;
    // One timer, restarted: two messages in quick succession used to leave
    // the first one's timeout to hide the second early.
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { bannerEl.className = 'lib-banner'; }, 2400);
  }

  return { refresh, setOpen, isOpen };
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

// ─── Searching the library ───────────────────────────────────────────────────
//
// The docs panel searches too, and this is deliberately not that search. There
// the thing being looked for is a name half-remembered from a scene, ranked
// over the prose written about an API. Here it is a fixture definition, and
// the person asking has the light in front of them: they know the make on the
// badge, or the channel count the desk is asking for, or roughly what the
// thing is called.
//
// So the order is what a fixture IS before what is written about it. Identity
// first (id, name, make), then what it amounts to (its type, its channel
// layout, the colour mix its channels add up to), then its channel names, and
// only last the sentences describing individual channels. A fixture whose name
// carries the word beats one that merely mentions it three levels down.
//
// A number is read as a channel count before it is read as text, because
// "8" typed into a fixture library means an 8-channel fixture far more often
// than it means anything else.

/**
 * Where a query term landed. Carried on every hit so a result row can say why
 * it is in the list: a fixture matched by a sentence about one of its channels
 * reads as a mistake until the row admits that is what happened.
 */
export type MatchField =
  | 'id'
  | 'name'
  | 'manufacturer'
  | 'channelCount'
  | 'pixelCount'
  | 'tag'
  | 'channel'
  | 'description';

/** What the tag on a result row says for each field. */
const MATCH_LABEL: Record<MatchField, string> = {
  id: 'id',
  name: 'name',
  manufacturer: 'make',
  channelCount: 'channels',
  pixelCount: 'pixels',
  tag: 'type',
  channel: 'channel',
  description: 'channel notes',
};

/** A ranked entry: whatever the caller passed in, its total score, and the
 *  strongest single place a term landed. */
export interface FixtureMatch<T> {
  entry: T;
  score: number;
  where: MatchField;
}

/** One term's best landing place in one fixture. */
interface TermHit {
  score: number;
  where: MatchField;
}

/** A fixture flattened into everything the search looks at. Rebuilt per
 *  query: the library is a few dozen entries, so there is nothing to cache
 *  and a cache would only go stale as fixtures are saved and deleted. */
interface SearchText {
  id: string;
  idWords: string[];
  name: string;
  nameWords: string[];
  manufacturer: string;
  /** What the fixture amounts to, in words someone might type: its declared
   *  type, the types of its channels, the layout of any pixel strip, and the
   *  colour mix its channels add up to. Folded, so 'moving-head' is reached
   *  by typing it with the hyphen or without. */
  tags: string[];
  channelCount: number;
  /** Pixel counts of any strip channels, so "8" finds an 8-pixel bar. */
  pixelCounts: number[];
  channelNames: string[];
  /** Every channel description, joined. Searched last. */
  notes: string;
}

function lower(s: string | undefined): string {
  return (s ?? '').toLowerCase();
}

/**
 * Lowercase, and drop everything that is not a letter or a digit. Spaces,
 * hyphens and underscores are noise in a fixture id: "moving head",
 * "moving-head" and "movinghead" are one thing typed three ways. The core
 * folds slot names the same way for the same reason.
 */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The words of a string, any of which someone might type on its own:
 *  "Moving Head Wash (14ch, 16-bit)" gives moving, head, wash, 14ch, 16, bit. */
function searchWords(s: string | undefined): string[] {
  return (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The colour mix a def adds up to, spelled the way a person says it: a def
 * with red, green, blue and white channels is an rgbw fixture whether or not
 * anything in it says so. Worth deriving, because "rgbw" is exactly what gets
 * typed when that is the light in front of you, and plenty of fixtures are
 * named after the product rather than the mix. Returns null unless all three
 * primaries are there, since two of them are not a mix anyone asks for.
 */
const MIX_ROLES: Array<[role: string, letter: string]> = [
  ['red', 'r'], ['green', 'g'], ['blue', 'b'],
  ['white', 'w'], ['amber', 'a'], ['uv', 'uv'],
];

function mixTag(channelNames: ReadonlySet<string>): string | null {
  if (!channelNames.has('red') || !channelNames.has('green') || !channelNames.has('blue')) {
    return null;
  }
  return MIX_ROLES
    .filter(([role]) => channelNames.has(role))
    .map(([, letter]) => letter)
    .join('');
}

/** A def reaching here can come from `defineFixture` in a user's scene, so a
 *  field the type says is there may not be. Missing ones are skipped rather
 *  than throwing: a half-written fixture should still be findable. */
function searchTextFor(id: string, def: FixtureDef): SearchText {
  const channelNames = def.channels.map((c) => fold(c.name));
  const tags = new Set<string>();
  const pixelCounts: number[] = [];
  if (def.type) tags.add(fold(def.type));
  for (const c of def.channels) {
    if (c.type) tags.add(fold(c.type));
    if (c.type === 'strip') {
      if (c.pixelCount !== undefined) pixelCounts.push(c.pixelCount);
      tags.add(fold(c.pixelLayout ?? 'rgb'));
    }
  }
  const mix = mixTag(new Set(channelNames));
  if (mix) tags.add(mix);

  return {
    id: id.toLowerCase(),
    idWords: searchWords(id),
    name: lower(def.name),
    nameWords: searchWords(def.name),
    manufacturer: lower(def.manufacturer),
    tags: [...tags],
    channelCount: def.channelCount,
    pixelCounts,
    channelNames,
    notes: def.channels.map((c) => c.description ?? '').join(' ').toLowerCase(),
  };
}

/** Endings a word in the text may carry and still be the word that was typed,
 *  so "pixel" finds a sentence about pixels. The empty string first, because
 *  the word standing on its own is the ordinary case. */
const SUFFIXES = ['', 's', 'es', 'ed', 'ing'];

/** charAt off the end of a string is '', which is not a word character, so
 *  the start and end of the text count as boundaries without a special case. */
function isWordChar(c: string): boolean {
  return c !== '' && /[a-z0-9]/.test(c);
}

/**
 * Where `term` appears in `text` as a whole word, or -1.
 *
 * Whole words only: plain containment made "red" match "required" and "off"
 * match "offset", which in a panel of channel descriptions is most of the
 * library. Done by hand rather than with a regex because a query is typed,
 * not authored, and "c++" must not compile as a quantifier.
 */
function wordIndex(text: string, term: string): number {
  let at = text.indexOf(term);
  while (at >= 0) {
    if (!isWordChar(text.charAt(at - 1))) {
      for (const suffix of SUFFIXES) {
        const end = at + term.length + suffix.length;
        if (text.slice(at + term.length, end) !== suffix) continue;
        if (!isWordChar(text.charAt(end))) return at;
      }
    }
    at = text.indexOf(term, at + 1);
  }
  return -1;
}

/** A number, optionally carrying the unit someone would say out loud: "8",
 *  "14ch", "12channels", "48px". */
const NUMBER_TERM = /^(\d+)(chs?|chans?|channels?|px|pixels?)?$/;

/** The same units written as a word of their own, so "12 channels" is one
 *  question rather than two. Only ever joined onto a bare number: on its own,
 *  "pixels" is a channel someone is looking for. */
const UNIT_WORDS = new Set([
  'ch', 'chs', 'chan', 'chans', 'channel', 'channels', 'px', 'pixel', 'pixels',
]);

/**
 * A numeric term against the counts a fixture actually has. Returns null for
 * anything that is not a number, and for a number this fixture does not
 * carry, leaving the text ladder to have its go: "154" still finds
 * atomic-strobe-154ch by its id.
 */
function scoreNumber(term: string, t: SearchText): TermHit | null {
  const m = NUMBER_TERM.exec(term);
  if (!m) return null;
  const n = Number(m[1]);
  const saidPixels = (m[2] ?? '').startsWith('p');
  if (!saidPixels && t.channelCount === n) return { score: 9_800, where: 'channelCount' };
  if (t.pixelCounts.includes(n)) {
    // Unprompted, a pixel count is the weaker reading of a bare number; asked
    // for by name, it is the whole question.
    return { score: saidPixels ? 9_800 : 5_600, where: 'pixelCount' };
  }
  return null;
}

/**
 * One term against everything textual, best landing first.
 *
 * The ladder is ordered, so the first hit is the best one: an id someone
 * typed in full beats a word inside a name, which beats a channel called
 * that, which beats a sentence mentioning it.
 */
function scoreText(term: string, t: SearchText): TermHit | null {
  const f = fold(term);
  if (f === '') return null;

  const id = fold(t.id);
  const name = fold(t.name);
  const make = fold(t.manufacturer);

  if (id === f) return { score: 10_000, where: 'id' };
  if (name === f) return { score: 9_600, where: 'name' };
  if (make === f) return { score: 9_200, where: 'manufacturer' };

  if (t.idWords.includes(term)) return { score: 8_400, where: 'id' };
  if (t.nameWords.includes(term)) return { score: 8_200, where: 'name' };

  // Shorter is a closer match: "rgb" typed against `rgba` and a 14-channel
  // `rgbw-moving-head` means the first one.
  if (id.startsWith(f)) return { score: 7_400 - id.length, where: 'id' };
  if (name.startsWith(f)) return { score: 7_000 - name.length, where: 'name' };
  if (t.idWords.some((w) => w.startsWith(term))) return { score: 6_600, where: 'id' };
  if (t.nameWords.some((w) => w.startsWith(term))) return { score: 6_200, where: 'name' };
  if (make.startsWith(f)) return { score: 5_800, where: 'manufacturer' };

  if (id.includes(f)) return { score: 5_400, where: 'id' };
  if (name.includes(f)) return { score: 5_000, where: 'name' };
  if (make.includes(f)) return { score: 4_600, where: 'manufacturer' };

  if (t.tags.includes(f)) return { score: 4_200, where: 'tag' };
  if (t.tags.some((tag) => tag.startsWith(f))) return { score: 3_800, where: 'tag' };

  if (t.channelNames.includes(f)) return { score: 3_400, where: 'channel' };
  if (t.channelNames.some((n) => n.startsWith(f))) return { score: 3_000, where: 'channel' };
  if (t.channelNames.some((n) => n.includes(f))) return { score: 2_600, where: 'channel' };

  // Last resort: the fixture is not called this, it just says it somewhere.
  // Earlier in the sentence scores higher, which is a weak signal, but the
  // whole tier sits below everything above it either way.
  const at = wordIndex(t.notes, term);
  if (at >= 0) return { score: 1_000 - Math.min(at, 900), where: 'description' };

  return null;
}

function scoreTerm(term: string, t: SearchText): TermHit | null {
  const byNumber = scoreNumber(term, t);
  const byText = scoreText(term, t);
  if (!byNumber) return byText;
  if (!byText) return byNumber;
  return byNumber.score >= byText.score ? byNumber : byText;
}

/** Split a typed query into terms, dropping punctuation people type around
 *  them: "(14ch)" is 14ch, "rgbw," is rgbw. */
function queryTerms(query: string): string[] {
  const parts = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, ''))
    .filter(Boolean);

  const terms: string[] = [];
  for (const part of parts) {
    const prev = terms[terms.length - 1];
    if (prev !== undefined && /^\d+$/.test(prev) && UNIT_WORDS.has(part)) {
      terms[terms.length - 1] = prev + part;
      continue;
    }
    terms.push(part);
  }
  return terms;
}

/**
 * Rank fixture entries against a typed query, best first.
 *
 * Terms are ANDed: every word has to land somewhere, so "chauvet 8" is the
 * 8-channel Chauvet rather than everything Chauvet plus everything 8-channel.
 * The score is the sum across terms, and `where` names the strongest single
 * landing, which is what the row shows.
 *
 * Ties break on id so the list is stable while typing: a result that has not
 * changed rank must not jump.
 *
 * A blank query ranks nothing at all. The panel shows its normal grouped list
 * in that case, rather than a flat one in some arbitrary order.
 */
export function rankFixtures<T extends { id: string; def: FixtureDef }>(
  entries: readonly T[],
  query: string,
): Array<FixtureMatch<T>> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const out: Array<FixtureMatch<T>> = [];
  for (const entry of entries) {
    const text = searchTextFor(entry.id, entry.def);
    let total = 0;
    let best: TermHit | null = null;
    let all = true;
    for (const term of terms) {
      const hit = scoreTerm(term, text);
      if (!hit) { all = false; break; }
      total += hit.score;
      if (!best || hit.score > best.score) best = hit;
    }
    if (!all || !best) continue;
    out.push({ entry, score: total, where: best.where });
  }
  out.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return out;
}
