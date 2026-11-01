import { CONFIG } from '../config.ts';
import type { RailShape } from '../maps/types.ts';
import { comboMult, liveButter, liveSlide, scoreEvent, type ScoreEvent, type ScoreState } from '../sim/score.ts';
import { chainText, multText, pointsText, trickTags, trickText } from './scoreText.ts';

/** What became of a banked combo: a new best, an ordinary bank, or one ridden with cheats (a new cheats best, or not). */
export type BankNote = 'best' | 'banked' | 'cheatsBest' | 'cheats';

/** Trick lines kept above the combo panel, newest at the bottom. */
const LINES = 3;
/** A window shorter than this (px, a small embed) shows only the newest SMALL_LINKS links of the chain. */
const SMALL_HEIGHT = 400;
const SMALL_LINKS = 3;
/** Flow past this lights the panel's "Carving" note. */
const FLOW_SHOWN = 0.35;

interface TrickLine {
  el: HTMLElement;
  name: HTMLElement;
  points: HTMLElement;
  tags: HTMLElement;
  /** Seconds shown (real time); past CONFIG.score.hudTrickTime it fades. */
  age: number;
}

/**
 * The combo HUD, bottom center: the last few tricks as they land (and the
 * rail or box being slid, or the butter being pressed, as it goes), and a
 * trail-sign panel with the combo's chain of tricks so far ("720 + Rail
 * slide 12 m + Back flip", wrapping, its oldest folded into "+N more" past
 * three lines), its points, its multiplier and its timer draining (it warns
 * near the end). When a combo ends the panel shows what it banked (or that
 * it was lost) for a moment. The best combo on this map (its cheats best
 * while cheats are on) sits bottom left. It reads the sim's ScoreState and
 * its events; it never changes them.
 */
export class ScoreHud {
  private readonly root: HTMLElement;
  private readonly tricks: HTMLElement;
  private readonly lines: TrickLine[] = [];
  /** The slide or butter in progress, under the trick lines. */
  private readonly slide: HTMLElement;
  private readonly slideName: HTMLElement;
  private readonly slideMeters: HTMLElement;
  private readonly panel: HTMLElement;
  /** The chain: "+N more", then a span per link shown. */
  private readonly chainEl: HTMLElement;
  private readonly moreEl: HTMLElement;
  /** Every link of the combo's chain so far, oldest first, and how many of the oldest are folded into "+N more". */
  private readonly chain: string[] = [];
  private chainFirst = 0;
  /** A link arrived (or the window changed size) since the chain was last laid out. */
  private chainDirty = false;
  /** The chain belongs to a combo still going: the next trick after a bank or a loss starts a new one. */
  private chainLive = false;
  private readonly base: HTMLElement;
  private readonly mult: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly note: HTMLElement;
  private readonly best: HTMLElement;
  private readonly bestLabel: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly onBank: (total: number, tainted: boolean) => BankNote;
  private readonly onLost: () => void;
  /** Events read so far. */
  private seen = 0;
  /** What the panel shows: the live combo, a combo just ended, or nothing. */
  private mode: 'live' | 'ended' | 'none' = 'none';
  private endedAge = 0;
  private shownBase = -1;
  private shownMult = -1;
  private shownFill = -1;
  private shownFlow = false;
  private shownLow = false;
  private shownBest = -1;
  private shownCheats: boolean | null = null;
  private shownSlide = '';
  private shownSlideMeters = -1;
  /** Nothing is shown (so switching off, or a map without scoring, costs nothing per frame). */
  private blank = true;

  constructor(hud: HTMLElement, onBank: (total: number, tainted: boolean) => BankNote, onLost: () => void = () => {}) {
    this.onBank = onBank;
    this.onLost = onLost;
    this.root = div('score-hud ride-only');
    this.root.hidden = true;
    this.tricks = div('score-tricks');
    this.tricks.setAttribute('aria-live', 'polite');
    for (let i = 0; i < LINES; i++) {
      const el = div('score-trick is-gone');
      const name = span('score-trick-name');
      const points = span('score-trick-points');
      const tags = span('score-trick-tags');
      el.append(name, points, tags);
      this.tricks.appendChild(el);
      this.lines.push({ el, name, points, tags, age: Infinity });
    }
    this.slide = div('score-trick score-slide');
    this.slide.hidden = true;
    this.slideName = span('score-trick-name');
    this.slideMeters = span('score-trick-points');
    this.slide.append(this.slideName, this.slideMeters);
    this.panel = div('score-panel');
    this.panel.hidden = true;
    this.chainEl = div('score-chain');
    this.moreEl = span('score-more');
    const row = div('score-row');
    this.base = span('score-base');
    this.mult = span('score-mult');
    row.append(this.base, this.mult);
    this.timer = div('score-timer');
    this.fill = div('score-fill');
    this.timer.appendChild(this.fill);
    this.note = div('score-note');
    this.panel.append(this.chainEl, row, this.timer, this.note);
    this.root.append(this.tricks, this.slide, this.panel);
    hud.appendChild(this.root);

    this.best = div('score-best ride-only');
    this.best.hidden = true;
    this.bestLabel = span('score-best-label');
    this.bestValue = span('score-best-value');
    this.best.append(this.bestLabel, this.bestValue);
    hud.appendChild(this.best);
    window.addEventListener('resize', () => {
      this.chainFirst = 0;
      this.chainDirty = true;
    });
  }

  /**
   * Once per frame. `on`: scoring runs on this map (and in Settings);
   * `rails`: the map's, for naming a slide; `best`: this map's best combo
   * (0: none), its cheats best when `cheats` (cheats are on); `hudTime`:
   * real seconds since the last frame (0 while the game waits).
   */
  update(on: boolean, sc: ScoreState, rails: readonly RailShape[], best: number, cheats: boolean, hudTime: number): void {
    if (this.root.hidden === on) this.root.hidden = !on;
    const showBest = on && best > 0;
    if (this.best.hidden === showBest) this.best.hidden = !showBest;
    if (!on) {
      this.seen = sc.seq;
      this.clear();
      return;
    }
    for (; this.seen < sc.seq; this.seen++) {
      const ev = scoreEvent(sc, this.seen);
      if (ev) this.take(ev);
    }

    const C = CONFIG.score;
    for (let i = 0; i < LINES; i++) {
      const line = this.lines[i]!;
      if (line.age > C.hudTrickTime) continue;
      line.age += hudTime;
      if (line.age > C.hudTrickTime) line.el.classList.add('is-gone');
    }
    this.updateSlide(sc, rails);
    if (sc.active) {
      if (this.mode !== 'live') this.showLive();
      const base = Math.floor(sc.base);
      if (base !== this.shownBase) {
        this.shownBase = base;
        this.base.textContent = pointsText(base);
      }
      const mult = comboMult(sc);
      if (mult !== this.shownMult) {
        this.shownMult = mult;
        this.mult.textContent = multText(mult);
      }
      // Quantized to a hundred steps from full to empty, so the style changes only as often as it shows.
      const step = Math.round(Math.min(1, Math.max(0, sc.timer / C.comboTime)) * 100);
      if (step !== this.shownFill) {
        this.shownFill = step;
        this.fill.style.transform = `scaleX(${step / 100})`;
      }
      const flow = sc.flow > FLOW_SHOWN;
      if (flow !== this.shownFlow) {
        this.shownFlow = flow;
        this.note.textContent = flow ? 'Carving' : '';
        this.panel.classList.toggle('is-flow', flow);
      }
      // Running out: the bar warns (not in the air or on a rail, where it can't run out).
      const low = sc.timer < C.hudTimerLow && !sc.air.active && !sc.rail.active;
      if (low !== this.shownLow) {
        this.shownLow = low;
        this.panel.classList.toggle('is-low', low);
      }
    } else if (this.mode === 'ended') {
      this.endedAge += hudTime;
      if (this.endedAge > C.hudBankTime) {
        this.mode = 'none';
        this.panel.hidden = true;
      }
    } else if (this.mode === 'live') {
      // Ended without an event this reader saw (reset: a new map, scoring switched off).
      this.mode = 'none';
      this.chainLive = false;
      this.panel.hidden = true;
    }
    if (this.chainDirty && !this.panel.hidden) this.fitChain();
    if (best !== this.shownBest) {
      this.shownBest = best;
      this.bestValue.textContent = pointsText(best);
    }
    if (cheats !== this.shownCheats) {
      this.shownCheats = cheats;
      this.bestLabel.textContent = cheats ? 'Best with cheats' : 'Best combo';
    }
  }

  private take(ev: ScoreEvent): void {
    this.blank = false;
    if (ev.kind === 'trick') {
      // The oldest line becomes the newest, at the bottom.
      const line = this.lines.shift()!;
      this.lines.push(line);
      this.tricks.appendChild(line.el);
      line.name.textContent = trickText(ev);
      line.points.textContent = `+${pointsText(ev.points)}`;
      line.tags.textContent = trickTags(ev);
      line.el.classList.toggle('is-sketchy', ev.landing === 'sketchy');
      line.age = 0;
      line.el.classList.remove('is-gone', 'is-new');
      void line.el.offsetWidth; // restart the pop-in
      line.el.classList.add('is-new');
      // The chain: a trick after a bank or a loss starts a new one.
      if (!this.chainLive) {
        this.chainLive = true;
        this.chain.length = 0;
        this.chainFirst = 0;
      }
      this.chain.push(chainText(ev));
      this.chainDirty = true;
      return;
    }
    this.chainLive = false;
    this.mode = 'ended';
    this.endedAge = 0;
    this.panel.hidden = false;
    this.panel.classList.remove('is-live', 'is-flow', 'is-low', 'is-best', 'is-lost', 'is-cheats');
    this.shownFlow = false;
    this.shownLow = false;
    this.base.textContent = pointsText(ev.total);
    this.shownBase = -1;
    this.mult.textContent = '';
    this.shownMult = -1;
    if (ev.kind === 'lost') {
      this.onLost();
      this.panel.classList.add('is-lost');
      this.note.textContent = 'Combo lost';
      return;
    }
    const note = this.onBank(ev.total, ev.tainted);
    this.panel.classList.add(note === 'best' || note === 'cheatsBest' ? 'is-best' : note === 'cheats' ? 'is-cheats' : 'is-banked');
    this.note.textContent = note === 'best' ? 'New best combo!' : note === 'cheatsBest' ? 'New cheats best!' : note === 'cheats' ? 'Banked · cheats on' : 'Banked';
  }

  /**
   * Lays out the chain: every link, or in a short window only the newest
   * few; then, while it runs past its three lines (its CSS max-height), the
   * oldest shown folds into "+N more" too. The chain only grows during a combo,
   * so the fold carries on from where it was (a resize starts it over).
   */
  private fitChain(): void {
    this.chainDirty = false;
    const n = this.chain.length;
    let first = Math.min(this.chainFirst, Math.max(0, n - 1));
    if (window.innerHeight < SMALL_HEIGHT) first = Math.max(first, n - SMALL_LINKS);
    this.showChain(first);
    while (first < n - 1 && this.chainEl.scrollHeight > this.chainEl.clientHeight + 1) this.showChain(++first);
  }

  /** Shows the chain from link `first` on, the newest brightest, the older ones counted in "+N more". */
  private showChain(first: number): void {
    this.chainFirst = first;
    this.moreEl.textContent = first > 0 ? `+${first} more` : '';
    const parts: (Node | string)[] = [this.moreEl];
    for (let i = first; i < this.chain.length; i++) {
      const link = span(i === this.chain.length - 1 ? 'score-link is-newest' : 'score-link');
      link.textContent = this.chain[i]!;
      parts.push(' ', link);
    }
    this.chainEl.replaceChildren(...parts);
  }

  private showLive(): void {
    this.blank = false;
    this.mode = 'live';
    this.panel.hidden = false;
    this.panel.classList.remove('is-best', 'is-lost', 'is-cheats', 'is-banked', 'is-low');
    this.panel.classList.add('is-live');
    this.note.textContent = '';
    this.shownFlow = false;
    this.shownLow = false;
    this.shownBase = -1;
    this.shownMult = -1;
    this.shownFill = -1;
  }

  /**
   * The slide or butter in progress, named as it goes (a slide's meters
   * counted). The text changes only when what it shows does: a slide's whole
   * meters, a butter's turn (each run each way) in 45° steps and whether its press counts yet.
   */
  private updateSlide(sc: ScoreState, rails: readonly RailShape[]): void {
    const b = sc.butter;
    // A butter: its runs each way so far, the one going in 45° steps, and whether its press counts yet.
    const key = sc.rail.active
      ? Math.floor(sc.rail.meters)
      : b.active
        ? -2 - 2 * (Math.floor((Math.abs(b.turn - b.runs.start) * 180) / Math.PI / 45) + 1000 * b.runs.count) - (b.time >= CONFIG.score.butterPressMin ? 1 : 0)
        : -1;
    if (key === this.shownSlideMeters) return;
    this.shownSlideMeters = key;
    const name = key === -1 ? '' : sc.rail.active ? liveSlide(sc, rails) : liveButter(sc);
    if (this.slide.hidden === (name !== '')) this.slide.hidden = name === '';
    if (name === '') return;
    this.blank = false;
    if (name !== this.shownSlide) {
      this.shownSlide = name;
      this.slideName.textContent = name;
    }
    this.slideMeters.textContent = sc.rail.active ? `${key} m` : '';
  }

  private clear(): void {
    if (this.blank) return;
    this.blank = true;
    this.mode = 'none';
    this.chainLive = false;
    this.panel.hidden = true;
    this.slide.hidden = true;
    this.shownSlideMeters = -1;
    for (const line of this.lines) {
      line.age = Infinity;
      line.el.classList.add('is-gone');
    }
  }
}

function div(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function span(className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  return el;
}
