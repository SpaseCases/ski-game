import { nameKey } from '../core/playerName.ts';
import { RANK_LIMIT, type BoardKind, type Entry } from '../online/boards.ts';
import { lookSvg } from '../online/look.ts';
import { formatTime } from './raceHud.ts';

// The rows of a leaderboard, shared by the Leaderboards screen and the
// finish-line board: rank, the skier's look, name and score. The top three
// carry trail signs (double black diamond, black diamond, blue square), and
// the player's own row is marked like a focused plank. Part of the lazy
// leaderboard chunk.

const MARKS: Record<number, string> = {
  1: '<svg viewBox="0 0 22 10" width="22" height="10" aria-hidden="true"><path d="M5 0 10 5 5 10 0 5zM17 0l5 5-5 5-5-5z" fill="#0d1622" stroke="#f4f8fc" stroke-width="1"/></svg>',
  2: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 0 10 5 5 10 0 5z" fill="#0d1622" stroke="#f4f8fc" stroke-width="1"/></svg>',
  3: '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="#2f7fe0" stroke="#f4f8fc" stroke-width="1"/></svg>',
};
const MARK_NAMES: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third' };

export function scoreText(kind: BoardKind, value: number): string {
  return kind === 'combo' ? value.toLocaleString('en-US') : formatTime(value / 1000);
}

export function rankText(rank: number): string {
  return Number.isFinite(rank) ? String(rank) : `${RANK_LIMIT}+`;
}

/**
 * Fills `list` with `entries`, then `mine` under a gap if it isn't among
 * them. `myName` marks the player's row ('' for none).
 */
export function fillRows(list: HTMLElement, kind: BoardKind, entries: readonly Entry[], myName: string, mine: Entry | null = null): void {
  const me = myName ? nameKey(myName) : null;
  const rows = entries.map((e) => row(kind, e, me));
  if (mine && !entries.some((e) => nameKey(e.name) === nameKey(mine.name))) {
    const gap = document.createElement('li');
    gap.className = 'lb-gap';
    gap.setAttribute('aria-hidden', 'true');
    rows.push(gap, row(kind, mine, me));
  }
  list.replaceChildren(...rows);
}

function row(kind: BoardKind, e: Entry, me: string | null): HTMLElement {
  const li = document.createElement('li');
  li.className = 'lb-row';
  if (me !== null && nameKey(e.name) === me) li.classList.add('is-me');
  const rank = document.createElement('span');
  rank.className = 'lb-rank';
  const mark = MARKS[e.rank];
  if (mark) {
    rank.innerHTML = mark;
    rank.title = MARK_NAMES[e.rank]!;
  }
  rank.append(rankText(e.rank));
  const look = document.createElement('span');
  look.className = 'lb-look-box';
  look.innerHTML = lookSvg(e.look);
  const name = document.createElement('span');
  name.className = 'lb-name';
  name.textContent = e.name;
  const score = document.createElement('span');
  score.className = 'lb-score';
  score.textContent = scoreText(kind, e.value);
  li.append(rank, look, name, score);
  return li;
}
