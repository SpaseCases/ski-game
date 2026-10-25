import { CONFIG } from '../config.ts';
import type { RailShape } from '../maps/types.ts';
import { comboMult, liveButter, liveSlide, scoreEvent, type ScoreEvent, type ScoreState } from '../sim/score.ts';
import { multText, pointsText, trickTags, trickText } from './scoreText.ts';

/** What became of a banked combo: a new best, an ordinary bank, or one ridden with cheats (never a best). */
export type BankNote = 'best' | 'banked' | 'cheats';

/** Trick lines kept above the combo panel, newest at the bottom. */
const LINES = 3;
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
 * rail or box being slid, or the butter being pressed, as it goes), and a trail-sign panel with the
 * combo's points, its multiplier and its timer draining (it warns near the
 * end). When a combo ends the panel shows what it banked (or that it was
 * lost) for a moment. The best combo on this map sits bottom left. It reads
 * the sim's ScoreState and its events; it never changes them.
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
  private readonly base: HTMLElement;
  private readonly mult: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly note: HTMLElement;
  private readonly best: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly onBank: (total: number, tainted: boolean) => BankNote;
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
  private shownSlide = '';
  private shownSlideMeters = -1;
  /** Nothing is shown (so switching off, or a map without scoring, costs nothing per frame). */
  private blank = true;

  constructor(hud: HTMLElement, onBank: (total: number, tainted: boolean) => BankNote) {
    this.onBank = onBank;
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
    const row = div('score-row');
    this.base = span('score-base');
    this.mult = span('score-mult');
    row.append(this.base, this.mult);
    this.timer = div('score-timer');
    this.fill = div('score-fill');
    this.timer.appendChild(this.fill);
    this.note = div('score-note');
    this.panel.append(row, this.timer, this.note);
    this.root.append(this.tricks, this.slide, this.panel);
    hud.appendChild(this.root);

    this.best = div('score-best ride-only');
    this.best.hidden = true;
    const label = span('score-best-label');
    label.textContent = 'Best combo';
    this.bestValue = span('score-best-value');
    this.best.append(label, this.bestValue);
    hud.appendChild(this.best);
  }

  /**
   * Once per frame. `on`: scoring runs on this map (and in Settings);
   * `rails`: the map's, for naming a slide; `best`: this map's best combo
   * (0: none); `hudTime`: real seconds since the last frame (0 while the
   * game waits).
   */
  update(on: boolean, sc: ScoreState, rails: readonly RailShape[], best: number, hudTime: number): void {
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
      this.panel.hidden = true;
    }
    if (best !== this.shownBest) {
      this.shownBest = best;
      this.bestValue.textContent = pointsText(best);
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
      return;
    }
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
      this.panel.classList.add('is-lost');
      this.note.textContent = 'Combo lost';
      return;
    }
    const note = this.onBank(ev.total, ev.tainted);
    this.panel.classList.add(note === 'best' ? 'is-best' : note === 'cheats' ? 'is-cheats' : 'is-banked');
    this.note.textContent = note === 'best' ? 'New best combo!' : note === 'cheats' ? 'Banked · cheats on, best not saved' : 'Banked';
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
   * meters, a butter's turn in 45° steps and whether its press counts yet.
   */
  private updateSlide(sc: ScoreState, rails: readonly RailShape[]): void {
    const b = sc.butter;
    const key = sc.rail.active
      ? Math.floor(sc.rail.meters)
      : b.active
        ? -2 - 2 * Math.floor((Math.abs(b.turn) * 180) / Math.PI / 45) - (b.time >= CONFIG.score.butterPressMin ? 1 : 0)
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
