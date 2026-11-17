import type { Action, Bindings } from '../core/input.ts';
import { RIDE } from '../sim/tuning.ts';

// Names for keys and actions, as the menus and HUD show them. Keys are
// KeyboardEvent.code values, named by their place on a US keyboard.

const NAMED: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Right Alt',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Insert: 'Insert',
  IntlBackslash: '\\',
};

/** A short name for the key with this code: "Q", "←", "Shift", "Num 4". */
export function keyName(code: string): string {
  const named = NAMED[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** What each action does, as Settings lists it. */
export const ACTION_NAMES: Record<Action, string> = {
  left: 'Turn or spin left',
  right: 'Turn or spin right',
  up: 'Front flip',
  down: 'Brake, back flip',
  pop: 'Crouch and pop',
  pole: 'Pole push / tuck',
  lincolnLeft: 'Lincoln loop left',
  lincolnRight: 'Lincoln loop right',
  checkpoint: 'Set checkpoint',
  respawn: 'Respawn (hold for top)',
  confirm: 'Back to top at the finish',
  trailMap: 'Corner map',
  board: 'Leaderboard at the finish',
  camera: 'Camera: chase or first person',
  pause: 'Pause',
  grabLeftMute: 'Left mute',
  grabLeftSafety: 'Left safety',
  grabLeftJapan: 'Left japan',
  grabLeftTail: 'Left tail',
  grabRightMute: 'Right mute',
  grabRightSafety: 'Right safety',
  grabRightJapan: 'Right japan',
  grabRightTail: 'Right tail',
  grabLeftNose: 'Left nose',
  grabRightNose: 'Right nose',
  styleSeaman: "Screamin' seaman",
  styleDaffy: 'Daffy',
  styleIronCross: 'Iron cross',
  styleSpreadEagle: 'Spread eagle',
};

/**
 * On a snowboard (milestone 22) the same keys do a snowboarder's tricks: the
 * top row of grab keys is the front hand's, the bottom row the rear hand's
 * (the same for regular and goofy), the style keys take board moves, and
 * the Lincoln loop keys roll over the heels (a wildcat) or the toes (a
 * tamedog), which side depending on the stance.
 */
const BOARD_NAMES: Partial<Record<Action, string>> = {
  down: 'Brake, back flip',
  pole: 'Foot push / tuck',
  grabLeftMute: 'Mute',
  grabLeftSafety: 'Melon',
  grabLeftJapan: 'Method',
  grabLeftTail: 'Japan',
  grabRightMute: 'Indy',
  grabRightSafety: 'Stalefish',
  grabRightJapan: 'Roast beef',
  grabRightTail: 'Tail grab',
  grabLeftNose: 'Nose grab',
  grabRightNose: 'Crail',
  styleSeaman: 'Shifty',
  styleDaffy: 'Poke',
  styleIronCross: 'Rocket air',
  styleSpreadEagle: 'Stiffy',
};

/** What an action does on what the rider stands on now: a board's names on a board, else ACTION_NAMES. */
export function actionName(action: Action): string {
  if (!RIDE.board) return ACTION_NAMES[action];
  // Rolling left (Q) goes over the board's left edge: the heels, riding regular.
  if (action === 'lincolnLeft') return RIDE.goofy ? 'Tamedog' : 'Wildcat';
  if (action === 'lincolnRight') return RIDE.goofy ? 'Wildcat' : 'Tamedog';
  return BOARD_NAMES[action] ?? ACTION_NAMES[action];
}

/** The name of an action's main key, or "none" when it has no key. */
export function mainKey(bindings: Bindings, action: Action): string {
  const code = bindings[action][0];
  return code ? keyName(code) : 'none';
}

/** A keycap element. */
export function keycap(label: string): HTMLElement {
  const el = document.createElement('kbd');
  el.className = 'key';
  el.textContent = label;
  return el;
}
