import { ApiError } from '../online/api.ts';
import { lookSvg } from '../online/look.ts';
import { browse, countUse, hiddenItems, remove, report, type HiddenItem, type MarketItem, type MarketSort } from '../online/market.ts';
import { searchWord, type MarketKind } from '../online/marketRules.ts';

// The Locker's Market tab (milestone 24), part of the lazy online chunk:
// main mounts it into the tab's panel the first time the tab opens. Filter
// by kind, newest or most used, search (a word's start, in titles and board
// names), a page of cards at a time with More; each card's thumbnail comes
// from main (MarketHooks.thumb: the game's own painters), Use copies the
// item into a free slot on this computer and wears it (main does that too),
// Report asks twice. With the dev unlock a Hidden filter lists what reports
// hid, and every card can be removed for good. Offline it says so; the
// Locker and the game carry on.

export interface MarketHooks {
  /** A ski, board or garment item's thumbnail: the skis or board painted, the garment's squares (an outfit's tiny skier is drawn here). */
  thumb: (item: MarketItem) => HTMLElement;
  /** What it is, for its card: "Park skis", "Freeride board", "Jacket", "Outfit". */
  describe: (item: MarketItem) => string;
  /**
   * Copies the item into a free slot on this computer and wears it; when a
   * kind's slots are all painted, `pick` asks which to paint over. Answers
   * what it did (shown under the cards), or null when cancelled.
   */
  use: (item: MarketItem, pick: SlotPick) => Promise<string | null>;
  /** The outfit worn now, to share (opens the share sign). */
  shareOutfit: () => void;
  /** The developer's code when this computer has the dev unlock, else ''. */
  devCode: () => string;
}

/** Asks which of a full kind's slots to paint over (`what`: "Park ski", thumbnails of its slots): its index, or null. */
export type SlotPick = (what: string, thumbs: HTMLElement[]) => Promise<number | null>;

export const MARKET_OFFLINE_TEXT = 'Marketplace offline. Your designs still save on this computer.';
const SEARCH_DELAY_MS = 350;
/** A list shown this recently isn't fetched again when the tab comes back. */
const FRESH_MS = 60000;
const KINDS: readonly (readonly [MarketKind | 'all', string])[] = [
  ['all', 'All'],
  ['outfit', 'Outfits'],
  ['jacket', 'Jackets'],
  ['pants', 'Pants'],
  ['skis', 'Skis'],
  ['board', 'Boards'],
];

export class MarketPanel {
  readonly el: HTMLElement;
  private readonly hooks: MarketHooks;
  private readonly pick: SlotPick;
  private readonly kindButtons = new Map<MarketKind | 'all' | 'hidden', HTMLButtonElement>();
  private readonly sortButtons: HTMLButtonElement[] = [];
  private readonly sortRow: HTMLElement;
  /** Top sheets or bases on the ski and board cards (2026-11-24, the user's ask to see ski bottoms), as in the Locker's rack. */
  private readonly faceRow: HTMLElement;
  private readonly faceButtons: HTMLButtonElement[] = [];
  private bases = false;
  private readonly find: HTMLInputElement;
  private readonly grid: HTMLElement;
  private readonly status: HTMLElement;
  private readonly more: HTMLButtonElement;
  private kind: MarketKind | 'all' | 'hidden' = 'all';
  private sort: MarketSort = 'new';
  private next: string | null = null;
  /** Bumped by every load, so an answer for a list no longer shown is dropped. */
  private token = 0;
  private searchTimer = 0;
  private mounted: HTMLElement | null = null;
  /** When the list shown was fetched (performance.now()), and with which dev code ('' for none). */
  private loadedAt = -Infinity;
  private loadedCode = '';

  constructor(hooks: MarketHooks, pick: SlotPick) {
    this.hooks = hooks;
    this.pick = pick;
    this.el = document.createElement('div');
    this.el.className = 'market';

    const kinds = document.createElement('div');
    kinds.className = 'segmented mk-kinds';
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Show');
    for (const [id, label] of [...KINDS, ['hidden', 'Hidden'] as const]) {
      const b = segment(label, () => this.setKind(id));
      kinds.appendChild(b);
      this.kindButtons.set(id, b);
    }

    this.sortRow = document.createElement('div');
    this.sortRow.className = 'mk-sortrow';
    const sorts = document.createElement('div');
    sorts.className = 'segmented mk-sorts';
    sorts.setAttribute('role', 'group');
    sorts.setAttribute('aria-label', 'Order');
    for (const [id, label] of [
      ['new', 'Newest'],
      ['used', 'Most used'],
    ] as const) {
      const b = segment(label, () => this.setSort(id));
      sorts.appendChild(b);
      this.sortButtons.push(b);
    }
    this.find = document.createElement('input');
    this.find.type = 'text';
    this.find.className = 'text-box mk-find';
    this.find.maxLength = 24;
    this.find.autocomplete = 'off';
    this.find.spellcheck = false;
    this.find.placeholder = 'Search titles and names';
    this.find.setAttribute('aria-label', 'Search titles and names');
    this.find.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.load(false), SEARCH_DELAY_MS);
    });
    this.faceRow = document.createElement('div');
    this.faceRow.className = 'segmented mk-faces-pick';
    this.faceRow.setAttribute('role', 'group');
    this.faceRow.setAttribute('aria-label', 'Skis and boards show');
    for (const [base, label] of [
      [false, 'Top'],
      [true, 'Base'],
    ] as const) {
      const b = segment(label, () => this.setBases(base));
      b.setAttribute('aria-pressed', String(base === this.bases));
      this.faceRow.appendChild(b);
      this.faceButtons.push(b);
    }
    this.sortRow.append(sorts, this.faceRow, this.find);

    this.grid = document.createElement('div');
    this.grid.className = 'mk-grid';
    this.status = document.createElement('p');
    this.status.className = 'mk-status';
    this.status.setAttribute('aria-live', 'polite');
    this.more = document.createElement('button');
    this.more.type = 'button';
    this.more.className = 'ski-edit mk-more';
    this.more.textContent = 'More';
    this.more.addEventListener('click', () => void this.load(true));

    const shareRow = document.createElement('div');
    shareRow.className = 'mk-share-row';
    const shareOutfit = document.createElement('button');
    shareOutfit.type = 'button';
    shareOutfit.className = 'ski-edit mk-share-outfit';
    shareOutfit.textContent = 'Share my outfit';
    shareOutfit.addEventListener('click', () => this.hooks.shareOutfit());
    const shareNote = document.createElement('p');
    shareNote.className = 'setting-note';
    shareNote.textContent = 'Share a painted ski, board, jacket or pants with Share beside its Edit, or from its editor.';
    shareRow.append(shareOutfit, shareNote);

    this.el.append(kinds, this.sortRow, this.grid, this.more, this.status, shareRow);
  }

  /**
   * Shows the panel in `host` (the Locker's Market tab) and fetches the list
   * shown, unless it's fresh: coming back from the Share sign or the slot
   * picker keeps the cards (and what Use said under them). A change of the
   * dev unlock fetches it again (Remove and Hidden come or go).
   */
  mount(host: HTMLElement): void {
    if (this.mounted !== host) {
      host.replaceChildren(this.el);
      this.mounted = host;
      this.loadedAt = -Infinity;
    }
    if (performance.now() - this.loadedAt > FRESH_MS || this.hooks.devCode() !== this.loadedCode) void this.load(false);
  }

  /** The Market tab closed or the Locker left: drop answers still coming. */
  unmount(): void {
    if (this.grid.classList.contains('is-loading')) this.loadedAt = -Infinity;
    clearTimeout(this.searchTimer);
    this.token++;
  }

  private setKind(kind: MarketKind | 'all' | 'hidden'): void {
    this.kind = kind;
    void this.load(false);
  }

  /** Shows the bases of the ski and board cards (or their top sheets): both are drawn, the grid's class picks. */
  private setBases(bases: boolean): void {
    this.bases = bases;
    this.grid.classList.toggle('mk-bases', bases);
    this.faceButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 1) === bases)));
  }

  private setSort(sort: MarketSort): void {
    this.sort = sort;
    void this.load(false);
  }

  /** Fetches the first page of what's picked (or, `more`, the next page under it). */
  private async load(more: boolean): Promise<void> {
    clearTimeout(this.searchTimer);
    const code = this.hooks.devCode();
    this.loadedCode = code;
    if (this.kind === 'hidden' && !code) this.kind = 'all';
    for (const [id, b] of this.kindButtons) {
      b.setAttribute('aria-pressed', String(id === this.kind));
      if (id === 'hidden') b.hidden = !code;
    }
    const text = this.find.value.trim();
    const word = searchWord(text);
    const hidden = this.kind === 'hidden';
    // A search lists the newest first; the hidden list has no order to pick.
    this.sortButtons.forEach((b, i) => {
      b.setAttribute('aria-pressed', String((i === 1) === (this.sort === 'used') && !word));
      b.disabled = word !== '' || hidden;
    });
    this.find.disabled = hidden;
    // Top or base only matters where skis or boards show.
    this.faceRow.hidden = this.kind !== 'all' && this.kind !== 'skis' && this.kind !== 'board' && this.kind !== 'hidden';
    const token = ++this.token;
    if (!more) this.next = null;
    this.more.hidden = true;
    this.status.textContent = 'Loading…';
    this.grid.classList.add('is-loading');
    try {
      let items: MarketItem[];
      if (hidden) {
        items = await hiddenItems(code);
        this.next = null;
      } else {
        const page = await browse(this.kind as MarketKind | 'all', this.sort, word, more ? this.next : null);
        items = page.items;
        this.next = page.next;
      }
      if (token !== this.token) return;
      this.loadedAt = performance.now();
      const cards = items.map((it) => this.card(it, hidden));
      if (more) this.grid.append(...cards);
      else this.grid.replaceChildren(...cards);
      this.more.hidden = this.next === null;
      const none = this.grid.childElementCount === 0;
      this.status.textContent = !none ? '' : hidden ? 'Nothing is hidden.' : text && !word ? 'Type at least two letters to search.' : word ? `Nothing found for “${word}”.` : 'Nothing shared here yet: be the first.';
    } catch (err) {
      if (token !== this.token) return;
      if (!more) this.grid.replaceChildren();
      this.status.textContent = err instanceof ApiError && err.status === 403 ? 'The Worker refused the dev code.' : MARKET_OFFLINE_TEXT;
    } finally {
      if (token === this.token) this.grid.classList.remove('is-loading');
    }
  }

  private card(it: MarketItem, hidden: boolean): HTMLElement {
    const card = document.createElement('article');
    card.className = 'mk-card';
    const thumb = document.createElement('div');
    thumb.className = `mk-thumb mk-thumb-${it.kind}`;
    thumb.appendChild(it.kind === 'outfit' ? outfitThumb(it.look) : this.hooks.thumb(it));
    const title = document.createElement('h3');
    title.className = 'mk-title';
    title.textContent = it.title;
    const by = document.createElement('p');
    by.className = 'mk-by';
    by.textContent = `${this.hooks.describe(it)} · by ${it.name}`;
    const uses = document.createElement('p');
    uses.className = 'mk-uses';
    const showUses = (n: number): void => {
      uses.textContent = hidden ? `${(it as HiddenItem).reports} reports · hidden ${daysAgo((it as HiddenItem).hiddenAt)}` : n === 1 ? '1 use' : `${n.toLocaleString('en-US')} uses`;
    };
    showUses(it.uses);
    const acts = document.createElement('div');
    acts.className = 'mk-acts';
    const note = document.createElement('p');
    note.className = 'mk-note';
    note.setAttribute('aria-live', 'polite');

    if (!hidden) {
      const use = button('Use', 'mk-use', () => {
        use.disabled = true;
        this.hooks.use(it, this.pick).then(
          (said) => {
            use.disabled = false;
            if (said === null) return;
            note.textContent = said;
            countUse(it.id).then(
              (n) => showUses(n),
              () => {},
            );
          },
          () => {
            use.disabled = false;
            note.textContent = "This one can't be read by this game.";
          },
        );
      });
      use.setAttribute('aria-label', `Use ${it.title}`);
      const rep = armed('Report', 'Report: sure?', 'mk-report', () => {
        rep.disabled = true;
        report(it.id).then(
          (r) => {
            note.textContent = r.hidden ? 'Reported. Enough reports: it is hidden now.' : r.counted ? 'Reported. Thanks.' : 'Already reported from this network today.';
            if (r.hidden) card.classList.add('is-gone');
          },
          () => {
            rep.disabled = false;
            note.textContent = MARKET_OFFLINE_TEXT;
          },
        );
      });
      rep.setAttribute('aria-label', `Report ${it.title}`);
      acts.append(use, rep);
    }
    const code = this.hooks.devCode();
    if (code) {
      const del = armed('Remove', 'Remove for good?', 'mk-remove', () => {
        del.disabled = true;
        remove(it.id, this.hooks.devCode()).then(
          () => {
            note.textContent = 'Removed for good.';
            card.classList.add('is-gone');
          },
          (err: unknown) => {
            del.disabled = false;
            note.textContent = err instanceof ApiError && err.status === 403 ? 'The Worker refused the dev code.' : MARKET_OFFLINE_TEXT;
          },
        );
      });
      del.setAttribute('aria-label', `Remove ${it.title} for good`);
      acts.appendChild(del);
    }
    card.append(thumb, title, by, uses, acts, note);
    return card;
  }
}

/** An outfit's tiny skier, from its look code. */
export function outfitThumb(look: string): HTMLElement {
  const box = document.createElement('span');
  box.className = 'mk-look';
  box.innerHTML = lookSvg(look);
  return box;
}

function segment(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segment';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mk-act ${className}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** A button that asks first: the first click arms it (`sure`), the second acts; leaving it disarms it. */
function armed(label: string, sure: string, className: string, onAct: () => void): HTMLButtonElement {
  const b = button(label, className, () => {
    if (b.classList.contains('is-armed')) {
      b.classList.remove('is-armed');
      b.textContent = label;
      onAct();
    } else {
      b.classList.add('is-armed');
      b.textContent = sure;
    }
  });
  b.addEventListener('blur', () => {
    b.classList.remove('is-armed');
    b.textContent = label;
  });
  return b;
}

function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
}
