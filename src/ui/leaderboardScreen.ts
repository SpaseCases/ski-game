import { tidyName } from '../core/playerName.ts';
import { BOARDS, entryOf, searchNames, topEntries, type BoardRef } from '../online/boards.ts';
import { fillRows } from './boardRows.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Leaderboards screen (from the title, pause and map select): one board
// at a time, ← and → step through them, C switches Clean and Cheats, and /
// jumps to the name search. Shows the top 10 and, when the player's name is
// further down, their own row under a gap. Part of the lazy leaderboard
// chunk; offline it says so and the rest of the game carries on.

const TOP = 10;
const FOUND = 8;
const SEARCH_DELAY_MS = 350;

export const OFFLINE_TEXT = "Leaderboard offline. Your bests still save on this computer.";
export const NO_NAME_TEXT = 'Add a name on the title screen to post your scores.';

export class LeaderboardScreen implements Screen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly what: HTMLElement;
  private readonly clean: HTMLButtonElement;
  private readonly cheatsButton: HTMLButtonElement;
  private readonly caption: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly note: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly next: HTMLButtonElement;
  private at = 0;
  private cheats = false;
  /** Bumped by every load, so an answer for a board no longer shown is dropped. */
  private token = 0;
  private searchTimer = 0;
  private readonly myName: () => string;

  constructor(myName: () => string, onBack: () => void) {
    this.myName = myName;
    const b = board('Leaderboards', 'leaderboards-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);

    const bar = document.createElement('div');
    bar.className = 'lb-bar';
    const prev = arrow('Previous board', 'M9 1 3 7l6 6', () => this.step(-1));
    this.next = arrow('Next board', 'M5 1l6 6-6 6', () => this.step(1));
    const sign = document.createElement('div');
    sign.className = 'lb-sign';
    this.title = document.createElement('h2');
    this.title.className = 'lb-title';
    this.what = document.createElement('p');
    this.what.className = 'lb-what';
    sign.append(this.title, this.what);
    const tabs = document.createElement('div');
    tabs.className = 'segmented lb-tabs';
    this.clean = tab('Clean', () => this.setCheats(false));
    this.cheatsButton = tab('Cheats', () => this.setCheats(true));
    tabs.append(this.clean, this.cheatsButton);
    bar.append(prev, sign, this.next, tabs);

    this.caption = document.createElement('p');
    this.caption.className = 'lb-caption';
    this.list = document.createElement('ol');
    this.list.className = 'lb-rows';
    this.status = document.createElement('p');
    this.status.className = 'lb-status';
    this.status.setAttribute('aria-live', 'polite');

    const findRow = document.createElement('label');
    findRow.className = 'lb-find';
    const findLabel = document.createElement('span');
    findLabel.textContent = 'Find a name';
    this.find = document.createElement('input');
    this.find.type = 'text';
    this.find.className = 'text-box';
    this.find.maxLength = 16;
    this.find.autocomplete = 'off';
    this.find.spellcheck = false;
    this.find.placeholder = 'Type the start of a name';
    this.find.addEventListener('input', () => this.queueSearch());
    findRow.append(findLabel, this.find);
    this.note = document.createElement('p');
    this.note.className = 'lb-note';

    b.body.append(bar, this.caption, this.list, this.status, findRow, this.note);
    setHints(b.foot, [
      [['←', '→'], 'Board'],
      [['C'], 'Clean or cheats'],
      [['/'], 'Find a name'],
      [['Esc'], 'Back'],
    ]);
  }

  /** Before opening: the board to show first. */
  show(ref: BoardRef): void {
    this.at = Math.max(0, BOARDS.indexOf(ref.board));
    this.cheats = ref.cheats;
  }

  enter(): HTMLElement | null {
    this.find.value = '';
    this.note.textContent = this.myName() ? '' : NO_NAME_TEXT;
    void this.load();
    return this.next;
  }

  leave(): void {
    clearTimeout(this.searchTimer);
    this.token++;
  }

  onKey(e: KeyboardEvent): boolean {
    const inFind = e.target === this.find;
    if (inFind) {
      if (e.key === 'Escape' && this.find.value !== '') {
        this.find.value = '';
        void this.load();
        return true;
      }
      return false;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!e.repeat) this.step(e.key === 'ArrowLeft' ? -1 : 1);
      return true;
    }
    if (e.key === 'c' || e.key === 'C') {
      if (!e.repeat) this.setCheats(!this.cheats);
      return true;
    }
    if (e.key === '/') {
      this.find.focus();
      return true;
    }
    return false;
  }

  private get ref(): BoardRef {
    return { board: BOARDS[this.at]!, cheats: this.cheats };
  }

  private step(dir: number): void {
    this.at = (this.at + dir + BOARDS.length) % BOARDS.length;
    void this.load();
  }

  private setCheats(on: boolean): void {
    this.cheats = on;
    void this.load();
  }

  private queueSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = window.setTimeout(() => void this.load(), SEARCH_DELAY_MS);
  }

  /** Shows the board picked (or the search's matches on it), fetching it. */
  private async load(): Promise<void> {
    clearTimeout(this.searchTimer);
    const ref = this.ref;
    const token = ++this.token;
    this.title.textContent = ref.board.title;
    this.what.textContent = ref.board.kind === 'combo' ? 'Best combo' : 'Best time, no missed gates';
    this.clean.setAttribute('aria-pressed', String(!ref.cheats));
    this.cheatsButton.setAttribute('aria-pressed', String(ref.cheats));
    const query = tidyName(this.find.value);
    this.caption.textContent = query ? `Names starting with “${query}”` : `Top ${TOP}`;
    this.status.textContent = 'Loading…';
    this.list.classList.add('is-loading');
    try {
      const name = this.myName();
      if (query) {
        const found = await searchNames(ref, query, FOUND);
        if (token !== this.token) return;
        fillRows(this.list, ref.board.kind, found, name);
        this.status.textContent = found.length ? '' : `No names on this board start with “${query}”.`;
      } else {
        const [top, mine] = await Promise.all([topEntries(ref, TOP), name ? entryOf(ref, name) : Promise.resolve(null)]);
        if (token !== this.token) return;
        fillRows(this.list, ref.board.kind, top, name, mine);
        this.status.textContent = top.length ? '' : ref.cheats ? 'No scores with cheats on yet.' : 'No scores yet: be the first.';
      }
    } catch {
      if (token !== this.token) return;
      this.list.replaceChildren();
      this.status.textContent = OFFLINE_TEXT;
    } finally {
      if (token === this.token) this.list.classList.remove('is-loading');
    }
  }
}

function arrow(label: string, d: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lb-arrow';
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  b.addEventListener('click', onClick);
  return b;
}

function tab(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segment';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
