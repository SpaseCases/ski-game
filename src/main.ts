import './style.css';
import { Vector3 } from 'three';
import { createInputState, Keyboard, type Bindings } from './core/input.ts';
import { startLoop } from './core/loop.ts';
import { PointerOrbit } from './core/pointerOrbit.ts';
import { decorDensity, loadSettings, saveSettings, urlQuality, viewRange, type Quality } from './core/settings.ts';
import { readStored, writeStored } from './core/storage.ts';
import { buildMap, type BuiltMap } from './maps/build.ts';
import { parseMap } from './maps/loader.ts';
import { mapEntry, MAPS, type MapEntry, type MapId } from './maps/registry.ts';
import { CONFIG } from './config.ts';
import { ChaseCamera, type OrbitDrag } from './render/chaseCamera.ts';
import { applyMap, createView, renderFrame, setViewRange, type View } from './render/scene.ts';
import { createSkierPose, interpolateSkier, SkierView } from './render/skierView.ts';
import { WorldView } from './render/world.ts';
import {
  canSetPersonal,
  createRun,
  resetRun,
  respawnSkier,
  setPersonal,
  updateRun,
  type RunState,
} from './sim/checkpoints.ts';
import { createRace, resetRace, stepRace, type CourseDef, type RaceState } from './sim/race.ts';
import { copySkierState, createSkierState, placeSkierAt, stepSkier } from './sim/skier.ts';
import { heightAt } from './sim/terrain.ts';
import { anyCheat, CHEATS, configChanged, rebuildTuning, setCheat, TUNING } from './sim/tuning.ts';
import { CheatsScreen } from './ui/cheatsMenu.ts';
import type { TuningPanel } from './ui/tuningPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { Fader } from './ui/fade.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountCrashHint, mountFocusHint } from './ui/hints.ts';
import { ControlsScreen } from './ui/controlsMenu.ts';
import { mainKey } from './ui/keyNames.ts';
import { PauseScreen, TitleScreen } from './ui/mainMenus.ts';
import { MapSelect } from './ui/mapSelect.ts';
import { Menus, type Screen } from './ui/menus.ts';
import { SettingsScreen } from './ui/settingsMenu.ts';
import { titleArt } from './ui/titleArt.ts';
import { formatTime, missedText, RaceHud } from './ui/raceHud.ts';
import { RunHud } from './ui/runHud.ts';
import { Toast } from './ui/toast.ts';
import { TrailMap } from './ui/trailMap.ts';

const app = byId('app');
const hud = byId('hud');
const settings = loadSettings();
/** The preset in use: the saved one, unless the URL names one for this visit. */
let quality: Quality = urlQuality() ?? settings.quality;

let view: View;
try {
  view = createView(app);
} catch (err) {
  console.error(err);
  showFatal('This game needs WebGL, which this browser could not start. Try updating Chrome or turning on hardware acceleration.');
  throw err;
}
const { renderer, scene, camera } = view;

const windowBar = mountWindowButtons(hud);
mountFocusHint(hud);
const fps = mountFpsMeter(hud);
const crashHint = mountCrashHint(hud);
const fader = new Fader(hud);
const toast = new Toast(hud);
const cheatsTag = mountCheatsTag(hud);
const raceHud = new RaceHud(hud);
const runHud = new RunHud(hud, backToTop);
const trailMap = new TrailMap(hud, closeTrailMap);
const keyboard = new Keyboard(settings.bindings);
keyboard.attach(window);

// The menus: the title before any map is loaded, the pause menu while riding,
// and the screens they open. The game waits while any is open.
const menus = new Menus(hud, onRootBack, onGameKey, () => [...windowBar.querySelectorAll<HTMLElement>('a, button')]);
menus.scenery.innerHTML = titleArt();
const titleScreen = new TitleScreen({ play: openMapSelect, settings: openSettings, controls: openControls, cheats: openCheats });
const pauseScreen = new PauseScreen({
  resume: closeMenus,
  respawn: () => {
    closeMenus();
    respawn();
  },
  backToTop: () => {
    closeMenus();
    backToTop();
  },
  maps: openMapSelect,
  settings: openSettings,
  controls: openControls,
  cheats: openCheats,
});
const mapSelect = new MapSelect((entry) => void loadMap(entry), () => menus.back());
const settingsScreen = new SettingsScreen(
  {
    get: () => ({ ...settings, quality }),
    setQuality,
    setSound: (master, sfx, muted) => {
      settings.masterVolume = master;
      settings.sfxVolume = sfx;
      settings.muted = muted;
      saveSettings(settings);
    },
    setBindings,
    trapNextKey: (fn) => menus.trapNextKey(fn),
  },
  () => menus.back(),
);
const controlsScreen = new ControlsScreen(() => settings.bindings, () => menus.back());
const cheatsScreen = new CheatsScreen(
  {
    isOn: (id) => CHEATS[id],
    set: (id, on) => {
      setCheat(id, on);
      syncCheatsTag();
    },
    panelOpen: () => tuningPanel?.isOpen ?? false,
    togglePanel: async () => {
      if (tuningPanel?.isOpen) tuningPanel.close();
      else (await loadTuningPanel()).open();
    },
  },
  () => menus.back(),
);
for (const screen of [titleScreen, pauseScreen, mapSelect, settingsScreen, controlsScreen, cheatsScreen]) menus.add(screen);

// HUD buttons for the mouse, beside the window buttons; hidden while a menu is open.
/** Under a finished timed run's result: the respawn key races the course again. */
let raceAgainHint = '';
const pauseButton = hudButton('Pause', openPause);
const trailButton = hudButton('Trail map', openTrailMap);
windowBar.prepend(trailButton, pauseButton);
syncKeyLabels();

// Simulation state: the current step and the one before it, for interpolation.
const keys = createInputState();
const skier = createSkierState();
const skierPrev = createSkierState();
/** Seconds R has been held; past CONFIG.checkpoints.holdToTop it goes back to the top, once per hold. */
let holdTime = 0;
let heldToTop = false;

/** The map being ridden: built for the sim, drawn, and the run on it. */
interface Level {
  id: MapId;
  built: BuiltMap;
  world: WorldView;
  run: RunState;
  race: RaceState | null;
}
let level: Level | null = null;
applyView();

// Render state. The skier and camera are made with the first map.
const pose = createSkierPose();
let skierView: SkierView | null = null;
let chase: ChaseCamera | null = null;
const orbit = new PointerOrbit();
orbit.attach(renderer.domElement);
const drag: OrbitDrag = { x: 0, y: 0, active: false };
let snapView = true;
/** Dev only: a fixed camera spot and aim (parkLaps.lookFrom), instead of the chase camera. */
let freeCamera: { from: Vector3; at: Vector3 } | null = null;

/** True from a course's timing wand until back to the start (a timed run, finished or not). */
function timedRun(): boolean {
  return level?.race != null && (level.race.running || level.race.finished);
}

/** The course of the timed run, if on one. */
function timedCourse(): CourseDef | undefined {
  const race = level?.race;
  return race && timedRun() ? level?.built.race?.courses[race.course] : undefined;
}

/** Back to the latest checkpoint; on a timed run, back to that course's start house for another go. */
function respawn(): void {
  if (!level) return;
  const { built, run, race } = level;
  const start = timedCourse()?.start;
  if (race && start) {
    resetRace(race);
    run.finished = false;
    placeSkierAt(skier, start.x, start.z, start.heading, built.hf);
  } else {
    respawnSkier(run, skier, built.map, built.hf);
  }
  copySkierState(skierPrev, skier);
  snapView = true;
  fader.reveal();
}

/** A fresh run from the top: every checkpoint and passed flag is forgotten. */
function backToTop(): void {
  if (!level) return;
  resetRun(level.run);
  if (level.race) resetRace(level.race);
  respawn();
}

/** Picks a map: builds it (after letting "Loading" show), drops the old one, and starts at the top. */
async function loadMap(entry: MapEntry): Promise<void> {
  if (!entry.load) return;
  if (level?.id === entry.id) {
    closeMenus();
    return;
  }
  mapSelect.setLoading(entry.id);
  try {
    const map = parseMap(await entry.load());
    await nextPaint();
    // Free the old map before building the new one, to keep peak memory down.
    level?.world.dispose();
    level = null;
    const built = buildMap(map);
    const world = new WorldView(built, decorDensity(quality), viewRange(quality).far);
    scene.add(world.group);
    applyMap(view, built);
    level = { id: entry.id, built, world, run: createRun(map), race: built.race ? createRace(built.race) : null };
    applyView();
    if (skierView && chase) {
      skierView.hf = built.hf;
      chase.hf = built.hf;
    } else {
      skierView = new SkierView(scene, built.hf);
      chase = new ChaseCamera(camera, built.hf);
    }
    writeStored('map', entry.id);
    tuningPanel?.setMap(map);
    backToTop();
    mapSelect.setLoading(null);
    closeMenus();
  } catch (err) {
    console.error(err);
    mapSelect.setError(`Couldn't load ${entry.name}. Try again, or pick another map.`);
  }
}

/** The title, over the painted mountain: where the game starts. */
function openTitle(): void {
  keyboard.setEnabled(false);
  menus.setScenery(true);
  menus.open(titleScreen);
}

/** The pause menu (Esc, the pause key, or the HUD button); the game waits behind it. */
function openPause(): void {
  if (!level) return;
  trailMap.close();
  keyboard.setEnabled(false);
  const b = settings.bindings;
  pauseScreen.setInfo(mapEntry(level.id)?.name ?? '', mainKey(b, 'pause'), mainKey(b, 'respawn'), (code) => keyboard.isBound('pause', code));
  menus.setScenery(false);
  menus.open(pauseScreen);
}

function openMapSelect(): void {
  mapSelect.prepare(level?.id ?? null, (mapEntry(readStored('map'))?.id ?? MAPS[0]!.id) as MapId);
  menus.push(mapSelect);
}

function openSettings(): void {
  menus.push(settingsScreen);
}

function openControls(): void {
  menus.push(controlsScreen);
}

function openCheats(): void {
  menus.push(cheatsScreen);
}

/** "Cheats on" in a corner while any cheat is on or the tuning panel has changed a number. */
function syncCheatsTag(): void {
  cheatsTag.hidden = !(anyCheat() || configChanged());
}

/** Esc on the bottom screen: the pause menu resumes; the title stays (there's nothing to go back to). */
function onRootBack(screen: Screen): void {
  if (screen === pauseScreen) closeMenus();
}

/** Back to riding. */
function closeMenus(): void {
  if (!level) return;
  menus.close();
  keyboard.setEnabled(true);
  keyboard.sample(keys);
  holdTime = 0;
}

/** Opens the trail map of the map being ridden; the game waits behind it. */
function openTrailMap(): void {
  if (!level || menus.isOpen) return;
  keyboard.setEnabled(false);
  trailMap.open(level.built, skier.position, skier.yaw, level.run.passed);
}

function closeTrailMap(): void {
  if (!trailMap.isOpen) return;
  trailMap.close();
  keyboard.setEnabled(true);
  keyboard.sample(keys);
  holdTime = 0;
}

/** A key pressed while no menu is open (the menus see it first, in Menus). */
function onGameKey(e: KeyboardEvent): void {
  // Riding, Tab never moves focus: it's the checkpoint key (or was, before rebinding).
  if (e.key === 'Tab') e.preventDefault();
  if (e.repeat) return;
  const pauseKey = e.key === 'Escape' || keyboard.isBound('pause', e.code);
  // While the trail map is open, its key or Esc closes it (game keys are off then); the pause key pauses.
  if (trailMap.isOpen && (e.key === 'Escape' || keyboard.isBound('trailMap', e.code))) {
    e.preventDefault();
    closeTrailMap();
    return;
  }
  if (pauseKey) {
    e.preventDefault();
    openPause();
  }
}

/** New key bindings from Settings: used at once, saved, and shown on the HUD. */
function setBindings(b: Bindings): void {
  settings.bindings = b;
  keyboard.setBindings(b);
  saveSettings(settings);
  syncKeyLabels();
}

/** HUD labels that name a key, as bound now. */
function syncKeyLabels(): void {
  const b = settings.bindings;
  setButtonKey(pauseButton, mainKey(b, 'pause'));
  setButtonKey(trailButton, mainKey(b, 'trailMap'));
  crashHint.setKey(mainKey(b, 'respawn'));
  runHud.setKeys(mainKey(b, 'confirm'), mainKey(b, 'respawn'));
  raceAgainHint = `${mainKey(b, 'respawn')}: race it again`;
}

/** Switches to a quality preset (and remembers it): view range and decoration. */
function setQuality(q: Quality): void {
  quality = q;
  settings.quality = q;
  saveSettings(settings);
  applyView();
  level?.world.setQuality(decorDensity(q), viewRange(q).far);
}

/** The current preset's view range on the camera and fog. */
function applyView(): void {
  const range = viewRange(quality);
  // Only a map with far ranges has the far stand-in the haze can fade into; elsewhere the fog ends at the far plane.
  const hazeEnd = level?.built.map.peaks ? range.hazeEnd : range.far;
  setViewRange(view, range.far, range.fogStart, hazeEnd);
}

/** Dev testing: puts the skier at (x, z) facing `heading` (radians), moving along the skis at `speed`. */
const tmp = new Vector3();
function teleport(x: number, z: number, heading: number, speed: number): void {
  if (!level) return;
  resetRun(level.run);
  if (level.race) resetRace(level.race);
  placeSkierAt(skier, x, z, heading, level.built.hf);
  skier.velocity.copy(tmp.set(0, 0, -1).applyQuaternion(skier.orient)).multiplyScalar(speed);
  copySkierState(skierPrev, skier);
  snapView = true;
}

/** The live tuning panel: loaded (its own chunk, with lil-gui) the first time it's opened. */
let tuningPanel: TuningPanel | null = null;
let panelLoading: Promise<TuningPanel> | null = null;
function loadTuningPanel(): Promise<TuningPanel> {
  panelLoading ??= import('./ui/tuningPanel.ts').then(({ mountTuningPanel }) => {
    const panel = mountTuningPanel({
      changed: syncCheatsTag,
      shown: () => cheatsScreen.sync(),
      respawn,
      backToTop,
      teleport,
      setQuality,
      quality,
    });
    tuningPanel = panel;
    if (level) panel.setMap(level.built.map);
    return panel;
  });
  // A failed load can be tried again.
  panelLoading.catch(() => (panelLoading = null));
  return panelLoading;
}

if (import.meta.env.DEV) {
  // Dev builds open it at startup, folded up.
  void loadTuningPanel().then((p) => p.open(true));
  // Handle for inspecting the sim from the browser console while testing.
  Object.assign(window, {
    parkLaps: {
      skier,
      keys,
      camera,
      scene,
      renderer,
      backdrop: view.backdrop,
      config: CONFIG,
      /** The numbers the sim runs on (CONFIG with the cheats); call rebuildTuning() after editing config. */
      tuning: TUNING,
      cheats: CHEATS,
      setCheat: (id: keyof typeof CHEATS, on: boolean) => {
        setCheat(id, on);
        syncCheatsTag();
        cheatsScreen.sync();
      },
      rebuildTuning: () => {
        rebuildTuning();
        syncCheatsTag();
      },
      respawn,
      backToTop,
      teleport,
      setQuality,
      loadMap: (id: MapId) => loadMap(mapEntry(id)!),
      /** Looks from (x, y, z) at (tx, ty, tz) until called with no arguments, which goes back to the chase camera. */
      lookFrom: (...v: number[]) => {
        const [x = 0, y = 0, z = 0, tx = 0, ty = 0, tz = 0] = v;
        freeCamera = v.length === 6 ? { from: new Vector3(x, y, z), at: new Vector3(tx, ty, tz) } : null;
      },
      /** Snow height at (x, z), for aiming lookFrom. */
      heightAt: (x: number, z: number) => (level ? heightAt(level.built.hf, x, z) : 0),
      get map() {
        return level?.built.map;
      },
      get course() {
        return level?.built.course;
      },
      get raceDef() {
        return level?.built.race;
      },
      get run() {
        return level?.run;
      },
      get race() {
        return level?.race;
      },
      get skierView() {
        return skierView;
      },
    },
  });
}

// Start on the title, or straight on a map named in the URL (?map=park).
const fromUrl = mapEntry(new URLSearchParams(window.location.search).get('map'));
openTitle();
if (fromUrl?.load) void loadMap(fromUrl);

/** True while the game waits: no map yet, or a menu or the trail map is open. Nothing moves then. */
function gameWaits(): boolean {
  return !level || menus.isOpen || trailMap.isOpen;
}

startLoop(
  (dt) => {
    if (!level) return;
    const { built, run, race } = level;
    keyboard.sample(keys);
    if (keys.trailMap.pressed) {
      openTrailMap();
      return;
    }
    // R: back to the checkpoint at once. Holding it keeps the skier there,
    // and after a moment goes back to the top instead.
    if (keys.respawn.pressed) {
      respawn();
      holdTime = 0;
      heldToTop = false;
    }
    if (keys.respawn.held) {
      // Real seconds, whatever the game speed.
      holdTime += dt / TUNING.sim.timeScale;
      if (!heldToTop && holdTime >= CONFIG.checkpoints.holdToTop) {
        heldToTop = true;
        backToTop();
      }
      return;
    }
    holdTime = 0;
    heldToTop = false;

    if (keys.confirm.pressed && run.finished) {
      backToTop();
      return;
    }
    if (keys.checkpoint.pressed) {
      if (timedRun()) {
        toast.show('No checkpoints on a timed run');
      } else if (canSetPersonal(skier)) {
        setPersonal(run, skier);
        toast.show('Checkpoint set');
      } else {
        toast.show(skier.bailed ? 'No checkpoints while crashing' : 'Checkpoints can only be set on the snow');
      }
    }

    copySkierState(skierPrev, skier);
    stepSkier(skier, keys, built.course, dt);
    const event = updateRun(run, built.map, skierPrev.position, skier);
    if (race && built.race) {
      const raceEvent = stepRace(race, built.race, skierPrev.position, skier, dt);
      if (raceEvent === 'missed') toast.show('Missed gate');
    }
    if (event === 'flag' && !timedRun()) toast.show(`Checkpoint: flag ${run.flag + 1} of ${built.map.flags.length}`);
    // After a crash, let the tumble play out, then fade and respawn.
    if (skier.bailed && skier.bailTime >= CONFIG.bail.respawnDelay && !fader.busy) fader.fadeOut(respawn);
  },
  (alpha, realFrameTime) => {
    // While the game waits, everything that moves by time holds still too.
    // In slow motion it all slows with the sim; the HUD keeps real time.
    const hudTime = gameWaits() ? 0 : realFrameTime;
    const frameTime = hudTime * TUNING.sim.timeScale;
    if (level && skierView && chase) {
      interpolateSkier(pose, skierPrev, skier, alpha);
      const snapped = snapView;
      if (snapView) {
        skierView.snap(pose);
        chase.snap(pose);
        snapView = false;
      }
      skierView.update(pose, frameTime);
      orbit.take(drag);
      drag.active = orbit.dragging;
      chase.update(pose, frameTime, drag);
      if (freeCamera) {
        camera.position.copy(freeCamera.from);
        camera.lookAt(freeCamera.at);
      }
      level.world.view(camera.position.x, camera.position.z, camera.far, snapped || freeCamera !== null);
      level.world.update(level.run, level.race, frameTime);
    }

    renderFrame(view);
    fader.update(hudTime);
    crashHint.show(pose.bailed);
    toast.update(hudTime);
    const race = level?.race;
    const course = timedCourse();
    raceHud.update(course !== undefined, course?.name ?? '', race?.time ?? 0, race?.missed ?? 0);
    const finished = level?.run.finished ?? false;
    const result = finished && race?.finished ? `${course?.name ?? ''} · ${formatTime(race.time)} · ${missedText(race.missed)}` : '';
    runHud.update(finished, result, result === '' ? '' : raceAgainHint, heldToTop ? 0 : holdTime);
    fps.frame(realFrameTime);
    tuningPanel?.update(pose, skier);
  },
  gameWaits,
);

function mountCheatsTag(parent: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cheats-tag ride-only';
  el.textContent = 'Cheats on';
  el.hidden = true;
  parent.appendChild(el);
  return el;
}

function hudButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hud-button ride-only';
  b.dataset.label = label;
  b.addEventListener('click', () => {
    b.blur();
    onClick();
  });
  return b;
}

/** A HUD button's label with its key after it. */
function setButtonKey(b: HTMLButtonElement, key: string): void {
  const kbd = document.createElement('kbd');
  kbd.textContent = key;
  b.replaceChildren(document.createTextNode(b.dataset.label ?? ''), kbd);
}

/** Resolves after the browser has painted, so a status shown just before is on screen during long work. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

function showFatal(message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = message;
  hud.appendChild(el);
}
