import { entryOf, topEntries, type BoardRef, type PostResult } from '../online/boards.ts';
import { fillRows, scoreText } from './boardRows.ts';
import { OFFLINE_TEXT } from './leaderboardScreen.ts';

// The board beside "Finished!" at the finish line: the top 5 of the map's
// board (on the Slalom, the course's), the player's own row under them, and
// what happened to this run's score. The ✕ button or the board key hides it
// (Back to top stays); the key shows it again. Part of the lazy leaderboard
// chunk.

const TOP = 5;

/** What the finish shows: the board, and a line about this run's score if main has one. */
export interface FinishSpec {
  ref: BoardRef;
  /** When this run began (performance.now()): only a post since then is this run's. */
  since: number;
  /** Overrides the post's outcome ("Missed a gate: not posted."), or ''. */
  note: string;
}

export interface FinishHooks {
  myName: () => string;
  /** The board's latest post since `since`: still going (a promise), its result, an error, or none. */
  postFor: (ref: BoardRef, since: number) => Promise<PostResult> | PostResult | 'error' | null;
  /** The ✕ button was clicked. */
  close: () => void;
}

export class FinishBoard {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly key: HTMLElement;
  private readonly hooks: FinishHooks;
  private spec: FinishSpec | null = null;
  private token = 0;

  constructor(slot: HTMLElement, hooks: FinishHooks) {
    this.hooks = hooks;
    this.el = document.createElement('section');
    this.el.className = 'finish-board';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Leaderboard');
    const head = document.createElement('header');
    head.className = 'fb-head';
    this.title = document.createElement('h2');
    this.title.className = 'fb-title';
    this.tag = document.createElement('span');
    this.tag.className = 'fb-tag';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fb-close';
    close.setAttribute('aria-label', 'Hide the leaderboard');
    close.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    this.key = document.createElement('kbd');
    close.appendChild(this.key);
    close.addEventListener('click', () => {
      // A focused button would take the game's Space and Enter.
      close.blur();
      hooks.close();
    });
    head.append(this.title, this.tag, close);
    this.list = document.createElement('ol');
    this.list.className = 'lb-rows fb-rows';
    this.status = document.createElement('p');
    this.status.className = 'fb-status';
    this.status.setAttribute('aria-live', 'polite');
    this.el.append(head, this.list, this.status);
    slot.appendChild(this.el);
  }

  /** The key that hides and shows the board, as bound now. */
  setKey(name: string): void {
    this.key.textContent = name;
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  /** Shows `spec`'s board (fetching it, after this run's post if one is still going). */
  show(spec: FinishSpec): void {
    this.spec = spec;
    this.el.hidden = false;
    void this.load();
  }

  /** Shows the last board again (the board key, after hiding it). */
  reshow(): void {
    if (this.spec) this.show(this.spec);
  }

  /** True while `ref`'s board is the one shown. */
  showing(ref: BoardRef): boolean {
    return this.shown && this.spec?.ref.board === ref.board && this.spec.ref.cheats === ref.cheats;
  }

  hide(): void {
    this.el.hidden = true;
    this.token++;
  }

  private async load(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    const { ref } = spec;
    const token = ++this.token;
    this.title.textContent = ref.board.title;
    this.tag.textContent = ref.cheats ? 'Cheats' : 'Clean';
    this.tag.classList.toggle('is-cheats', ref.cheats);
    const name = this.hooks.myName();
    let post = this.hooks.postFor(ref, spec.since);
    this.status.textContent = post instanceof Promise ? 'Posting your score…' : 'Loading…';
    try {
      if (post instanceof Promise) post = await post.catch(() => 'error' as const);
      if (token !== this.token) return;
      const [top, mine] = await Promise.all([topEntries(ref, TOP), name ? entryOf(ref, name) : Promise.resolve(null)]);
      if (token !== this.token) return;
      fillRows(this.list, ref.board.kind, top, name, mine);
      this.status.textContent = this.outcome(spec, name, post) || (top.length ? '' : 'No scores yet: be the first.');
    } catch {
      if (token !== this.token) return;
      this.list.replaceChildren();
      this.status.textContent = OFFLINE_TEXT;
    }
  }

  private outcome(spec: FinishSpec, name: string, post: PostResult | 'error' | null): string {
    if (spec.note) return spec.note;
    if (!name) return 'Add a name on the title screen to post your scores.';
    if (post === 'error') return "Couldn't post your score: the leaderboard is offline.";
    if (!post) return '';
    if (post.posted) return 'New best on the board!';
    return post.entry ? `${post.entry.name}'s best on the board stays: ${scoreText(spec.ref.board.kind, post.entry.value)}.` : '';
  }
}
