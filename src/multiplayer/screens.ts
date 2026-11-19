import { addBackButton, board, setHints, type Screen } from '../ui/menus.ts';
import { CODE_FORMAT, lobbyTitleProblem, ROOM_MAX, TITLE_MAX, tidyTitle, type LobbyEntry } from '../online/mpRules.ts';

// Multiplayer's menus (milestone 27): a map's lobby list (the user's pick:
// the list comes first, every time), with a lobby to make (a title, open or
// private) and a code to type; and, from pause, the lobby you're in: who's
// riding, their best combo this visit and last trick, mute, and Leave.

export interface LobbyListHooks {
  list(map: string): Promise<LobbyEntry[]>;
  create(map: string, title: string, open: boolean): Promise<string>;
  join(code: string): void;
  back(): void;
  /** Plain words for a failed request. */
  errorText(err: unknown): string;
  /** A suggested title for a new lobby. */
  suggestTitle(): string;
  every: number;
}

export class LobbyListScreen implements Screen {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly status: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly titleNote: HTMLElement;
  private readonly openButton: HTMLButtonElement;
  private readonly privateButton: HTMLButtonElement;
  private readonly createButton: HTMLButtonElement;
  private readonly codeInput: HTMLInputElement;
  private readonly hooks: LobbyListHooks;
  private map = '';
  private open = true;
  private timer = 0;
  private busy = false;
  private shown = false;

  constructor(hooks: LobbyListHooks) {
    this.hooks = hooks;
    const b = board('Lobbies', 'lobby-screen');
    this.el = b.el;
    this.sub = b.sub;
    this.sub.hidden = false;
    addBackButton(b.head, hooks.back);

    this.rows = document.createElement('div');
    this.rows.className = 'lobby-rows';

    const make = document.createElement('div');
    make.className = 'lobby-make';
    const makeHead = document.createElement('h3');
    makeHead.className = 'lobby-head';
    makeHead.textContent = 'Make a lobby';
    const row = document.createElement('div');
    row.className = 'lobby-form';
    this.titleInput = document.createElement('input');
    this.titleInput.className = 'text-box lobby-title-input';
    this.titleInput.maxLength = TITLE_MAX;
    this.titleInput.placeholder = 'Lobby title';
    this.titleInput.setAttribute('aria-label', 'Lobby title');
    this.titleInput.addEventListener('input', () => (this.titleNote.textContent = ''));
    const seg = document.createElement('div');
    seg.className = 'lobby-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Who can join');
    this.openButton = segButton('Open', () => this.setOpen(true));
    this.privateButton = segButton('Private', () => this.setOpen(false));
    seg.append(this.openButton, this.privateButton);
    this.createButton = document.createElement('button');
    this.createButton.type = 'button';
    this.createButton.className = 'plank plank-small lobby-go';
    this.createButton.textContent = 'Make it';
    this.createButton.addEventListener('click', () => void this.make());
    row.append(this.titleInput, seg, this.createButton);
    this.titleNote = document.createElement('p');
    this.titleNote.className = 'name-note';
    const openNote = document.createElement('p');
    openNote.className = 'name-note';
    openNote.textContent = 'Open lobbies are listed here for everyone. Private ones are joined only with their code.';
    make.append(makeHead, row, this.titleNote, openNote);

    const code = document.createElement('div');
    code.className = 'lobby-make';
    const codeHead = document.createElement('h3');
    codeHead.className = 'lobby-head';
    codeHead.textContent = 'Join with a code';
    const codeRow = document.createElement('div');
    codeRow.className = 'lobby-form';
    this.codeInput = document.createElement('input');
    this.codeInput.className = 'text-box lobby-code-input';
    this.codeInput.maxLength = 4;
    this.codeInput.placeholder = 'ABCD';
    this.codeInput.autocapitalize = 'characters';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('aria-label', 'Lobby code');
    this.codeInput.addEventListener('input', () => (this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '')));
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinCode();
    });
    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.make();
    });
    const codeGo = document.createElement('button');
    codeGo.type = 'button';
    codeGo.className = 'plank plank-small lobby-go';
    codeGo.textContent = 'Join';
    codeGo.addEventListener('click', () => this.joinCode());
    codeRow.append(this.codeInput, codeGo);
    code.append(codeHead, codeRow);

    this.status = document.createElement('p');
    this.status.className = 'board-status';
    this.status.setAttribute('aria-live', 'polite');
    b.body.append(this.rows, make, code, this.status);
    setHints(b.foot, [
      [['↑', '↓'], 'Choose'],
      [['Enter'], 'Join'],
      [['Esc'], 'Back'],
    ]);
    this.setOpen(true);
  }

  /** Before showing: which map's lobbies, by id and name. */
  prepare(map: string, mapName: string): void {
    this.map = map;
    this.sub.textContent = `${mapName}: pick a lobby, make one, or type a code.`;
    this.rows.replaceChildren(note('Looking for lobbies…'));
    this.say('');
  }

  enter(): HTMLElement | null {
    this.shown = true;
    this.busy = false;
    if (!this.titleInput.value) this.titleInput.value = this.hooks.suggestTitle();
    void this.refresh();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.refresh(), this.hooks.every * 1000);
    return this.rows.querySelector<HTMLElement>('button') ?? this.titleInput;
  }

  leave(): void {
    this.shown = false;
    clearInterval(this.timer);
  }

  /** What's happening (joining, a refusal), under the list. */
  say(text: string): void {
    this.status.textContent = text;
  }

  /** Joining finished one way or the other: the buttons work again. */
  done(): void {
    this.busy = false;
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.openButton.setAttribute('aria-pressed', String(open));
    this.privateButton.setAttribute('aria-pressed', String(!open));
  }

  private async refresh(): Promise<void> {
    const map = this.map;
    try {
      const lobbies = await this.hooks.list(map);
      if (!this.shown || map !== this.map) return;
      this.draw(lobbies);
    } catch (err) {
      if (!this.shown || map !== this.map) return;
      this.rows.replaceChildren(note(this.hooks.errorText(err)));
    }
  }

  private draw(lobbies: LobbyEntry[]): void {
    const focusedCode = (document.activeElement as HTMLElement | null)?.dataset?.code;
    if (lobbies.length === 0) {
      this.rows.replaceChildren(note('No open lobbies on this map yet. Make one below.'));
      return;
    }
    const buttons = lobbies.map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plank lobby-row';
      b.dataset.code = l.code;
      const full = l.riders >= (l.max || ROOM_MAX);
      const title = document.createElement('span');
      title.className = 'lobby-row-title';
      title.textContent = l.title;
      const count = document.createElement('span');
      count.className = 'lobby-row-count';
      count.textContent = full ? 'Full' : `${l.riders} / ${l.max || ROOM_MAX}`;
      b.append(title, count);
      if (full) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => {
        if (!full) this.join(l.code);
      });
      return b;
    });
    this.rows.replaceChildren(...buttons);
    if (focusedCode) buttons.find((b) => b.dataset.code === focusedCode)?.focus();
  }

  private async make(): Promise<void> {
    if (this.busy) return;
    const title = tidyTitle(this.titleInput.value);
    const problem = lobbyTitleProblem(title);
    if (problem) {
      this.titleNote.textContent = problem;
      this.titleInput.focus();
      return;
    }
    this.busy = true;
    this.say('Making the lobby…');
    try {
      const code = await this.hooks.create(this.map, title, this.open);
      this.join(code, true);
    } catch (err) {
      this.busy = false;
      this.say(this.hooks.errorText(err));
    }
  }

  private joinCode(): void {
    const code = this.codeInput.value.trim().toUpperCase();
    if (!CODE_FORMAT.test(code)) {
      this.say('A code is four letters.');
      this.codeInput.focus();
      return;
    }
    this.join(code);
  }

  private join(code: string, made = false): void {
    if (this.busy && !made) return;
    this.busy = true;
    this.say(`Joining ${code}…`);
    this.hooks.join(code);
  }
}

export interface RoomRider {
  id: number;
  name: string;
  best: number;
  trick: string;
  muted: boolean;
  away: boolean;
  you: boolean;
}

export interface RoomHooks {
  info(): { title: string; code: string; open: boolean; riders: RoomRider[] } | null;
  mute(id: number, muted: boolean): void;
  leave(): void;
  back(): void;
}

/** The lobby you're in, from pause. */
export class RoomScreen implements Screen {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly hooks: RoomHooks;
  private shown = false;

  constructor(hooks: RoomHooks) {
    this.hooks = hooks;
    const b = board('Lobby', 'lobby-screen');
    this.el = b.el;
    this.sub = b.sub;
    this.sub.hidden = false;
    addBackButton(b.head, hooks.back);
    this.rows = document.createElement('div');
    this.rows.className = 'lobby-riders';
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'plank lobby-leave';
    leave.textContent = 'Leave the lobby';
    leave.addEventListener('click', hooks.leave);
    b.body.append(this.rows, leave);
    setHints(b.foot, [
      [['↑', '↓'], 'Choose'],
      [['Enter'], 'Mute or unmute'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.shown = true;
    this.update();
    return this.rows.querySelector<HTMLElement>('button') ?? this.el.querySelector<HTMLElement>('.lobby-leave');
  }

  leave(): void {
    this.shown = false;
  }

  /** Redraws the list (someone joined, left or banked a combo), keeping the focus. */
  update(): void {
    if (!this.shown) return;
    const info = this.hooks.info();
    if (!info) {
      this.sub.textContent = 'Not in a lobby.';
      this.rows.replaceChildren();
      return;
    }
    this.sub.textContent = `${info.title} · code ${info.code} · ${info.open ? 'open' : 'private: share the code'}`;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.rider;
    const rows = info.riders.map((r) => {
      const row = document.createElement('div');
      row.className = 'lobby-rider';
      const name = document.createElement('span');
      name.className = 'lobby-rider-name';
      name.textContent = r.you ? `${r.name} (you)` : r.away ? `${r.name} (away)` : r.name;
      const best = document.createElement('span');
      best.className = 'lobby-rider-best';
      best.textContent = r.best > 0 ? r.best.toLocaleString('en-US') : '–';
      const trick = document.createElement('span');
      trick.className = 'lobby-rider-trick';
      trick.textContent = r.trick;
      row.append(name, best, trick);
      if (!r.you) {
        const mute = document.createElement('button');
        mute.type = 'button';
        mute.className = 'board-back lobby-mute';
        mute.dataset.rider = String(r.id);
        mute.textContent = r.muted ? 'Unmute' : 'Mute';
        mute.setAttribute('aria-label', `${r.muted ? 'Unmute' : 'Mute'} ${r.name}'s chat`);
        mute.addEventListener('click', () => {
          this.hooks.mute(r.id, !r.muted);
          this.update();
        });
        row.appendChild(mute);
      }
      return row;
    });
    const head = document.createElement('div');
    head.className = 'lobby-rider lobby-rider-head';
    head.innerHTML = '<span>Rider</span><span>Best combo</span><span>Last trick</span>';
    this.rows.replaceChildren(head, ...rows);
    if (focused) this.rows.querySelector<HTMLElement>(`[data-rider="${focused}"]`)?.focus();
  }
}

function segButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'segment';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'lobby-note';
  p.textContent = text;
  return p;
}
