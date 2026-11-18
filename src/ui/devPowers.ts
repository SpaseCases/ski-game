import type { Scene } from 'three';
import { playShot, prepareShot } from '../audio/devShot.ts';
import type { AudioEngine } from '../audio/engine.ts';
import { DEV_CODES, DevKeys } from '../core/devKeys.ts';
import { DevPowers } from '../render/devPowers.ts';
import { DevScope } from './devScope.ts';
import { keycap, keyName } from './keyNames.ts';

// The developer's powers (milestone 25): the chunk main imports only once
// the dev unlock is confirmed (the board name hashes to DEV_HASH and the
// Worker accepted the saved code this visit). Nobody else's game fetches
// it, so the rest of the game holds no word of it: this file has the text
// (the Dev tag, the Controls table, the key tester's names), and
// render/devPowers.ts does the work every step and frame.

export interface DevHooks {
  hud: HTMLElement;
  scene: Scene;
  audio: AudioEngine;
  /** True while the game takes keys (no menu or trail map open). */
  listening: () => boolean;
}

export interface Dev {
  powers: DevPowers;
  /** The Controls screen's table of the developer's keys. */
  controls(): HTMLElement;
  /** The key tester's names for the developer's keys, by KeyboardEvent.code. */
  readonly testerKeys: ReadonlyMap<string, string>;
}

export function createDevPowers(h: DevHooks): Dev {
  const tag = document.createElement('div');
  tag.className = 'cheats-tag ride-only';
  tag.textContent = 'Dev';
  tag.hidden = true;
  // Under "Cheats on" (top left), never on it.
  tag.style.top = '44px';
  h.hud.appendChild(tag);
  const scope = new DevScope(h.hud);
  const keys = new DevKeys(h.listening);
  const powers = new DevPowers(
    keys,
    {
      showScope: (on) => scope.show(on),
      shotAt: (m, kind) => scope.setDistance(m, kind),
      prepareShot,
      playShot: () => playShot(h.audio),
      showTag: (on) => {
        tag.hidden = !on;
      },
    },
    h.scene,
  );
  const testerKeys = new Map<string, string>([
    [DEV_CODES.fly, 'Dev: take off / land'],
    [DEV_CODES.aim, 'Dev: aim'],
    [DEV_CODES.fire, 'Dev: fire'],
  ]);
  return { powers, controls: () => controlsTable(), testerKeys };
}

function controlsTable(): HTMLElement {
  const table = document.createElement('table');
  table.className = 'controls-table grabs-table';
  table.innerHTML = '<caption>Dev (only with the dev unlock on this computer; never posts)</caption><thead><tr><th scope="col">Key</th><th scope="col">What it does</th></tr></thead>';
  const body = document.createElement('tbody');
  const rows: [string[], string][] = [
    [[DEV_CODES.fly], 'Take off into flight. Flying: glide down and land (you ride away, no crash). Gliding: fly on.'],
    [['ArrowLeft', 'ArrowRight'], 'Flying: turn'],
    [['ArrowUp', 'ArrowDown'], 'Flying: climb or dive'],
    [['ShiftLeft'], 'Flying: fast (held)'],
    [[DEV_CODES.space], 'Flying: hover (held)'],
    [[DEV_CODES.aim], 'Hold to look through the scope; the arrows aim (Shift held: fine) and the rider coasts straight'],
    [[DEV_CODES.fire], 'Fire (Space too while aiming)'],
  ];
  for (const [codes, what] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.className = 'keys-cell';
    codes.forEach((code, i) => {
      if (i > 0) th.append(document.createTextNode(' / '));
      th.append(keycap(keyName(code)));
    });
    const td = document.createElement('td');
    td.textContent = what;
    tr.append(th, td);
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}
