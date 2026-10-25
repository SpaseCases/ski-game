import { GRAB_ACTIONS } from '../core/input.ts';
import type { ScoreEvent } from '../sim/score.ts';
import { ACTION_NAMES } from './keyNames.ts';

// Words for scoring events, shared by the HUD and the headless tools.

/** "Cork 720 · Left mute", "Box slide 6 m", "Right japan". */
export function trickText(ev: ScoreEvent): string {
  let text = ev.meters > 0 ? `${ev.name} ${Math.round(ev.meters)} m` : ev.name;
  for (let i = 0; i < ev.grabCount; i++) {
    const grab = ACTION_NAMES[GRAB_ACTIONS[ev.grabs[i]!]!];
    text += i === 0 ? (text === '' ? grab : ` · ${grab}`) : ` + ${grab}`;
  }
  return text;
}

/** The notes after a trick: how it landed, switch, repeated. */
export function trickTags(ev: ScoreEvent): string {
  const tags: string[] = [];
  if (ev.landing === 'clean') tags.push('Clean');
  else if (ev.landing === 'sketchy') tags.push('Sketchy');
  if (ev.switchOut) tags.push('Switch landing');
  if (ev.repeat > 0) tags.push(ev.repeat === 1 ? 'Repeat' : `Repeat ×${ev.repeat}`);
  return tags.join(' · ');
}

/** 12400 → "12,400". */
export function pointsText(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** A multiplier: "×4", "×3.5", "×2.75". */
export function multText(m: number): string {
  return `×${Math.round(m * 100) / 100}`;
}
