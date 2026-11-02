import '../ui/leaderboards.css';
import type { Outfit } from '../core/outfit.ts';
import type { MapId } from '../maps/registry.ts';
import { FinishBoard } from '../ui/finishBoard.ts';
import { LeaderboardScreen } from '../ui/leaderboardScreen.ts';
import { boardFor, post, type BoardRef, type PostResult } from './boards.ts';
import { encodeLook, setLookTables, type LookTables } from './look.ts';

// The online leaderboards' lazy chunk: main.ts imports this only when a
// board opens or a score posts, so the first load never fetches it, and a
// failed import (offline before it was ever loaded) leaves the game as it
// was. It holds the Leaderboards screen, the finish-line board, and the
// posts made this visit.

export interface OnlineHooks {
  /** The name to post under ('' for none: nothing posts). */
  myName: () => string;
  /** The skier's look now (posted with each score). */
  outfit: () => Outfit;
  /** What a look's letters and digits index (see online/look.ts). */
  lookTables: LookTables;
  /** Where the finish-line board goes, beside "Finished!" (RunHud.boardSlot). */
  finishSlot: HTMLElement;
  /** Esc or Back on the Leaderboards screen. */
  back: () => void;
  /** The finish board's ✕ was clicked. */
  closeFinish: () => void;
}

export interface Online {
  screen: LeaderboardScreen;
  finish: FinishBoard;
  /** The board for a map (on the Slalom, a course), clean or with cheats. */
  ref: (map: MapId, course: number, cheats: boolean) => BoardRef;
  /** Posts a banked combo or a course time (ms) under the player's name, if they have one. */
  post: (ref: BoardRef, value: number) => void;
}

export function createOnline(hooks: OnlineHooks): Online {
  setLookTables(hooks.lookTables);
  /** Each board's latest post this visit: when it started, and how it went (a promise while going). */
  const posts = new Map<string, { at: number; state: Promise<PostResult> | PostResult | 'error' }>();
  const keyOf = (ref: BoardRef): string => `${ref.board.id}${ref.cheats ? '-cheats' : ''}`;

  const screen = new LeaderboardScreen(hooks.myName, hooks.back);
  const finish = new FinishBoard(hooks.finishSlot, {
    myName: hooks.myName,
    postFor: (ref, since) => {
      const p = posts.get(keyOf(ref));
      return p && p.at >= since ? p.state : null;
    },
    close: hooks.closeFinish,
  });

  return {
    screen,
    finish,
    ref: (map, course, cheats) => ({ board: boardFor(map, course), cheats }),
    post: (ref, value) => {
      const name = hooks.myName();
      if (!name) return;
      const key = keyOf(ref);
      const going = post(ref, name, value, encodeLook(hooks.outfit()));
      const record = { at: performance.now(), state: going as Promise<PostResult> | PostResult | 'error' };
      posts.set(key, record);
      going.then(
        (result) => (record.state = result),
        () => (record.state = 'error'),
      ).finally(() => {
        // A combo can bank after the finish board opened: show it with the new score.
        if (posts.get(key) === record && finish.showing(ref)) finish.reshow();
      });
    },
  };
}
