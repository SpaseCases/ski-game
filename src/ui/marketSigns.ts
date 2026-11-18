import { blockedText } from '../core/playerName.ts';
import { ApiError } from '../online/api.ts';
import { share } from '../online/market.ts';
import { tidyTitle, TITLE_MAX, TITLE_MIN, titleProblem, UPLOADS_PER_ADDRESS, UPLOADS_PER_NAME, type MarketKind } from '../online/marketRules.ts';
import { board, plank, setHints, type Screen } from './menus.ts';
import { MARKET_OFFLINE_TEXT, outfitThumb } from './marketPanel.ts';

// The marketplace's two signs (milestone 24), pushed over the Locker or an
// editor; part of the lazy online chunk. Share: what's shared, a title box
// (3 to 24 characters, the word filter), Share and Cancel, under the board
// name. Replace a slot: when every slot of a kind is painted, Use asks which
// one to paint over.

/** Something to share, as main builds it: the item's fields, what it is ("Park skis: Custom 2") and a thumbnail (an outfit's is drawn from its look). */
export interface ShareRequest {
  kind: MarketKind;
  type: string;
  data: string;
  look: string;
  what: string;
  thumb?: HTMLElement;
}

const TITLE_NOTE = `${TITLE_MIN} to ${TITLE_MAX} letters, digits, spaces and - _ ' ! .`;

export class ShareSign implements Screen {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly what: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private request: ShareRequest | null = null;
  private name = '';
  private busy = false;
  private done = false;
  /** The last try failed: its note stays until the title is typed again. */
  private failed = false;
  private readonly back: () => void;

  constructor(back: () => void) {
    this.back = back;
    const b = board('Share', 'share-sign');
    this.el = b.el;
    this.sub = b.sub;
    this.sub.hidden = false;
    const card = document.createElement('div');
    card.className = 'share-card';
    this.preview = document.createElement('div');
    this.preview.className = 'share-thumb';
    this.what = document.createElement('p');
    this.what.className = 'share-what';
    card.append(this.preview, this.what);
    const row = document.createElement('label');
    row.className = 'name-row share-row';
    const label = document.createElement('span');
    label.className = 'name-label';
    label.textContent = 'Title';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'text-box';
    this.input.maxLength = TITLE_MAX;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.placeholder = 'Name your design';
    this.input.addEventListener('input', () => {
      this.failed = false;
      this.check();
    });
    row.append(label, this.input);
    this.note = document.createElement('p');
    this.note.className = 'name-note';
    this.note.setAttribute('aria-live', 'polite');
    const list = document.createElement('div');
    list.className = 'plank-list';
    this.go = plank('Share it', () => void this.send());
    this.cancel = plank('Cancel', () => this.back());
    list.append(this.go, this.cancel);
    b.body.append(card, row, this.note, list);
    setHints(b.foot, [
      [['Enter'], 'Share'],
      [['Esc'], 'Cancel'],
    ]);
  }

  /** Before opening: what to share, under which name ('' for none: it says to pick one). */
  ask(request: ShareRequest, name: string): void {
    this.request = request;
    this.name = name;
    this.done = false;
    this.busy = false;
    this.failed = false;
    this.preview.replaceChildren(request.thumb ?? outfitThumb(request.look));
    this.what.textContent = request.what;
    this.input.value = '';
    this.input.disabled = !name;
    this.sub.textContent = name ? `On the marketplace under “${name}”, for anyone to use.` : 'Add a board name on the title screen first: things are shared under it.';
    this.cancel.querySelector('.plank-label')!.textContent = 'Cancel';
    this.go.hidden = !name;
    this.check();
  }

  enter(): HTMLElement | null {
    return this.name ? this.input : this.cancel;
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.target === this.input && e.key === 'Enter') {
      if (!e.repeat) void this.send();
      return true;
    }
    return false;
  }

  /** The title as it would be sent, or null with the note saying why not. */
  private check(): string | null {
    const title = tidyTitle(this.input.value);
    const problem = title === '' ? 'empty' : titleProblem(title) ?? (blockedText(title) ? 'word' : null);
    const text: Record<string, string> = {
      empty: TITLE_NOTE,
      short: `At least ${TITLE_MIN} characters.`,
      long: `At most ${TITLE_MAX} characters.`,
      chars: "Only letters, digits, spaces and - _ ' ! .",
      word: "Pick a different title: that one isn't allowed.",
    };
    if (!this.busy && !this.done && !this.failed) {
      this.note.textContent = problem ? text[problem]! : TITLE_NOTE;
      this.note.classList.toggle('is-problem', problem !== null && problem !== 'empty');
    }
    this.go.disabled = problem !== null || this.busy || this.done;
    return problem ? null : title;
  }

  private async send(): Promise<void> {
    const req = this.request;
    const title = this.check();
    if (!req || !title || this.busy || this.done || !this.name) return;
    this.busy = true;
    this.go.disabled = true;
    this.note.classList.remove('is-problem');
    this.note.textContent = 'Sharing…';
    try {
      await share({ kind: req.kind, type: req.type, title, name: this.name, data: req.data, look: req.look });
      this.done = true;
      this.note.textContent = 'Shared! It shows in the Market within a minute.';
      this.input.disabled = true;
      this.cancel.querySelector('.plank-label')!.textContent = 'Done';
      this.cancel.focus();
    } catch (err) {
      this.failed = true;
      this.note.classList.add('is-problem');
      if (err instanceof ApiError && err.status === 429 && err.code === 'limit') this.note.textContent = `That's today's shares (${UPLOADS_PER_NAME} a name, ${UPLOADS_PER_ADDRESS} a network): try again tomorrow.`;
      else if (err instanceof ApiError && err.status === 429) this.note.textContent = 'Too many at once: wait a moment and try again.';
      else if (err instanceof ApiError && err.code === 'title') this.note.textContent = "Pick a different title: that one isn't allowed.";
      else if (err instanceof ApiError && err.status === 400) this.note.textContent = "The marketplace can't take this one.";
      else this.note.textContent = MARKET_OFFLINE_TEXT;
    } finally {
      this.busy = false;
      this.check();
    }
  }
}

/** Use with every slot of a kind painted: pick one to paint over, or cancel. */
export class SlotPicker implements Screen {
  readonly el: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly slots: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private answer: ((slot: number | null) => void) | null = null;
  private readonly back: () => void;

  constructor(back: () => void) {
    this.back = back;
    const b = board('Replace a slot', 'slot-picker');
    this.el = b.el;
    this.sub = b.sub;
    this.sub.hidden = false;
    this.slots = document.createElement('div');
    this.slots.className = 'ski-customs picker-slots';
    const list = document.createElement('div');
    list.className = 'plank-list';
    this.cancel = plank('Cancel', () => this.back());
    list.appendChild(this.cancel);
    b.body.append(this.slots, list);
    setHints(b.foot, [
      [['←', '→'], 'Choose'],
      [['Enter'], 'Paint over it'],
      [['Esc'], 'Cancel'],
    ]);
  }

  /** Before opening: what's full ("Park ski") and its slots' thumbnails; `answer` hears the slot picked, or null. */
  ask(what: string, thumbs: HTMLElement[], answer: (slot: number | null) => void): void {
    this.answer = answer;
    this.sub.textContent = `All your ${what} slots are painted. Pick one to paint over: what's in it now is lost.`;
    this.slots.replaceChildren(
      ...thumbs.map((thumb, slot) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ski-graphic ski-custom-pick picker-slot';
        const label = document.createElement('span');
        label.className = 'ski-custom-name';
        label.textContent = `Custom ${slot + 1}`;
        b.append(thumb, label);
        b.setAttribute('aria-label', `Paint over custom ${slot + 1}`);
        b.addEventListener('click', () => this.finish(slot));
        return b;
      }),
    );
  }

  enter(): HTMLElement | null {
    return (this.slots.firstElementChild as HTMLElement | null) ?? this.cancel;
  }

  leave(): void {
    // Esc, Cancel or anything else that closes it without a pick.
    const a = this.answer;
    this.answer = null;
    a?.(null);
  }

  private finish(slot: number): void {
    const a = this.answer;
    this.answer = null;
    this.back();
    a?.(slot);
  }
}
