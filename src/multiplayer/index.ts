import './multiplayer.css';
import { Vector3, type Camera, type Scene } from 'three';
import { CONFIG } from '../config.ts';
import type { Heightfield } from '../maps/types.ts';
import { BEST_MAX, chatAllowed, FIELD_COUNT, SCALE, tidyChat, TRICK_MAX, trickOk, type LobbyEntry } from '../online/mpRules.ts';
import type { SkierPose } from '../render/skierView.ts';
import type { Screen } from '../ui/menus.ts';
import { Link, lobbyApi, lobbyErrorText } from './connection.ts';
import { MpHud } from './hud.ts';
import { freeLook, lookText, paintedLook, paints, setPaintKit, stockLook, type PaintKit } from './looks.ts';
import { hitAt, Remote, RiderScene, shootRiders, type Detail } from './riders.ts';
import { LobbyListScreen, RoomScreen, type RoomRider } from './screens.ts';
import { createSample, decodeState, encodeState, sampleFromPose } from './wire.ts';

// Multiplayer (milestone 27): its own lazy chunk, which main imports only
// when a player turns "Ride with others" on and picks a map; riding alone
// never fetches it. Lobbies live on the leaderboard Worker (Durable Objects,
// one per lobby). This module joins one, sends this rider's drawn pose 5
// times a second (two samples a message), draws the others from their
// messages only, and runs the chat, the lobby's scores and the developer's
// hits. Nothing here touches the sim: the one way in is a hit from the
// developer's rifle, which main turns into a crash (sim/skier.ts knockDown).

export interface MultiplayerHooks {
  scene: Scene;
  hud: HTMLElement;
  push(screen: Screen): void;
  back(): void;
  /** The board name, or '' (a stand-in name is used). */
  name(): string;
  /** The outfit as outfit.v1's JSON. */
  outfitJson(): string;
  /** The developer's code while the powers are live, else null. */
  devCode(): string | null;
  mapName(id: string): string;
  currentMap(): string | null;
  /** Loads the map (or keeps the one ridden) and closes the menus; false if it couldn't. */
  loadMap(id: string): Promise<boolean>;
  hf(): Heightfield | null;
  detail(): Detail;
  /** The riding keys off (typing in the chat) or on. */
  ridingKeys(on: boolean): void;
  /** In a lobby or not (main shows the pause menu's Lobby plank). */
  inLobby(on: boolean): void;
  toast(text: string): void;
  /** The chat key's label, for the hint. */
  chatKey(): string;
  /** Reading other riders' painted gear (main's core/customSkis.ts and customWear.ts). */
  paint: PaintKit;
}

export interface Multiplayer {
  /** The map select's pick with "Ride with others" on: the map's lobby list. */
  openLobbies(map: string): void;
  /** Pause's Lobby plank: who's here, mute, leave. */
  openRoom(): void;
  leave(): void;
  readonly joined: boolean;
  readonly typing: boolean;
  /** Each drawn frame: sends this rider's pose (unless `waits`) and draws the others. */
  frame(pose: SkierPose, camera: Camera, realDt: number, waits: boolean): void;
  /** A hit from the developer's rifle waiting to be taken (the direction it came along), or null. */
  takeHit(): { x: number; z: number } | null;
  /** The developer's shot along `dir` (unit): the distance to the rider it hits (and the hit is sent), or -1. */
  shoot(from: Vector3, dir: Vector3, range: number): number;
  openChat(): void;
  /** A combo was banked: the lobby hears the best this visit and the last trick. */
  banked(total: number, trick: string): void;
  /** The map being ridden changed (or none): leaving the lobby's map leaves the lobby. */
  mapChanged(id: string | null): void;
  /** The lobby list and the lobby screen (main adds them to the menus). */
  readonly screens: readonly Screen[];
  /** Joins a lobby by code (the lobby list's way in; dev builds' hook too). */
  join(code: string): void;
  /** What this game sees, for play-tests (dev builds' hook). */
  debug(): unknown;
}

interface Lobby {
  code: string;
  map: string;
  title: string;
  open: boolean;
  you: number;
}

let created = 0;

export function createMultiplayer(h: MultiplayerHooks): Multiplayer {
  const M = CONFIG.mp;
  setPaintKit(h.paint);
  const riders: Remote[] = [];
  const scene = new RiderScene(h.scene);
  const hud = new MpHud(h.hud, {
    send: (text) => say(text),
    typing: (on) => h.ridingKeys(!on),
  });
  hud.setSizes(M.chatLines, M.chatShow);
  const token = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  const standIn = `Rider ${String(1000 + Math.floor(Math.random() * 9000))}`;
  let lobby: Lobby | null = null;
  /** The lobby being joined (until welcomed), and whether its screen is waiting on it. */
  let joining = '';
  let best = 0;
  let pendingHit: { x: number; z: number } | null = null;
  let seq = 0;
  const a = createSample();
  const b = createSample();
  const lastB = createSample();
  let sampleClock = 0;
  let taken = 0;
  let keepClock = 0;
  let hasLast = false;
  const inA = createSample();
  const inB = createSample();
  const muted = new Set<string>();

  const myName = (): string => h.name() || standIn;

  const link = new Link({
    hello: () => {
      const dev = h.devCode();
      return JSON.stringify({ t: 'hi', name: myName(), outfit: h.outfitJson(), token, ...(dev ? { dev } : {}) });
    },
    state: (data) => {
      const head = decodeState(data, inA, inB);
      if (head < 0) return;
      const r = riderById(Math.floor(head / 65536));
      if (!r) return;
      const now = performance.now() / 1000;
      heard(r, now);
      r.timeline.take(head & 0xffff, inA, inB, now);
    },
    keep: (id) => {
      const r = riderById(id);
      if (r) heard(r, performance.now() / 1000);
    },
    message: (m) => onMessage(m),
    status: (state, text) => {
      if (state === 'joined') {
        hud.status(lobbyChip(), false);
        return;
      }
      if (state === 'retrying') {
        hud.status(text || 'Connection lost. Rejoining…', true);
        if (joining && !lobby) list.say(text);
        return;
      }
      if (state === 'connecting') {
        hud.status(lobby ? 'Rejoining…' : '', false);
        return;
      }
      // Closed: left on purpose (no text), or refused.
      const was = lobby !== null;
      if (text) {
        if (joining && !was) {
          list.say(text);
          list.done();
        } else hud.line('', text);
      }
      endLobby();
      hud.status(was && text ? text : '', true);
      if (was && text) window.setTimeout(() => !lobby && hud.status(''), 8000);
    },
  });

  const list = new LobbyListScreen({
    list: async (map) => (await lobbyApi<{ lobbies: LobbyEntry[] }>('GET', '/v1/mp/lobbies', { map })).lobbies,
    create: async (map, title, open) => (await lobbyApi<{ code: string }>('POST', '/v1/mp/create', {}, { map, title, open })).code,
    join: (code) => {
      // Leaving any lobby first closes it, which clears `joining`: set it after.
      link.join(code);
      joining = code;
    },
    back: h.back,
    errorText: lobbyErrorText,
    suggestTitle: () => `${myName()}'s lobby`.slice(0, 24),
    every: M.listEvery,
  });

  const room = new RoomScreen({
    info: () => {
      if (!lobby) return null;
      const now = performance.now() / 1000;
      const out: RoomRider[] = [{ id: lobby.you, name: myName(), best, trick: lastTrick, muted: false, away: false, you: true }];
      for (const r of riders) if (!r.gone) out.push({ id: r.id, name: r.name, best: r.best, trick: r.trick, muted: r.muted, away: now - r.heard > M.away, you: false });
      return { title: lobby.title, code: lobby.code, open: lobby.open, riders: out };
    },
    mute: (id, on) => {
      const r = riderById(id);
      if (!r) return;
      r.muted = on;
      if (on) muted.add(r.name.toLowerCase());
      else muted.delete(r.name.toLowerCase());
    },
    leave: () => {
      leave();
      h.back();
      h.toast('Left the lobby');
    },
    back: h.back,
  });
  let lastTrick = '';

  // Riders silent past `remove` are taken off the slope and the list (checked once a second, not per frame).
  // They're kept, though: a tab back from the background speaks again on the same connection, and shows at once.
  const sweep = window.setInterval(() => {
    const now = performance.now() / 1000;
    for (const r of riders) {
      if (!r.gone && now - r.heard > M.remove) {
        r.gone = true;
        hud.line('', `${r.name} dropped out (no signal)`);
        hud.status(lobbyChip());
        room.update();
      }
    }
  }, 1000);
  void sweep;

  /** Something came from `r`: a rider who had dropped out is back. */
  function heard(r: Remote, now: number): void {
    r.heard = now;
    if (!r.gone) return;
    r.gone = false;
    hud.line('', `${r.name} is back`);
    hud.status(lobbyChip());
    room.update();
  }

  function riderById(id: number): Remote | undefined {
    for (const r of riders) if (r.id === id) return r;
    return undefined;
  }

  function lobbyChip(): string {
    if (!lobby) return '';
    let n = 1;
    for (const r of riders) if (!r.gone) n++;
    return `${lobby.title} · ${n} rider${n === 1 ? '' : 's'}${lobby.open ? '' : ` · code ${lobby.code}`}`;
  }

  function addRider(o: Record<string, unknown>): void {
    const id = Number(o.id);
    const name = typeof o.name === 'string' ? o.name : '?';
    const outfitJson = typeof o.outfit === 'string' ? o.outfit : '{}';
    if (!Number.isInteger(id) || riderById(id)) return;
    const now = performance.now() / 1000;
    const r = new Remote(id, name, outfitJson, stockLook(outfitJson), ++created, now - (Number(o.quiet) || 0));
    r.best = Number(o.best) || 0;
    r.trick = typeof o.trick === 'string' ? o.trick : '';
    r.muted = muted.has(name.toLowerCase());
    riders.push(r);
    // Painted gear: read from the look saved under their board name (not a stand-in's).
    if (paints(outfitJson) && !/^Rider \d{4}$/.test(name)) {
      void lookText(name).then((text) => {
        if (!riders.includes(r) || !text) return;
        r.worn = paintedLook(outfitJson, text, r.n);
        r.look = r.worn.outfit;
        r.color.set(r.look.jacket);
      });
    }
  }

  function dropRider(i: number): void {
    const r = riders[i]!;
    scene.remove(r);
    if (r.worn) freeLook(r.worn);
    riders.splice(i, 1);
  }

  function clearRiders(): void {
    for (let i = riders.length - 1; i >= 0; i--) dropRider(i);
  }

  function onMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'welcome': {
        const map = String(m.map);
        const first = !lobby || lobby.code !== m.code;
        lobby = { code: String(m.code), map, title: String(m.title), open: m.open === true, you: Number(m.you) };
        clearRiders();
        if (Array.isArray(m.riders)) for (const r of m.riders as Record<string, unknown>[]) addRider(r);
        link.welcomed();
        h.inLobby(true);
        hasLast = false;
        if (first) {
          hud.line('', `Joined ${lobby.title}. Press ${h.chatKey()} to chat.`);
          if (best > 0) link.sendText(JSON.stringify({ t: 's', best, trick: lastTrick }));
        } else hud.line('', 'Back in the lobby.');
        hud.status(lobbyChip());
        const code = lobby.code;
        if (joining) {
          joining = '';
          list.done();
          list.say('');
          void h.loadMap(map).then((ok) => {
            if (!ok && lobby?.code === code) {
              leave();
              hud.line('', "Couldn't load the lobby's map.");
            }
          });
        }
        room.update();
        return;
      }
      case 'join': {
        const r = m.r as Record<string, unknown> | undefined;
        if (!r) return;
        addRider(r);
        hud.line('', `${String(r.name)} joined`);
        hud.status(lobbyChip());
        room.update();
        return;
      }
      case 'leave': {
        const i = riders.findIndex((r) => r.id === m.id);
        if (i < 0) return;
        hud.line('', `${riders[i]!.name} left`);
        dropRider(i);
        hud.status(lobbyChip());
        room.update();
        return;
      }
      case 'c': {
        const id = Number(m.id);
        const text = typeof m.text === 'string' ? m.text : '';
        if (lobby && id === lobby.you) return hud.line(myName(), text);
        const r = riderById(id);
        if (r && !r.muted) hud.line(r.name, text);
        return;
      }
      case 'c-slow':
        return hud.line('', 'Wait a moment between messages.');
      case 'c-no':
        return hud.line('', "That message wasn't sent.");
      case 's': {
        const r = riderById(Number(m.id));
        if (!r) return;
        r.best = Number(m.best) || 0;
        r.trick = typeof m.trick === 'string' ? m.trick : '';
        room.update();
        return;
      }
      case 'hit': {
        const x = Number(m.x) || 0;
        const z = Number(m.z) || 0;
        pendingHit = { x, z };
        hud.line('', `Shot by ${String(m.by)}!`);
        return;
      }
      default:
        return;
    }
  }

  function endLobby(): void {
    const was = lobby !== null;
    lobby = null;
    joining = '';
    clearRiders();
    hud.close();
    if (was) h.inLobby(false);
    room.update();
  }

  function leave(): void {
    if (!lobby && !joining) return;
    link.leave();
    endLobby();
    hud.status('');
  }

  function say(raw: string): void {
    const text = tidyChat(raw);
    if (!text) return;
    if (!chatAllowed(text)) {
      hud.line('', "That message wasn't sent.");
      return;
    }
    link.sendText(JSON.stringify({ t: 'c', text }));
  }

  /** Whether A and B round to what was last sent (standing still): then a keep-alive does instead. */
  function unchanged(): boolean {
    if (!hasLast) return false;
    for (let i = 0; i < FIELD_COUNT; i++) {
      const s = SCALE[i]!;
      const l = Math.round(lastB[i]! * s);
      if (Math.round(a[i]! * s) !== l || Math.round(b[i]! * s) !== l) return false;
    }
    return true;
  }

  return {
    screens: [list, room],
    get joined() {
      return lobby !== null;
    },
    get typing() {
      return hud.typing;
    },
    openLobbies(map) {
      list.prepare(map, h.mapName(map));
      h.push(list);
    },
    openRoom() {
      h.push(room);
    },
    leave,
    frame(pose, camera, realDt, waits) {
      const now = performance.now() / 1000;
      if (!lobby) {
        if (riders.length) clearRiders();
        return;
      }
      const sending = link.state === 'joined';
      if (sending && !waits && h.currentMap() === lobby.map) {
        sampleClock += realDt;
        // After a long frame (a hitch, a tab back from hidden), start sampling afresh rather than in a burst.
        if (sampleClock > 0.5) sampleClock = 1 / M.sampleRate;
        while (sampleClock >= 1 / M.sampleRate) {
          sampleClock -= 1 / M.sampleRate;
          sampleFromPose(taken % 2 === 0 ? a : b, pose);
          taken++;
          if (taken % M.samplesPerMessage !== 0) continue;
          if (unchanged()) {
            keepClock += M.samplesPerMessage / M.sampleRate;
            if (keepClock >= M.keepAlive) {
              keepClock = 0;
              link.sendText('k');
            }
            continue;
          }
          keepClock = 0;
          link.sendBinary(encodeState(seq, a, b));
          seq = (seq + 1) & 0xffff;
          lastB.set(b);
          hasLast = true;
        }
      } else if (sending) {
        // A menu open, the map loading: still here, just not moving.
        keepClock += realDt;
        if (keepClock >= M.keepAlive) {
          keepClock = 0;
          link.sendText('k');
        }
      }
      const hf = h.hf();
      if (h.currentMap() !== lobby.map) scene.hide(riders);
      else scene.frame(riders, camera, hf, h.detail(), now, realDt);
    },
    takeHit() {
      const hit = pendingHit;
      pendingHit = null;
      return hit;
    },
    shoot(from, dir, range) {
      if (!lobby) return -1;
      const r = shootRiders(riders, from, dir, range);
      if (!r) return -1;
      const flat = Math.hypot(dir.x, dir.z) || 1;
      link.sendText(JSON.stringify({ t: 'h', to: r.id, x: dir.x / flat, z: dir.z / flat }));
      return hitAt.d;
    },
    openChat() {
      if (lobby && link.state === 'joined') hud.openChat();
    },
    banked(total, trick) {
      const t = trick.slice(0, TRICK_MAX);
      lastTrick = trickOk(t) ? t : '';
      best = Math.min(BEST_MAX, Math.max(best, Math.round(total)));
      if (lobby) link.sendText(JSON.stringify({ t: 's', best, trick: lastTrick }));
      room.update();
    },
    join(code) {
      link.join(code);
      joining = code;
    },
    debug() {
      const now = performance.now() / 1000;
      return {
        state: link.state,
        lobby,
        riders: riders.map((r) => ({
          id: r.id,
          name: r.name,
          away: r.away,
          full: r.full,
          drawn: r.hasPose,
          dist: Math.round(Math.sqrt(r.d2)),
          delay: Math.round(r.timeline.delay * 1000),
          jitter: Math.round(r.timeline.jitter * 1000),
          held: r.timeline.held,
          quiet: Math.round((now - r.heard) * 10) / 10,
          bailed: r.pose.bailed,
          grab: r.pose.grab,
          x: Math.round(r.pose.position.x * 1000) / 1000,
          z: Math.round(r.pose.position.z * 1000) / 1000,
          best: r.best,
          trick: r.trick,
        })),
      };
    },
    mapChanged(id) {
      if (lobby && id !== lobby.map && !joining) {
        leave();
        h.toast('Left the lobby');
      }
    },
  };
}
