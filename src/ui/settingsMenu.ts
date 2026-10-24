import { DEFAULT_BINDINGS, type Action, type Bindings } from '../core/input.ts';
import { assignKey, clearSecondKey, KEY_SLOTS, QUALITIES, type Quality, type Settings } from '../core/settings.ts';
import { CONFIG } from '../config.ts';
import { ACTION_NAMES, keyName, mainKey } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Settings screen: the quality preset (applied at once), sound volumes
// and mute (saved for milestone 7's sounds), and a key for every action.
// Changing a key listens for the next key pressed: Esc is refused (it stays
// the menu and pause key), and a key another action has swaps the two.

const QUALITY_TEXT: Record<Quality, [string, string]> = {
  auto: ['Auto', 'The same as Medium for now.'],
  low: ['Low', 'Shortest view and the fewest trees. Best for Chromebooks.'],
  medium: ['Medium', 'A longer view and more trees.'],
  high: ['High', 'The longest view and every tree. For fast computers.'],
};

const KEY_GROUPS: readonly (readonly [string, readonly Action[]])[] = [
  ['Riding', ['left', 'right', 'up', 'down', 'pole']],
  ['Tricks', ['lincolnLeft', 'lincolnRight']],
  [
    'Grabs',
    [
      'grabLeftMute',
      'grabLeftSafety',
      'grabLeftJapan',
      'grabLeftTail',
      'grabLeftNose',
      'grabRightMute',
      'grabRightSafety',
      'grabRightJapan',
      'grabRightTail',
      'grabRightNose',
    ],
  ],
  ['Style moves', ['styleSeaman', 'styleDaffy', 'styleIronCross', 'styleSpreadEagle']],
  ['Run', ['checkpoint', 'respawn', 'confirm', 'trailMap', 'pause']],
];

/** Keys that can't be bound: Esc (menus and pause) and the system's own keys. */
const REFUSED: Record<string, string> = {
  Escape: 'Esc stays the menu and pause key. Pick another key.',
  MetaLeft: 'That key belongs to the system. Pick another key.',
  MetaRight: 'That key belongs to the system. Pick another key.',
  OSLeft: 'That key belongs to the system. Pick another key.',
  OSRight: 'That key belongs to the system. Pick another key.',
  ContextMenu: 'That key belongs to the system. Pick another key.',
};

export interface SettingsHooks {
  /** The settings as they are now. */
  get: () => Settings;
  setQuality: (q: Quality) => void;
  setSound: (master: number, sfx: number, muted: boolean) => void;
  /** After a crash: wait for the respawn key (true) or respawn by itself. */
  setCrashWait: (wait: boolean) => void;
  setBindings: (b: Bindings) => void;
  /** Hands the next key pressed to `fn` and nothing else (null: stop listening). */
  trapNextKey: (fn: ((e: KeyboardEvent) => void) | null) => void;
}

export class SettingsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly qualityButtons = new Map<Quality, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly master: HTMLInputElement;
  private readonly sfx: HTMLInputElement;
  private readonly masterValue: HTMLElement;
  private readonly sfxValue: HTMLElement;
  private readonly mute: HTMLButtonElement;
  private readonly crashButtons = new Map<boolean, HTMLButtonElement>();
  private readonly crashNote: HTMLElement;
  private readonly slots = new Map<string, HTMLButtonElement>();
  private readonly status: HTMLElement;
  private listening: HTMLButtonElement | null = null;
  private readonly hooks: SettingsHooks;

  constructor(hooks: SettingsHooks, onBack: () => void) {
    this.hooks = hooks;
    const b = board('Settings', 'settings-screen');
    this.el = b.el;
    addBackButton(b.head, onBack);

    // Picture.
    const picture = section('Picture');
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Quality');
    for (const q of QUALITIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment';
      btn.textContent = QUALITY_TEXT[q][0];
      btn.addEventListener('click', () => {
        this.hooks.setQuality(q);
        this.syncQuality();
      });
      btn.addEventListener('focus', () => this.showQualityNote(q));
      btn.addEventListener('blur', () => this.showQualityNote(this.hooks.get().quality));
      group.appendChild(btn);
      this.qualityButtons.set(q, btn);
    }
    this.qualityNote = document.createElement('p');
    this.qualityNote.className = 'setting-note';
    picture.append(labelRow('Quality', group), this.qualityNote);

    // Sound.
    const sound = section('Sound');
    [this.master, this.masterValue] = slider('Master volume');
    [this.sfx, this.sfxValue] = slider('Effects volume');
    for (const input of [this.master, this.sfx]) {
      input.addEventListener('input', () => this.syncSoundLabels());
      input.addEventListener('change', () => this.commitSound());
    }
    this.mute = document.createElement('button');
    this.mute.type = 'button';
    this.mute.className = 'toggle';
    this.mute.addEventListener('click', () => {
      this.mute.setAttribute('aria-pressed', String(this.mute.getAttribute('aria-pressed') !== 'true'));
      this.commitSound();
    });
    const soonNote = document.createElement('p');
    soonNote.className = 'setting-note';
    soonNote.textContent = 'There are no sounds yet. These are saved for when they arrive.';
    sound.append(
      labelRow('Master volume', this.master, this.masterValue),
      labelRow('Effects volume', this.sfx, this.sfxValue),
      labelRow('Mute', this.mute),
      soonNote,
    );

    // Crashes: respawn by itself after the tumble, or stay down until the respawn key.
    const crashes = section('Crashes');
    const crashGroup = document.createElement('div');
    crashGroup.className = 'segmented';
    crashGroup.setAttribute('role', 'group');
    crashGroup.setAttribute('aria-label', 'After a crash');
    for (const [wait, text] of [
      [false, 'Respawn by itself'],
      [true, 'Wait for respawn key'],
    ] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        this.hooks.setCrashWait(wait);
        this.syncCrash();
      });
      crashGroup.appendChild(btn);
      this.crashButtons.set(wait, btn);
    }
    this.crashNote = document.createElement('p');
    this.crashNote.className = 'setting-note';
    crashes.append(labelRow('After a crash', crashGroup), this.crashNote);

    // Keys.
    const keys = section('Keys');
    keys.classList.add('keys-section');
    const table = document.createElement('table');
    table.className = 'keys-table';
    table.innerHTML = '<thead><tr><th scope="col">Action</th><th scope="col">Key</th><th scope="col">Second key</th></tr></thead>';
    for (const [name, actions] of KEY_GROUPS) {
      const tbody = document.createElement('tbody');
      tbody.innerHTML = `<tr class="keys-group"><th scope="rowgroup" colspan="3">${name}</th></tr>`;
      for (const action of actions) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = ACTION_NAMES[action];
        tr.appendChild(th);
        for (let slot = 0; slot < KEY_SLOTS; slot++) {
          const td = document.createElement('td');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'key-slot';
          btn.dataset.action = action;
          btn.dataset.slot = String(slot);
          btn.addEventListener('click', () => this.listen(btn, action, slot));
          td.appendChild(btn);
          tr.appendChild(td);
          this.slots.set(`${action}:${slot}`, btn);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'plank plank-small';
    reset.textContent = 'Reset keys to defaults';
    reset.addEventListener('click', () => {
      this.stopListening();
      this.hooks.setBindings({ ...DEFAULT_BINDINGS });
      this.syncKeys();
      this.say('Every key is back to its default.');
    });
    this.status = document.createElement('p');
    this.status.className = 'board-status';
    this.status.setAttribute('aria-live', 'polite');
    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    tableWrap.appendChild(table);
    keys.append(tableWrap, this.status, reset);

    const columns = document.createElement('div');
    columns.className = 'settings-columns';
    const left = document.createElement('div');
    left.className = 'settings-column';
    left.append(picture, sound, crashes);
    columns.append(left, keys);
    b.body.appendChild(columns);
    setHints(b.foot, [
      [['↑', '↓', '←', '→'], 'Choose'],
      [['Enter'], 'Pick or change a key'],
      [['Delete'], 'Clear a second key'],
      [['Esc'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.syncQuality();
    const s = this.hooks.get();
    this.master.value = String(Math.round(s.masterVolume * 100));
    this.sfx.value = String(Math.round(s.sfxVolume * 100));
    this.mute.setAttribute('aria-pressed', String(s.muted));
    this.syncSoundLabels();
    this.syncKeys();
    this.status.textContent = '';
    return this.qualityButtons.get(s.quality) ?? null;
  }

  leave(): void {
    this.stopListening();
  }

  /** Delete or Backspace on a second-key slot clears it. */
  onKey(e: KeyboardEvent): boolean {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    const el = document.activeElement;
    if (!(el instanceof HTMLButtonElement) || !el.classList.contains('key-slot') || el.dataset.slot !== '1') return false;
    const action = el.dataset.action as Action;
    const b = this.hooks.get().bindings;
    if (b[action].length < 2) return true;
    this.hooks.setBindings(clearSecondKey(b, action));
    this.syncKeys();
    this.say(`${ACTION_NAMES[action]}: second key cleared.`);
    return true;
  }

  private listen(btn: HTMLButtonElement, action: Action, slot: number): void {
    this.stopListening();
    this.listening = btn;
    btn.classList.add('is-listening');
    btn.textContent = 'Press a key';
    this.say(`Press the new key for ${ACTION_NAMES[action]}. Click anywhere to cancel.`);
    this.hooks.trapNextKey((e) => {
      this.listening = null;
      window.removeEventListener('pointerdown', this.cancelOnClick, true);
      const refused = REFUSED[e.code] ?? (e.key === 'Escape' ? REFUSED.Escape : undefined);
      if (refused) {
        this.syncKeys();
        this.say(refused);
        btn.focus();
        return;
      }
      const result = assignKey(this.hooks.get().bindings, action, slot, e.code);
      this.hooks.setBindings(result.bindings);
      this.syncKeys();
      const key = keyName(e.code);
      const d = result.displaced;
      if (!d) this.say(`${ACTION_NAMES[action]}: ${key}.`);
      else if (d.unbound) this.say(`${key} was the key for ${ACTION_NAMES[d.action]}, which has no key now. Give it one below.`);
      else this.say(`${key} was the key for ${ACTION_NAMES[d.action]}, so the two swapped: ${ACTION_NAMES[d.action]} is now ${keyName(d.now ?? '')}.`);
      btn.focus();
    });
    window.addEventListener('pointerdown', this.cancelOnClick, true);
  }

  private readonly cancelOnClick = (): void => {
    this.stopListening();
    this.say('');
  };

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = null;
    this.hooks.trapNextKey(null);
    window.removeEventListener('pointerdown', this.cancelOnClick, true);
    this.syncKeys();
  }

  private syncCrash(): void {
    const s = this.hooks.get();
    for (const [wait, btn] of this.crashButtons) btn.setAttribute('aria-pressed', String(wait === s.crashWait));
    const key = mainKey(s.bindings, 'respawn');
    this.crashNote.textContent = s.crashWait
      ? `You stay down in the snow until you press ${key}.`
      : `You respawn at your last checkpoint about ${CONFIG.bail.respawnDelay} s after the tumble starts (${key} skips the wait).`;
  }

  private syncQuality(): void {
    const q = this.hooks.get().quality;
    for (const [id, btn] of this.qualityButtons) btn.setAttribute('aria-pressed', String(id === q));
    this.showQualityNote(q);
  }

  private showQualityNote(q: Quality): void {
    this.qualityNote.textContent = `${QUALITY_TEXT[q][0]}: ${QUALITY_TEXT[q][1]}`;
  }

  private syncSoundLabels(): void {
    this.masterValue.textContent = `${this.master.value}%`;
    this.sfxValue.textContent = `${this.sfx.value}%`;
    this.mute.textContent = this.mute.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off';
  }

  private commitSound(): void {
    this.syncSoundLabels();
    this.hooks.setSound(Number(this.master.value) / 100, Number(this.sfx.value) / 100, this.mute.getAttribute('aria-pressed') === 'true');
  }

  private syncKeys(): void {
    this.syncCrash();
    const b = this.hooks.get().bindings;
    for (const btn of this.slots.values()) {
      const action = btn.dataset.action as Action;
      const slot = Number(btn.dataset.slot);
      const code = b[action][slot];
      btn.classList.remove('is-listening');
      btn.classList.toggle('is-empty', !code);
      btn.textContent = code ? keyName(code) : slot === 0 ? 'none' : 'Add';
      btn.setAttribute('aria-label', `${ACTION_NAMES[action]}, ${slot === 0 ? 'key' : 'second key'}: ${code ? keyName(code) : 'none'}. Press Enter to change.`);
    }
  }

  private say(text: string): void {
    this.status.textContent = text;
  }
}

function section(title: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'settings-section';
  const h = document.createElement('h2');
  h.textContent = title;
  el.appendChild(h);
  return el;
}

function labelRow(label: string, ...controls: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const name = document.createElement('span');
  name.className = 'setting-label';
  name.textContent = label;
  const box = document.createElement('div');
  box.className = 'setting-control';
  box.append(...controls);
  row.append(name, box);
  return row;
}

function slider(label: string): [HTMLInputElement, HTMLElement] {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.className = 'slider';
  input.setAttribute('aria-label', label);
  const value = document.createElement('output');
  value.className = 'slider-value';
  return [input, value];
}
