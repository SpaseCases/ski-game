import { MAPS, type MapEntry, type MapId } from '../maps/registry.ts';
import { mapArt } from './mapArt.ts';

/**
 * The map-select menu: a card per map, picked with the mouse or with the
 * arrow keys and Enter. Opening it pauses the game behind it; once a map is
 * loaded, the Back button (or Esc, handled by the game) closes it again.
 * Milestone 6 adds the title and pause menus around it.
 */
export class MapSelect {
  private readonly root: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly cards = new Map<MapId, HTMLButtonElement>();
  private current: MapId | null = null;
  private busy = false;

  /** `onPick`: a ready map's card was chosen. `onBack`: closed without picking. */
  constructor(hud: HTMLElement, onPick: (entry: MapEntry) => void, onBack: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'map-select-title');

    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    const head = document.createElement('div');
    head.className = 'menu-head';
    const titles = document.createElement('div');
    titles.innerHTML = '<div class="menu-kicker">Park Laps</div><h1 id="map-select-title" class="menu-title">Choose a map</h1>';
    this.back = document.createElement('button');
    this.back.type = 'button';
    this.back.className = 'hud-button menu-back';
    this.back.innerHTML = 'Back to riding <kbd>Esc</kbd>';
    this.back.addEventListener('click', () => onBack());
    head.append(titles, this.back);

    const grid = document.createElement('div');
    grid.className = 'map-grid';
    for (const entry of MAPS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-card';
      card.dataset.id = entry.id;
      if (!entry.load) card.setAttribute('aria-disabled', 'true');
      card.innerHTML =
        `<span class="map-art">${mapArt(entry.id)}</span>` +
        `<span class="map-text"><span class="map-name">${entry.name}</span>` +
        `<span class="map-blurb">${entry.blurb}</span></span>` +
        `<span class="map-badge">${entry.load ? '' : 'Coming soon'}</span>`;
      card.addEventListener('click', () => {
        if (entry.load && !this.busy) onPick(entry);
      });
      grid.appendChild(card);
      this.cards.set(entry.id, card);
    }

    this.status = document.createElement('div');
    this.status.className = 'menu-foot';
    this.status.setAttribute('aria-live', 'polite');

    panel.append(head, grid, this.status);
    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    hud.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Shows the menu with a card focused: the map being ridden (`current`,
   * which also allows going back to it) or, with none, `suggested`.
   */
  open(current: MapId | null, suggested: MapId): void {
    this.current = current;
    this.busy = false;
    this.back.hidden = current === null;
    for (const [id, card] of this.cards) {
      const badge = card.querySelector('.map-badge');
      if (badge && card.getAttribute('aria-disabled') !== 'true') badge.textContent = id === current ? 'Riding now' : '';
      card.classList.toggle('is-current', id === current);
      card.classList.remove('is-loading');
    }
    this.showHint();
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    this.root.scrollTop = 0;
    (this.cards.get(current ?? suggested) ?? this.cards.values().next().value)?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove('menu-open');
    // Drop focus so Enter or Space can't press a hidden card.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  /** Marks a card as loading (or clears it, with null) and says so under the cards. */
  setLoading(id: MapId | null): void {
    this.busy = id !== null;
    for (const [cid, card] of this.cards) card.classList.toggle('is-loading', cid === id);
    const entry = MAPS.find((m) => m.id === id);
    if (entry) this.status.textContent = `Loading ${entry.name}…`;
    else this.showHint();
  }

  /** Shows a problem under the cards (a map that failed to load). */
  setError(message: string): void {
    this.setLoading(null);
    this.status.textContent = message;
  }

  private showHint(): void {
    this.status.textContent = 'Arrow keys to choose · Enter to ride' + (this.current ? ' · Esc to go back' : '');
  }

  /** True when there's a map to go back to and nothing is loading. */
  get canGoBack(): boolean {
    return this.current !== null && !this.busy;
  }

  /** Arrow keys move between cards; Enter and Space press the focused one (as buttons do). */
  private onKey(e: KeyboardEvent): void {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    const cards = [...this.cards.values()];
    const from = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) {
      cards[0]?.focus();
      return;
    }
    const next = dir[1] === 0 ? cards[from + (dir[0] ?? 0)] : nearestInRow(cards, from, dir[1] ?? 0);
    next?.focus();
  }
}

/** The card in the row above (-1) or below (1) whose middle is closest across to card `from`'s. */
function nearestInRow(cards: readonly HTMLElement[], from: number, dir: number): HTMLElement | undefined {
  const box = (el: HTMLElement): DOMRect => el.getBoundingClientRect();
  const a = box(cards[from]!);
  const ax = a.left + a.width / 2;
  let best: HTMLElement | undefined;
  let bestRow = Infinity;
  let bestX = Infinity;
  for (const c of cards) {
    const b = box(c);
    const rowGap = dir > 0 ? b.top - a.bottom : a.top - b.bottom;
    if (rowGap < -1) continue;
    const dx = Math.abs(b.left + b.width / 2 - ax);
    if (rowGap < bestRow - 1 || (Math.abs(rowGap - bestRow) <= 1 && dx < bestX)) {
      best = c;
      bestRow = rowGap;
      bestX = dx;
    }
  }
  return best;
}
