/**
 * The side panel: one sliding surface with a row of tabs.
 *
 * The reference, the fixture library, the log, the outputs and the settings
 * are all things you look at beside the code, so they share one panel and one
 * top-bar button. The tab strip gives mutual exclusion for free: only one page
 * shows at a time.
 *
 * This module owns the shell: which tab is showing, the tab strip itself, the
 * close button and the Escape key. It owns no content. Each page is an element
 * the caller has already filled, and the modules that fill them do not know
 * they are in a panel. They call `isOpen()` to skip work nobody can see, and
 * listen for PANEL_OPEN_EVENT on their own body to act when they come into
 * view.
 */

/**
 * Dispatched on a page's own element each time that page becomes visible.
 *
 * Bubbles, so a delegated listener higher up hears it too. Watching the
 * shell's `open` class cannot tell pages apart, because the shell is open for
 * every tab.
 */
export const PANEL_OPEN_EVENT = 'gobo:panel-open';

export interface PanelPage {
  /** Stable id, used by open() and toggle(). */
  id: string;
  /** What the tab says. */
  label: string;
  /** The element this page's content has been rendered into. */
  bodyEl: HTMLElement;
  /** Tooltip on the tab, for a label that cannot say the whole thing. */
  title?: string;
}

export interface PanelHost {
  /** Show the panel with `id` selected. Unknown ids are ignored. */
  open(id: string): void;
  /** Hide the panel. The selected tab is remembered for the next open. */
  close(): void;
  /** Open `id`, or close the panel if `id` is already the one showing. */
  toggle(id: string): void;
  /** Whether the panel is open (and, given an id, showing that page). */
  isOpen(id?: string): boolean;
}

export function mountPanel(opts: {
  shellEl: HTMLElement;
  tabsEl: HTMLElement;
  closeEl: HTMLButtonElement;
  toggleEl: HTMLButtonElement;
  pages: PanelPage[];
}): PanelHost {
  const { shellEl, tabsEl, closeEl, toggleEl, pages } = opts;

  // The tab that opens when the button is pressed with no page in mind. It
  // survives a close, so reopening lands on the page you left.
  let current = pages[0]?.id ?? '';
  let open = false;

  const tabs = new Map<string, HTMLButtonElement>();
  for (const page of pages) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'panel-tab';
    tab.textContent = page.label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', page.bodyEl.id);
    if (page.title) tab.title = page.title;
    tab.addEventListener('click', () => show(page.id));
    tabs.set(page.id, tab);
    tabsEl.appendChild(tab);
    page.bodyEl.setAttribute('role', 'tabpanel');
  }

  /** Put `id` on screen, opening the panel if it is not already. */
  function show(id: string): void {
    if (!tabs.has(id)) return;
    current = id;
    open = true;
    render();
    // After render, so a listener that measures or focuses sees the page as
    // it will be shown.
    const page = pages.find((p) => p.id === id);
    page?.bodyEl.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT, { bubbles: true }));
  }

  function render(): void {
    shellEl.classList.toggle('open', open);
    shellEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    toggleEl.classList.toggle('active', open);
    toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    for (const page of pages) {
      const showing = open && page.id === current;
      // `hidden` rather than a class, so a page nobody is looking at is out of
      // the accessibility tree as well as off the screen. The panel holds the
      // whole reference; leaving it readable behind a closed panel would put
      // a few thousand words in front of a screen reader on every page.
      page.bodyEl.hidden = !showing;
      const tab = tabs.get(page.id);
      tab?.classList.toggle('active', showing);
      tab?.setAttribute('aria-selected', showing ? 'true' : 'false');
    }
  }

  const host: PanelHost = {
    open: show,
    close() {
      open = false;
      render();
    },
    toggle(id) {
      if (open && current === id) host.close();
      else show(id);
    },
    isOpen(id) {
      return open && (id === undefined || id === current);
    },
  };

  closeEl.addEventListener('click', () => host.close());
  toggleEl.addEventListener('click', () => {
    if (open) host.close();
    else show(current);
  });

  // Escape closes the panel only when nothing nearer took it: autocomplete,
  // the find bar, the add-to-rig form, a search field or the share dialog
  // each close themselves first, and the panel stays where it was.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    host.close();
  });

  render();
  return host;
}
