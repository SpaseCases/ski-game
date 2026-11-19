import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS, type Action, type Bindings } from '../core/input.ts';
import { assignKey, clearSecondKey, KEY_SLOTS, QUALITIES, wantsAntialias, type CameraView, type FirstAir, type PopWith, type Quality, type Settings } from '../core/settings.ts';
import { CONFIG } from '../config.ts';
import { actionName, INPUT_LOOK, keyName, mainKey, mainPad, padName } from './keyNames.ts';
import { addBackButton, board, setHints, type Screen } from './menus.ts';

// The Settings screen: the quality preset (applied at once), sound volumes
// and mute, combo scoring on or off, which key pops, and a key for every
// action.
// Changing a key listens for the next key pressed: Esc is refused (it stays
// the menu and pause key), and a key another action has swaps the two.
// Since milestone 26 a Keyboard | Controller switch shows the pad's buttons
// in the same table instead, rebound the same way (listening for the next
// button or stick direction; LT then the right stick is the second layer).

const QUALITY_TEXT: Record<Quality, [string, string]> = {
  auto: ['Auto', 'Picks for this computer: starts on Medium and steps down while riding if the frame rate drops.'],
  low: ['Low', 'Shortest view and the fewest trees. Best for Chromebooks.'],
  medium: ['Medium', 'A longer view and more trees, sharper on high-resolution screens.'],
  high: ['High', 'The longest view, every tree, the sharpest picture and smooth edges. For fast computers.'],
};

const KEY_GROUPS: readonly (readonly [string, readonly Action[]])[] = [
  ['Riding', ['left', 'right', 'pop', 'up', 'down', 'pole']],
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
  ['Run', ['checkpoint', 'respawn', 'confirm', 'trailMap', 'board', 'camera', 'pause']],
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
  /** What Auto draws now ("Medium", "Low"...). */
  autoNow: () => string;
  /** Whether this start's picture has smooth edges (chosen once, when the game starts). */
  antialiased: () => boolean;
  setSound: (master: number, sfx: number, muted: boolean) => void;
  /** A slider moving: heard at once, not saved yet. */
  previewSound: (master: number, sfx: number, muted: boolean) => void;
  setScore: (on: boolean) => void;
  /** After a crash: wait for the respawn key (true) or respawn by itself. */
  setCrashWait: (wait: boolean) => void;
  /** Pop with the pop key or with ↑. */
  setPopWith: (key: PopWith) => void;
  /** The chase camera or first person (the camera key switches too). */
  setCamera: (view: CameraView) => void;
  /** First person in the air: head-locked or level. */
  setFirstAir: (air: FirstAir) => void;
  setBindings: (b: Bindings) => void;
  /** New controller buttons (milestone 26). */
  setPadBindings: (b: Bindings) => void;
  /** Hands every pad press and release to `fn` and nothing else (null: stop listening). */
  listenPad: (fn: ((code: string, down: boolean) => void) | null) => void;
  /** The Controls screen (what every key does, and the key tester). */
  openControls: () => void;
  /** Hands the next key pressed to `fn` and nothing else (null: stop listening). */
  trapNextKey: (fn: ((e: KeyboardEvent) => void) | null) => void;
  /** Erases everything the game saved in this browser and starts it again. */
  wipeLocal: () => void;
}

const WIPE_NOTE =
  'Settings, keys, your board name, your Locker look, custom skis, boards and clothes, best combos and weather are kept in this browser. Erasing them starts the game fresh. Scores and looks already posted online stay there.';
const WIPE_ARMED_NOTE = 'Press Erase everything to confirm. This can’t be undone.';

export class SettingsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly qualityButtons = new Map<Quality, HTMLButtonElement>();
  private readonly qualityNote: HTMLElement;
  private readonly master: HTMLInputElement;
  private readonly sfx: HTMLInputElement;
  private readonly masterValue: HTMLElement;
  private readonly sfxValue: HTMLElement;
  private readonly mute: HTMLButtonElement;
  private readonly score: HTMLButtonElement;
  private readonly crashButtons = new Map<boolean, HTMLButtonElement>();
  private readonly crashNote: HTMLElement;
  private readonly cameraButtons = new Map<CameraView, HTMLButtonElement>();
  private readonly airButtons = new Map<FirstAir, HTMLButtonElement>();
  private readonly cameraNote: HTMLElement;
  private readonly popButtons = new Map<PopWith, HTMLButtonElement>();
  private readonly popNote: HTMLElement;
  private readonly slots = new Map<string, HTMLButtonElement>();
  private readonly status: HTMLElement;
  private listening: HTMLButtonElement | null = null;
  /** Which bindings the table shows and changes: the keys, or the controller's buttons (milestone 26). */
  private view: 'keys' | 'pad' = 'keys';
  private readonly viewButtons = new Map<'keys' | 'pad', HTMLButtonElement>();
  private readonly slotHeads: HTMLElement[] = [];
  private readonly reset: HTMLButtonElement;
  private listenTimer = 0;
  private readonly wipe: HTMLButtonElement;
  private readonly wipeCancel: HTMLButtonElement;
  private readonly wipeNote: HTMLElement;
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
      // Heard at once while dragging; saved when let go.
      input.addEventListener('input', () => {
        this.syncSoundLabels();
        this.hooks.previewSound(...this.soundValues());
      });
      input.addEventListener('change', () => this.commitSound());
    }
    this.mute = document.createElement('button');
    this.mute.type = 'button';
    this.mute.className = 'toggle';
    this.mute.addEventListener('click', () => {
      this.mute.setAttribute('aria-pressed', String(this.mute.getAttribute('aria-pressed') !== 'true'));
      this.commitSound();
    });
    sound.append(
      labelRow('Master volume', this.master, this.masterValue),
      labelRow('Effects volume', this.sfx, this.sfxValue),
      labelRow('Mute', this.mute),
    );

    // Score.
    const scoring = section('Score');
    this.score = document.createElement('button');
    this.score.type = 'button';
    this.score.className = 'toggle';
    this.score.addEventListener('click', () => {
      const on = this.score.getAttribute('aria-pressed') !== 'true';
      this.score.setAttribute('aria-pressed', String(on));
      this.syncScoreLabel();
      this.hooks.setScore(on);
    });
    const scoreNote = document.createElement('p');
    scoreNote.className = 'setting-note';
    scoreNote.textContent = 'Points for tricks, grabs and rails, chained into combos. Your best combo on each map is saved. Not on the Slalom.';
    scoring.append(labelRow('Combo score', this.score), scoreNote);

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

    // Camera (milestone 18): chase or first person, and what first person does in the air.
    const cameraSection = section('Camera');
    const viewGroup = segmented('Camera', [
      ['chase', 'Chase'],
      ['first', 'First person'],
    ] as const, this.cameraButtons, (v) => {
      this.hooks.setCamera(v);
      this.syncCamera();
    });
    const airGroup = segmented('First person in the air', [
      ['head', 'Head-locked'],
      ['level', 'Level'],
    ] as const, this.airButtons, (air) => {
      this.hooks.setFirstAir(air);
      this.syncCamera();
    });
    this.cameraNote = document.createElement('p');
    this.cameraNote.className = 'setting-note';
    cameraSection.append(labelRow('View', viewGroup), labelRow('First person in the air', airGroup), this.cameraNote);

    // Saved data: erase everything this browser keeps, after a second press to confirm.
    const data = section('Saved data');
    this.wipe = document.createElement('button');
    this.wipe.type = 'button';
    this.wipe.className = 'toggle wipe-button';
    this.wipe.addEventListener('click', () => {
      if (this.wipe.classList.contains('is-armed')) this.hooks.wipeLocal();
      else this.armWipe(true);
    });
    this.wipeCancel = document.createElement('button');
    this.wipeCancel.type = 'button';
    this.wipeCancel.className = 'toggle';
    this.wipeCancel.textContent = 'Cancel';
    this.wipeCancel.addEventListener('click', () => {
      this.armWipe(false);
      this.wipe.focus();
    });
    this.wipeNote = document.createElement('p');
    this.wipeNote.className = 'setting-note';
    this.wipeNote.setAttribute('aria-live', 'polite');
    data.append(labelRow('This browser', this.wipe, this.wipeCancel), this.wipeNote);
    this.armWipe(false);

    // Keys: the Controls screen, which one pops first, then a key for every action.
    const keys = section('Keys');
    keys.classList.add('keys-section');
    const controls = document.createElement('button');
    controls.type = 'button';
    controls.className = 'plank plank-small controls-link';
    controls.textContent = 'Controls and key tester';
    controls.addEventListener('click', () => {
      this.stopListening();
      hooks.openControls();
    });
    keys.appendChild(controls);
    const popGroup = document.createElement('div');
    popGroup.className = 'segmented';
    popGroup.setAttribute('role', 'group');
    popGroup.setAttribute('aria-label', 'Pop with');
    for (const key of ['pop', 'up'] as const) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment';
      btn.addEventListener('click', () => {
        this.stopListening();
        this.hooks.setPopWith(key);
        this.syncKeys();
      });
      popGroup.appendChild(btn);
      this.popButtons.set(key, btn);
    }
    this.popNote = document.createElement('p');
    this.popNote.className = 'setting-note';
    keys.append(labelRow('Pop with', popGroup), this.popNote);
    const changeGroup = segmented('Change', [
      ['keys', 'Keyboard'],
      ['pad', 'Controller'],
    ] as const, this.viewButtons, (v) => {
      this.stopListening();
      this.view = v;
      this.syncKeys();
      this.say('');
    });
    keys.append(labelRow('Change', changeGroup));
    const table = document.createElement('table');
    table.className = 'keys-table';
    table.innerHTML = '<thead><tr><th scope="col">Action</th><th scope="col">Key</th><th scope="col">Second key</th></tr></thead>';
    this.slotHeads.push(...table.querySelectorAll<HTMLElement>('thead th:not(:first-child)'));
    for (const [name, actions] of KEY_GROUPS) {
      const tbody = document.createElement('tbody');
      tbody.innerHTML = `<tr class="keys-group"><th scope="rowgroup" colspan="3">${name}</th></tr>`;
      for (const action of actions) {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = actionName(action);
        tr.appendChild(th);
        for (let slot = 0; slot < KEY_SLOTS; slot++) {
          const td = document.createElement('td');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'key-slot';
          btn.dataset.action = action;
          btn.dataset.slot = String(slot);
          btn.addEventListener('click', () => (this.view === 'pad' ? this.listenPad(btn, action, slot) : this.listen(btn, action, slot)));
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
      if (this.view === 'pad') this.hooks.setPadBindings({ ...DEFAULT_PAD_BINDINGS });
      else this.hooks.setBindings({ ...DEFAULT_BINDINGS });
      this.syncKeys();
      this.say(this.view === 'pad' ? 'Every button is back to its default.' : 'Every key is back to its default.');
    });
    this.reset = reset;
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
    left.append(picture, sound, scoring, crashes, cameraSection, data);
    columns.append(left, keys);
    b.body.appendChild(columns);
    setHints(b.foot, [
      [['↑', '↓', '←', '→'], 'Choose'],
      [['Enter'], 'Pick or change a key'],
      [['Delete'], 'Clear a second key'],
      [['Esc'], 'Back'],
    ], [
      [['D-pad'], 'Choose'],
      [['PadA'], 'Pick or change a button'],
      [['PadX'], 'Clear a second button'],
      [['PadB'], 'Back'],
    ]);
  }

  enter(): HTMLElement | null {
    this.syncQuality();
    const s = this.hooks.get();
    this.master.value = String(Math.round(s.masterVolume * 100));
    this.sfx.value = String(Math.round(s.sfxVolume * 100));
    this.mute.setAttribute('aria-pressed', String(s.muted));
    this.syncSoundLabels();
    this.score.setAttribute('aria-pressed', String(s.score));
    this.syncScoreLabel();
    // The table shows what was used last: a pad's buttons, or the keys.
    this.view = INPUT_LOOK.pad ? 'pad' : 'keys';
    this.syncKeys();
    this.status.textContent = '';
    this.armWipe(false);
    return this.qualityButtons.get(s.quality) ?? null;
  }

  leave(): void {
    this.stopListening();
    this.armWipe(false);
  }

  /** The erase button's two steps: Erase, then Erase everything (with Cancel beside it). */
  private armWipe(armed: boolean): void {
    this.wipe.classList.toggle('is-armed', armed);
    this.wipe.textContent = armed ? 'Erase everything' : 'Erase';
    this.wipeCancel.hidden = !armed;
    this.wipeNote.textContent = armed ? WIPE_ARMED_NOTE : WIPE_NOTE;
  }

  /** Delete or Backspace on a second-key slot clears it. */
  onKey(e: KeyboardEvent): boolean {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
    const el = document.activeElement;
    if (!(el instanceof HTMLButtonElement) || !el.classList.contains('key-slot') || el.dataset.slot !== '1') return false;
    const action = el.dataset.action as Action;
    const pad = this.view === 'pad';
    const b = pad ? this.hooks.get().padBindings : this.hooks.get().bindings;
    if (b[action].length < 2) return true;
    if (pad) this.hooks.setPadBindings(clearSecondKey(b, action));
    else this.hooks.setBindings(clearSecondKey(b, action));
    this.syncKeys();
    this.say(`${actionName(action)}: second ${pad ? 'button' : 'key'} cleared.`);
    return true;
  }

  /**
   * Listens for the next pad button or stick direction for `action`'s slot
   * (milestone 26). LT pressed and let go alone is LT; LT held and then the
   * right stick is that direction's second layer. Any key, a click or
   * CONFIG.pad.listenTime seconds with nothing pressed cancels.
   */
  private listenPad(btn: HTMLButtonElement, action: Action, slot: number): void {
    this.stopListening();
    this.listening = btn;
    btn.classList.add('is-listening');
    btn.textContent = 'Press a button';
    this.say(`Press the new button or stick direction for ${actionName(action)} on the controller. A key or a click cancels.`);
    let ltDown = false;
    const done = (code: string): void => {
      this.stopListening();
      const result = assignKey(this.hooks.get().padBindings, action, slot, code);
      this.hooks.setPadBindings(result.bindings);
      this.syncKeys();
      const name = padName(code);
      const d = result.displaced;
      if (!d) this.say(`${actionName(action)}: ${name}.`);
      else if (d.unbound) this.say(`${name} was the button for ${actionName(d.action)}, which has no button now. Give it one below.`);
      else this.say(`${name} was the button for ${actionName(d.action)}, so the two swapped: ${actionName(d.action)} is now ${padName(d.now ?? '')}.`);
      btn.focus();
    };
    this.hooks.listenPad((code, down) => {
      if (code === 'PadLT') {
        // Wait: LT may be the start of the second layer.
        if (down) ltDown = true;
        else if (ltDown) done('PadLT');
        return;
      }
      if (down) done(code);
    });
    this.hooks.trapNextKey(() => {
      this.stopListening();
      this.say('');
      btn.focus();
    });
    window.addEventListener('pointerdown', this.cancelOnClick, true);
    this.listenTimer = window.setTimeout(() => {
      this.stopListening();
      this.say('No button pressed: nothing changed.');
      btn.focus();
    }, CONFIG.pad.listenTime * 1000);
  }

  private listen(btn: HTMLButtonElement, action: Action, slot: number): void {
    this.stopListening();
    this.listening = btn;
    btn.classList.add('is-listening');
    btn.textContent = 'Press a key';
    this.say(`Press the new key for ${actionName(action)}. Click anywhere to cancel.`);
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
      if (!d) this.say(`${actionName(action)}: ${key}.`);
      else if (d.unbound) this.say(`${key} was the key for ${actionName(d.action)}, which has no key now. Give it one below.`);
      else this.say(`${key} was the key for ${actionName(d.action)}, so the two swapped: ${actionName(d.action)} is now ${keyName(d.now ?? '')}.`);
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
    this.hooks.listenPad(null);
    window.clearTimeout(this.listenTimer);
    window.removeEventListener('pointerdown', this.cancelOnClick, true);
    this.syncKeys();
  }

  /** The Pop with switch, named by the keys bound now, and what it means. */
  private syncPop(): void {
    const s = this.hooks.get();
    const pad = this.view === 'pad';
    const pop = pad ? mainPad(s.padBindings, 'pop') : mainKey(s.bindings, 'pop');
    const up = pad ? mainPad(s.padBindings, 'up') : mainKey(s.bindings, 'up');
    for (const [key, btn] of this.popButtons) {
      btn.textContent = key === 'pop' ? pop : up;
      btn.setAttribute('aria-pressed', String(key === s.popWith));
    }
    this.popNote.textContent =
      s.popWith === 'pop'
        ? `Hold ${pop} to crouch and let go to pop, on the snow and on rails. ${up} only front-flips, so you can hold it off the lip.`
        : `${up} crouches and pops on the snow and on rails, and front-flips once you're in the air. ${pop} does nothing.`;
  }

  private syncCamera(): void {
    const s = this.hooks.get();
    for (const [v, btn] of this.cameraButtons) btn.setAttribute('aria-pressed', String(v === s.camera));
    for (const [air, btn] of this.airButtons) btn.setAttribute('aria-pressed', String(air === s.firstAir));
    const key = mainKey(s.bindings, 'camera');
    this.cameraNote.textContent =
      s.firstAir === 'head'
        ? `${key} switches while riding. In the air first person turns with your head, so flips and spins turn the world round.`
        : `${key} switches while riding. In the air first person looks where you're flying with the horizon level, and shows only your skis.`;
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
    let note = `${QUALITY_TEXT[q][0]}: ${QUALITY_TEXT[q][1]}`;
    if (q === 'auto') note += ` Now: ${this.hooks.autoNow()}.`;
    // Smooth edges can only switch when the game starts.
    const want = wantsAntialias(q);
    if (want !== this.hooks.antialiased()) note += want ? ' Smooth edges come on the next time the game starts.' : ' Smooth edges stay on until the game next starts.';
    this.qualityNote.textContent = note;
  }

  private syncSoundLabels(): void {
    this.masterValue.textContent = `${this.master.value}%`;
    this.sfxValue.textContent = `${this.sfx.value}%`;
    this.mute.textContent = this.mute.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off';
  }

  private syncScoreLabel(): void {
    this.score.textContent = this.score.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off';
  }

  private commitSound(): void {
    this.syncSoundLabels();
    this.hooks.setSound(...this.soundValues());
  }

  /** Master volume, effects volume (0..1) and mute, as set on the screen. */
  private soundValues(): [number, number, boolean] {
    return [Number(this.master.value) / 100, Number(this.sfx.value) / 100, this.mute.getAttribute('aria-pressed') === 'true'];
  }

  private syncKeys(): void {
    this.syncCrash();
    this.syncCamera();
    this.syncPop();
    const s = this.hooks.get();
    const pad = this.view === 'pad';
    const b = pad ? s.padBindings : s.bindings;
    const name = pad ? (code: string) => padName(code) : keyName;
    for (const [v, btn] of this.viewButtons) btn.setAttribute('aria-pressed', String(v === this.view));
    this.slotHeads[0]!.textContent = pad ? 'Button' : 'Key';
    this.slotHeads[1]!.textContent = pad ? 'Second button' : 'Second key';
    this.reset.textContent = pad ? 'Reset buttons to defaults' : 'Reset keys to defaults';
    for (const btn of this.slots.values()) {
      const action = btn.dataset.action as Action;
      const slot = Number(btn.dataset.slot);
      const code = b[action][slot];
      btn.classList.remove('is-listening');
      // Popping with ↑, the pop key does nothing, so it isn't offered.
      const idle = action === 'pop' && s.popWith === 'up';
      btn.disabled = idle;
      if (idle) {
        btn.classList.remove('is-empty');
        btn.textContent = slot === 0 ? `Uses ${mainKey(b, 'up')}` : '';
        btn.setAttribute('aria-label', `${actionName(action)}: uses ${mainKey(b, 'up')}, set by Pop with.`);
        continue;
      }
      btn.classList.toggle('is-empty', !code);
      btn.classList.toggle('is-pad', pad);
      btn.textContent = code ? name(code) : slot === 0 ? 'none' : 'Add';
      const what = pad ? 'button' : 'key';
      btn.setAttribute('aria-label', `${actionName(action)}, ${slot === 0 ? what : `second ${what}`}: ${code ? name(code) : 'none'}. Press Enter to change.`);
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

/** A row of segment buttons for one choice, each kept in `buttons` under its value. */
function segmented<T>(label: string, choices: readonly (readonly [T, string])[], buttons: Map<T, HTMLButtonElement>, pick: (value: T) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segment';
    btn.textContent = text;
    btn.addEventListener('click', () => pick(value));
    group.appendChild(btn);
    buttons.set(value, btn);
  }
  return group;
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
