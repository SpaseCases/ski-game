import './style.css';
import { Vector3 } from 'three';
import { createInputState, DEFAULT_BINDINGS, Keyboard } from './core/input.ts';
import { startLoop } from './core/loop.ts';
import { PointerOrbit } from './core/pointerOrbit.ts';
import { decorDensity, loadQuality, saveQuality, viewRange, type Quality } from './core/settings.ts';
import { readStored, writeStored } from './core/storage.ts';
import { buildMap, type BuiltMap } from './maps/build.ts';
import { parseMap } from './maps/loader.ts';
import { mapEntry, MAPS, type MapEntry, type MapId } from './maps/registry.ts';
import { CONFIG } from './config.ts';
import { ChaseCamera, type OrbitDrag } from './render/chaseCamera.ts';
import { applyMapColors, createView, setViewRange, type View } from './render/scene.ts';
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
import { createRace, finishRace, resetRace, stepRace, type RaceState } from './sim/race.ts';
import { copySkierState, createSkierState, placeSkierAt, stepSkier } from './sim/skier.ts';
import { heightAt } from './sim/terrain.ts';
import type { DevPanel } from './ui/devPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { Fader } from './ui/fade.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountControlsHint, mountCrashHint, mountFocusHint } from './ui/hints.ts';
import { MapSelect } from './ui/mapSelect.ts';
import { formatTime, missedText, RaceHud } from './ui/raceHud.ts';
import { RunHud } from './ui/runHud.ts';
import { Toast } from './ui/toast.ts';
import { TrailMap } from './ui/trailMap.ts';

const app = byId('app');
const hud = byId('hud');
let quality: Quality = loadQuality();

let view: View;
try {
  view = createView(app);
} catch (err) {
  console.error(err);
  showFatal('This game needs WebGL, which this browser could not start. Try updating Chrome or turning on hardware acceleration.');
  throw err;
}
const { renderer, scene, camera } = view;
applyView();

const windowBar = mountWindowButtons(hud);
mountControlsHint(hud);
mountFocusHint(hud);
const fps = mountFpsMeter(hud);
const crashHint = mountCrashHint(hud);
const fader = new Fader(hud);
const toast = new Toast(hud);
const raceHud = new RaceHud(hud);
const runHud = new RunHud(hud, backToTop);
const menu = new MapSelect(hud, (entry) => void loadMap(entry), closeMenu);
const trailMap = new TrailMap(hud, closeTrailMap);
const mapsButton = document.createElement('button');
mapsButton.type = 'button';
mapsButton.className = 'hud-button';
mapsButton.innerHTML = 'Maps <kbd>Esc</kbd>';
mapsButton.addEventListener('click', openMenu);
const trailButton = document.createElement('button');
trailButton.type = 'button';
trailButton.className = 'hud-button';
trailButton.innerHTML = 'Trail map <kbd>M</kbd>';
trailButton.addEventListener('click', openTrailMap);
windowBar.prepend(trailButton, mapsButton);

// Simulation state: the current step and the one before it, for interpolation.
const keyboard = new Keyboard(DEFAULT_BINDINGS);
keyboard.attach(window);
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

/** True from the timing wand until back to the start (a timed run, finished or not). */
function timedRun(): boolean {
  return level?.race != null && (level.race.running || level.race.finished);
}

/** Back to the latest checkpoint; on a timed run, back to the start house for another go. */
function respawn(): void {
  if (!level) return;
  const { built, run, race } = level;
  const start = built.race?.start;
  if (race && start && timedRun()) {
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
    closeMenu();
    return;
  }
  menu.setLoading(entry.id);
  try {
    const map = parseMap(await entry.load());
    await nextPaint();
    // Free the old map before building the new one, to keep peak memory down.
    level?.world.dispose();
    level = null;
    const built = buildMap(map);
    const world = new WorldView(built, decorDensity(quality), viewRange(quality).far);
    scene.add(world.group);
    applyMapColors(view, map);
    level = { id: entry.id, built, world, run: createRun(map), race: built.race ? createRace(built.race) : null };
    if (skierView && chase) {
      skierView.hf = built.hf;
      chase.hf = built.hf;
    } else {
      skierView = new SkierView(scene, built.hf);
      chase = new ChaseCamera(camera, built.hf);
    }
    writeStored('map', entry.id);
    devPanel?.setMap(map);
    backToTop();
    menu.setLoading(null);
    closeMenu();
  } catch (err) {
    console.error(err);
    menu.setError(`Couldn't load ${entry.name}. Try again, or pick another map.`);
  }
}

/** Opens the map-select menu; the game waits behind it. */
function openMenu(): void {
  trailMap.close();
  keyboard.setEnabled(false);
  menu.open(level?.id ?? null, (mapEntry(readStored('map'))?.id ?? MAPS[0]!.id) as MapId);
}

function closeMenu(): void {
  if (!level) return;
  menu.close();
  keyboard.setEnabled(true);
  keyboard.sample(keys);
  holdTime = 0;
}

/** Opens the trail map of the map being ridden; the game waits behind it. */
function openTrailMap(): void {
  if (!level || menu.isOpen) return;
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

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // While the trail map is open, its key or Esc closes it (game keys are off then).
  if (trailMap.isOpen && (e.key === 'Escape' || keyboard.isBound('trailMap', e.code))) {
    e.preventDefault();
    closeTrailMap();
    return;
  }
  if (e.key !== 'Escape') return;
  if (!menu.isOpen) openMenu();
  else if (menu.canGoBack) closeMenu();
});

/** Switches to a quality preset (and remembers it): view range and decoration. */
function setQuality(q: Quality): void {
  quality = q;
  saveQuality(q);
  applyView();
  level?.world.setQuality(decorDensity(q), viewRange(q).far);
}

/** The current preset's view range on the camera and fog. */
function applyView(): void {
  const range = viewRange(quality);
  setViewRange(view, range.far, range.fogStart);
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

let devPanel: DevPanel | null = null;
if (import.meta.env.DEV) {
  void import('./ui/devPanel.ts').then(({ mountDevPanel }) => {
    devPanel = mountDevPanel({ respawn, backToTop, teleport, setQuality, quality });
    if (level) devPanel.setMap(level.built.map);
  });
  // Handle for inspecting the sim from the browser console while testing.
  Object.assign(window, {
    parkLaps: {
      skier,
      keys,
      camera,
      scene,
      renderer,
      config: CONFIG,
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

// Start on the map menu, or straight on a map named in the URL (?map=park).
const fromUrl = mapEntry(new URLSearchParams(window.location.search).get('map'));
openMenu();
if (fromUrl?.load) void loadMap(fromUrl);

startLoop(
  (dt) => {
    if (!level || menu.isOpen || trailMap.isOpen) return;
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
      holdTime += dt;
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
      if (event === 'finish') finishRace(race);
    }
    if (event === 'flag' && !timedRun()) toast.show(`Checkpoint: flag ${run.flag + 1} of ${built.map.flags.length}`);
    // After a crash, let the tumble play out, then fade and respawn.
    if (skier.bailed && skier.bailTime >= CONFIG.bail.respawnDelay && !fader.busy) fader.fadeOut(respawn);
  },
  (alpha, frameTime) => {
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

    renderer.render(scene, camera);
    fader.update(frameTime);
    crashHint.show(pose.bailed);
    toast.update(frameTime);
    const race = level?.race;
    raceHud.update(timedRun(), race?.time ?? 0, race?.missed ?? 0);
    const result = race?.finished ? `${formatTime(race.time)} · ${missedText(race.missed)}` : '';
    runHud.update(level?.run.finished ?? false, result, heldToTop ? 0 : holdTime);
    fps.frame(frameTime);
    devPanel?.update(pose, skier);
  },
);

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
