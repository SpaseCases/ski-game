import type { Action, Bindings } from '../core/input.ts';
import { keycap, keyName } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Controls screen: GAME_DESIGN.md's key tables, built from the current
// bindings each time it opens, so rebound keys show as they are.

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

const ROWS: readonly Row[] = [
  { keys: ['left', '/', 'right'], ground: 'Turn', air: 'Spin left or right', rail: 'Turn the skis (any angle)' },
  { keys: ['up'], note: 'hold, then release', ground: 'Crouch (less drag), then pop', air: 'Front flip', rail: 'Crouch, then pop off' },
  { keys: ['down'], ground: 'Brake', air: 'Back flip', rail: 'Brake' },
  { keys: ['pole'], ground: 'Pole push', air: '', rail: '' },
  { keys: ['lincolnLeft', '/', 'lincolnRight'], ground: '', air: 'Lincoln loop left or right', rail: '' },
  { keys: ['checkpoint'], ground: 'Set your checkpoint', air: '', rail: '' },
  { keys: ['respawn'], ground: 'Back to your last checkpoint (hold 1 s: back to the top)' },
  { keys: ['trailMap'], ground: 'Trail map (the game waits until you close it)' },
  { keys: ['Esc', '/', 'pause'], ground: 'Pause menu (in fullscreen the browser takes Esc, so use the pause key)' },
];

const GRABS: readonly (readonly [Action, string, Action, string])[] = [
  ['grabLeftMute', 'Left mute', 'grabRightMute', 'Right mute'],
  ['grabLeftSafety', 'Left safety', 'grabRightSafety', 'Right safety'],
  ['grabLeftJapan', 'Left japan', 'grabRightJapan', 'Right japan'],
  ['grabLeftTail', 'Left tail', 'grabRightTail', 'Right tail'],
  ['grabLeftNose', 'Left nose', 'grabRightNose', 'Right nose'],
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
  private readonly bindings: () => Bindings;

  constructor(bindings: () => Bindings, onBack: () => void) {
    this.bindings = bindings;
    const b = board('Controls', 'controls-screen');
    this.el = b.el;
    this.body = b.body;
    addBackButton(b.head, onBack);
    setHints(b.foot, [
      [['↑', '↓'], 'Scroll'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.build();
    return this.el.querySelector('.board-back');
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
    const keys = this.bindings();
    const cell = (k: Keys): HTMLElement => {
      const td = document.createElement('th');
      td.scope = 'row';
      td.className = 'keys-cell';
      for (const part of k) {
        if (part === '/') td.append(document.createTextNode(' / '));
        else if (part === 'Esc') td.append(keycap('Esc'));
        else {
          const codes = keys[part];
          if (codes.length === 0) td.append(keycap('none'));
          codes.forEach((code, i) => {
            if (i > 0) td.append(document.createTextNode(' '));
            td.append(keycap(keyName(code)));
          });
        }
      }
      return td;
    };

    const main = document.createElement('table');
    main.className = 'controls-table';
    main.innerHTML = '<caption>Riding</caption><thead><tr><th scope="col">Key</th><th scope="col">On the snow</th><th scope="col">In the air</th><th scope="col">On a rail or box</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const row of ROWS) {
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
    grabs.innerHTML = '<caption>Grabs (hold in the air, let go to release)</caption><thead><tr><th scope="col">Key</th><th scope="col">Left hand</th><th scope="col">Key</th><th scope="col">Right hand</th></tr></thead>';
    const gbody = document.createElement('tbody');
    for (const [la, ln, ra, rn] of GRABS) {
      const tr = document.createElement('tr');
      tr.append(cell([la]), td(ln), cell([ra]), td(rn));
      gbody.appendChild(tr);
    }
    grabs.appendChild(gbody);

    const style = document.createElement('table');
    style.className = 'controls-table grabs-table';
    style.innerHTML = '<caption>Style moves (hold in the air, let go to release)</caption><thead><tr><th scope="col">Key</th><th scope="col">Move</th><th scope="col">What it looks like</th></tr></thead>';
    const sbody = document.createElement('tbody');
    for (const [action, name, look] of STYLE) {
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
      `Butter on the snow: hold a nose grab key (${mainKeys(keys, 'grabLeftNose', 'grabRightNose')}) to press onto your tips or a tail grab key (${mainKeys(keys, 'grabLeftTail', 'grabRightTail')}) onto your tails. ← → pivot the skis; releasing ${keys.up[0] ? keyName(keys.up[0]) : '↑'} pops off that end.`,
      'Land on a rail or box to slide it. There is no grind button.',
      `At the finish, ${keys.confirm[0] ? keyName(keys.confirm[0]) : 'the Back to top button'} takes you back to the top.`,
      'Drag the game view with the mouse to look around the skier.',
      'Change any key in Settings.',
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
    this.body.replaceChildren(wrap(main), wrap(grabs), wrap(style), tips);
  }
}

/** The main keys of two actions, "G / B" (or "none"). */
function mainKeys(keys: Bindings, a: Action, b: Action): string {
  const name = (action: Action): string => (keys[action][0] ? keyName(keys[action][0]) : 'none');
  return `${name(a)} / ${name(b)}`;
}

function td(text: string, span = 1): HTMLTableCellElement {
  const el = document.createElement('td');
  el.textContent = text || '—';
  if (text === '') el.className = 'none';
  if (span > 1) el.colSpan = span;
  return el;
}
