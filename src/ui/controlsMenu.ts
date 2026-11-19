import type { Action, Bindings } from '../core/input.ts';
import type { Settings } from '../core/settings.ts';
import { RIDE } from '../sim/tuning.ts';
import { actionName, INPUT_LOOK, keycap, keyName, padcap, padName } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Controls screen: GAME_DESIGN.md's key tables, built from the current
// bindings and the Pop with setting each time it opens, so rebound keys show
// as they are. A plank at the top opens the key tester. On a snowboard
// (milestone 22) the tables say what the keys do on a board.

/** A key cell: the action keys as keycaps, joined by `/` for a pair like left / right. */
type Keys = readonly (Action | 'Esc' | '/')[];

interface Row {
  keys: Keys;
  /** Extra words after the keys ("hold, then release"). */
  note?: string;
  ground: string;
  /** Absent: the same as on the ground, in every state. */
  air?: string;
  rail?: string;
}

/** The riding rows; `popKey` is the key that pops now (the pop key, or ↑ with "Pop with: ↑"). */
function rows(popWithUp: boolean, popKey: string): Row[] {
  const pop: Row = { keys: ['pop'], note: 'hold, then release', ground: 'Crouch (less drag), then pop (↓ while crouching: no pop)', air: '', rail: 'Crouch, then pop off' };
  const board = RIDE.board;
  return [
    board
      ? { keys: ['left', '/', 'right'], ground: 'Turn (onto the heel or toe edge)', air: 'Spin frontside or backside', rail: 'Turn the board (along: 50-50; across: board or lipslide)' }
      : { keys: ['left', '/', 'right'], ground: 'Turn', air: 'Spin left or right', rail: 'Turn the skis (any angle)' },
    ...(popWithUp ? [] : [pop]),
    popWithUp ? { ...pop, keys: ['up'], air: 'Front flip' } : { keys: ['up'], ground: '', air: 'Front flip (hold it off the lip)', rail: '' },
    { keys: ['down'], ground: 'Brake', air: 'Back flip', rail: 'Brake' },
    board
      ? { keys: ['pole'], ground: `Push with the back foot; tuck once fast (${popKey} from a tuck pops at full strength)`, air: '', rail: '' }
      : { keys: ['pole'], ground: `Pole push; tuck once fast (${popKey} from a tuck pops at full strength)`, air: '', rail: '' },
    ...(board
      ? [{ keys: ['lincolnLeft', '/', 'lincolnRight'] as Keys, ground: '', air: `${actionName('lincolnLeft')} or ${actionName('lincolnRight')} (a flip over the heels or the toes)`, rail: '' }, ...OTHER_ROWS.slice(1)]
      : OTHER_ROWS),
  ];
}

const OTHER_ROWS: readonly Row[] = [
  { keys: ['lincolnLeft', '/', 'lincolnRight'], ground: '', air: 'Lincoln loop left or right', rail: '' },
  { keys: ['checkpoint'], ground: 'Set your checkpoint', air: '', rail: '' },
  { keys: ['respawn'], ground: 'Back to your last checkpoint (hold 1 s: back to the top)' },
  { keys: ['trailMap'], ground: 'Corner trail map on Freeride and the City: show or hide (the full map of any map is in the pause menu)' },
  { keys: ['board'], ground: 'At the finish: hide or show the leaderboard' },
  { keys: ['camera'], ground: 'Switch between the chase camera and first person (also in the air, on rails and on the chairlift)' },
  { keys: ['chat'], ground: 'In a multiplayer lobby: open the chat (Enter sends, Esc closes)' },
  { keys: ['Esc', '/', 'pause'], ground: 'Pause menu (in fullscreen the browser takes Esc, so use the pause key)' },
];

const GRABS: readonly (readonly [Action, string, Action, string])[] = [
  ['grabLeftMute', 'Left mute', 'grabRightMute', 'Right mute'],
  ['grabLeftSafety', 'Left safety', 'grabRightSafety', 'Right safety'],
  ['grabLeftJapan', 'Left japan', 'grabRightJapan', 'Right japan'],
  ['grabLeftTail', 'Left tail', 'grabRightTail', 'Right tail'],
  ['grabLeftNose', 'Left nose', 'grabRightNose', 'Right nose'],
];

/** On a board: the front hand's row of grab keys, then the rear hand's (the names come from actionName). */
const BOARD_GRABS: readonly (readonly [Action, Action])[] = [
  ['grabLeftMute', 'grabRightMute'],
  ['grabLeftSafety', 'grabRightSafety'],
  ['grabLeftJapan', 'grabRightJapan'],
  ['grabLeftTail', 'grabRightTail'],
  ['grabLeftNose', 'grabRightNose'],
];

const BOARD_STYLE: readonly (readonly [Action, string])[] = [
  ['styleSeaman', 'The board turned about 70° under the hips, shoulders still'],
  ['styleDaffy', 'The front leg kicked straight, the nose boned out'],
  ['styleIronCross', 'Both hands on the nose, the board stood up in front'],
  ['styleSpreadEagle', 'Both legs straight, the board flat out under you'],
];

const STYLE: readonly (readonly [Action, string, string])[] = [
  ['styleSeaman', "Screamin' seaman", 'A daffy with the legs crossed: one ski forward, one back, crossed over'],
  ['styleDaffy', 'Daffy', 'One ski forward, one back, like running in the air'],
  ['styleIronCross', 'Iron cross', 'Heels up behind, skis crossed in an X behind the legs'],
  ['styleSpreadEagle', 'Spread eagle', 'Arms and legs flung out wide'],
];

export class ControlsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tester: HTMLElement;
  private readonly settings: () => Settings;
  /** One more table after the style moves, when this returns one (milestone 25: set by main, filled only for the developer). */
  extra: (() => HTMLElement | null) | null = null;

  constructor(settings: () => Settings, onTester: () => void, onPadTester: () => void, onBack: () => void) {
    this.settings = settings;
    const b = board('Controls', 'controls-screen');
    this.el = b.el;
    this.body = b.body;
    addBackButton(b.head, onBack);
    // The key tester: laptop keyboards can't report some keys held together.
    this.tester = document.createElement('div');
    this.tester.className = 'tester-intro';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'plank plank-small';
    open.textContent = 'Key tester';
    open.addEventListener('click', onTester);
    // Milestone 26: the controller tester beside it.
    const openPad = document.createElement('button');
    openPad.type = 'button';
    openPad.className = 'plank plank-small';
    openPad.textContent = 'Controller tester';
    openPad.addEventListener('click', onPadTester);
    const about = document.createElement('p');
    about.className = 'setting-note';
    about.textContent = 'Some keyboards can’t tell when certain keys are held together. Hold your usual combos in the tester to see which ones yours drops. The controller tester shows each button and stick as the browser reads it.';
    this.tester.append(open, openPad, about);
    setHints(b.foot, [
      [['↑', '↓'], 'Scroll'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.build();
    return this.tester.querySelector('button');
  }

  prebuild(): void {
    this.build();
  }

  /** Arrows and Page Up / Down scroll the tables (there's nothing to focus but Back). */
  onKey(e: KeyboardEvent): boolean {
    const step = { ArrowUp: -60, ArrowDown: 60, PageUp: -400, PageDown: 400 }[e.key];
    const scroller = this.el.parentElement;
    if (step === undefined || !scroller) return false;
    scroller.scrollBy(0, step);
    return true;
  }

  private build(): void {
    const settings = this.settings();
    // With a pad used last (milestone 26) the tables name its buttons.
    const pad = INPUT_LOOK.pad;
    const keys = pad ? settings.padBindings : settings.bindings;
    const popWithUp = settings.popWith === 'up';
    const popKey = mainKeyName(keys, popWithUp ? 'up' : 'pop');
    const cell = (k: Keys): HTMLElement => {
      const td = document.createElement('th');
      td.scope = 'row';
      td.className = 'keys-cell';
      // A pad has no Esc: its pause button is the pause action's.
      const parts = pad ? k.filter((p, i) => p !== 'Esc' && !(p === '/' && k[i - 1] === 'Esc')) : k;
      for (const part of parts) {
        if (part === '/') td.append(document.createTextNode(' / '));
        else if (part === 'Esc') td.append(keycap('Esc'));
        else {
          const codes = keys[part];
          if (codes.length === 0) td.append(keycap('none'));
          codes.forEach((code, i) => {
            if (i > 0) td.append(document.createTextNode(' '));
            td.append(pad ? padcap(padName(code)) : keycap(keyName(code)));
          });
        }
      }
      return td;
    };

    const main = document.createElement('table');
    main.className = 'controls-table';
    main.innerHTML = `<caption>Riding</caption><thead><tr><th scope="col">${pad ? 'Button' : 'Key'}</th><th scope="col">On the snow</th><th scope="col">In the air</th><th scope="col">On a rail or box</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const row of rows(popWithUp, popKey)) {
      const tr = document.createElement('tr');
      const k = cell(row.keys);
      if (row.note) k.append(document.createTextNode(` ${row.note}`));
      tr.appendChild(k);
      if (row.air === undefined) {
        tr.appendChild(td(row.ground, 3));
      } else {
        tr.append(td(row.ground), td(row.air), td(row.rail ?? ''));
      }
      tbody.appendChild(tr);
    }
    main.appendChild(tbody);

    const grabs = document.createElement('table');
    grabs.className = 'controls-table grabs-table';
    const board = RIDE.board;
    grabs.innerHTML = `<caption>Grabs (hold in the air, let go to release)</caption><thead><tr><th scope="col">${pad ? 'Button' : 'Key'}</th><th scope="col">${board ? 'Front hand' : 'Left hand'}</th><th scope="col">${pad ? 'Button' : 'Key'}</th><th scope="col">${board ? 'Rear hand' : 'Right hand'}</th></tr></thead>`;
    const gbody = document.createElement('tbody');
    for (const [la, ln, ra, rn] of board ? BOARD_GRABS.map(([f, r]) => [f, actionName(f), r, actionName(r)] as const) : GRABS) {
      const tr = document.createElement('tr');
      tr.append(cell([la]), td(ln), cell([ra]), td(rn));
      gbody.appendChild(tr);
    }
    grabs.appendChild(gbody);

    const style = document.createElement('table');
    style.className = 'controls-table grabs-table';
    style.innerHTML = `<caption>Style moves (hold in the air, let go to release)</caption><thead><tr><th scope="col">${pad ? 'Button' : 'Key'}</th><th scope="col">Move</th><th scope="col">What it looks like</th></tr></thead>`;
    const sbody = document.createElement('tbody');
    for (const [action, name, look] of board ? BOARD_STYLE.map(([a, look]) => [a, actionName(a), look] as const) : STYLE) {
      const tr = document.createElement('tr');
      tr.append(cell([action]), td(name), td(look));
      sbody.appendChild(tr);
    }
    style.appendChild(sbody);

    const tips = document.createElement('ul');
    tips.className = 'controls-tips';
    for (const text of [
      'Hold a spin key and a flip key together to tilt the spin: that makes corks and misty flips.',
      'Spins and flips keep going while the key is held and slow down after you let go. Let go early to time the landing.',
      board
        ? `Butter on the snow: hold ${mainKeys(keys, 'grabLeftNose', 'grabRightNose')} to press onto the nose or ${mainKeys(keys, 'grabLeftTail', 'grabRightTail')} onto the tail. ← → pivot the board; releasing ${popKey} pops off that end (a nollie or an ollie). On a rail they're a nose or tail press.`
        : `Butter on the snow: hold a nose grab key (${mainKeys(keys, 'grabLeftNose', 'grabRightNose')}) to press onto your tips or a tail grab key (${mainKeys(keys, 'grabLeftTail', 'grabRightTail')}) onto your tails. ← → pivot the skis; releasing ${popKey} pops off that end.`,
      board
        ? 'Land on a rail or box to slide it: along it is a 50-50; across it is a boardslide if the nose crossed over it, a lipslide if the tail did. Landing sideways to your travel on the snow crashes.'
        : 'Land on a rail or box to slide it. There is no grind button.',
      `At the finish, ${keys.confirm[0] ? (pad ? padName(keys.confirm[0]) : keyName(keys.confirm[0])) : 'the Back to top button'} takes you back to the top.`,
      'Drag the game view with the mouse to look around the skier.',
      pad
        ? `With a controller: the sticks count as the arrow keys once pushed past halfway. The right stick grabs (${padName('PadLT')} held: its second layer). In menus the d-pad or left stick moves, ${padName('PadA')} picks and ${padName('PadB')} goes back.`
        : 'A controller works too (Xbox, PlayStation and most USB pads): press a button on it and these tables name its buttons.',
      'Change any key or button, and whether Space or ↑ pops, in Settings.',
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      tips.appendChild(li);
    }

    const wrap = (t: HTMLElement): HTMLElement => {
      const div = document.createElement('div');
      div.className = 'table-wrap';
      div.appendChild(t);
      return div;
    };
    const extra = this.extra?.() ?? null;
    this.body.replaceChildren(this.tester, wrap(main), wrap(grabs), wrap(style), ...(extra ? [wrap(extra)] : []), tips);
  }
}

/** The main key (or with a pad used last, button) of an action ("none" when it has none). */
function mainKeyName(keys: Bindings, action: Action): string {
  const code = keys[action][0];
  return code ? (INPUT_LOOK.pad ? padName(code) : keyName(code)) : 'none';
}

/** The main keys of two actions, "G / B" (or "none"). */
function mainKeys(keys: Bindings, a: Action, b: Action): string {
  return `${mainKeyName(keys, a)} / ${mainKeyName(keys, b)}`;
}

function td(text: string, span = 1): HTMLTableCellElement {
  const el = document.createElement('td');
  el.textContent = text || '—';
  if (text === '') el.className = 'none';
  if (span > 1) el.colSpan = span;
  return el;
}
