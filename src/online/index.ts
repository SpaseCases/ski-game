import '../ui/leaderboards.css';
import '../ui/market.css';
import type { Outfit } from '../core/outfit.ts';
import type { MapId } from '../maps/registry.ts';
import { FinishBoard } from '../ui/finishBoard.ts';
import { LeaderboardScreen } from '../ui/leaderboardScreen.ts';
import { LookPrompt } from '../ui/lookPrompt.ts';
import { MarketPanel, type MarketHooks } from '../ui/marketPanel.ts';
import { ShareSign, SlotPicker, type ShareRequest } from '../ui/marketSigns.ts';
import type { Screen } from '../ui/menus.ts';
import { ApiError } from './api.ts';
import { checkCode } from './market.ts';
import { boardFor, post, type BoardRef, type PostResult } from './boards.ts';
import { encodeLook, setLookTables, type LookTables } from './look.ts';
import { fetchLook, saveLook, type SavedLook } from './looks.ts';

// The online leaderboards' lazy chunk: main.ts imports this only when a
// board opens or a score posts, so the first load never fetches it, and a
// failed import (offline before it was ever loaded) leaves the game as it
// was. It holds the Leaderboards screen, the finish-line board, the posts
// made this visit, and the looks saved online under board names; since
// milestone 24 the marketplace (the Locker's Market tab, the Share sign and
// the slot picker), whose game-side work main does through MarketHooks.

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
  /** Opens a screen over the one on top (main's menus). */
  push: (screen: Screen) => void;
  /** What the marketplace needs from the game (thumbnails, Use, the outfit to share). */
  market: MarketHooks;
}

export interface Online {
  screen: LeaderboardScreen;
  finish: FinishBoard;
  /** The board for a map (on the Slalom, a course), clean or with cheats. */
  ref: (map: MapId, course: number, cheats: boolean) => BoardRef;
  /** Posts a banked combo or a course time (ms) under the player's name, if they have one. */
  post: (ref: BoardRef, value: number) => void;
  /** The sign asking whether to load a name's saved look (main adds it to the menus). */
  lookPrompt: LookPrompt;
  fetchLook: (name: string) => Promise<SavedLook | null>;
  saveLook: (look: SavedLook) => Promise<boolean>;
  /** An outfit as the 13-character look its tiny skier is drawn from. */
  lookCode: (o: Outfit) => string;
  /** The Locker's Market tab's content (main mounts it). */
  market: MarketPanel;
  /** The marketplace's signs (main adds them to the menus). */
  shareSign: ShareSign;
  slotPicker: SlotPicker;
  /** Opens the Share sign on something to share. */
  openShare: (request: ShareRequest) => void;
  /** Whether the Worker takes the developer's code. */
  checkCode: (code: string) => Promise<'ok' | 'wrong' | 'offline'>;
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

  const shareSign = new ShareSign(hooks.back);
  const slotPicker = new SlotPicker(hooks.back);
  const market = new MarketPanel(
    hooks.market,
    (what, thumbs) =>
      new Promise((answer) => {
        slotPicker.ask(what, thumbs, answer);
        hooks.push(slotPicker);
      }),
  );

  return {
    screen,
    finish,
    market,
    shareSign,
    slotPicker,
    openShare: (request) => {
      shareSign.ask(request, hooks.myName());
      hooks.push(shareSign);
    },
    checkCode: (code) =>
      checkCode(code).then(
        () => 'ok' as const,
        (err: unknown) => (err instanceof ApiError && err.status === 403 ? ('wrong' as const) : ('offline' as const)),
      ),
    lookPrompt: new LookPrompt(),
    fetchLook,
    saveLook,
    lookCode: encodeLook,
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
