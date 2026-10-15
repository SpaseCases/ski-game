import './style.css';
import { Group, Vector3 } from 'three';
import { createInputState, DEFAULT_BINDINGS, Keyboard } from './core/input.ts';
import { startLoop } from './core/loop.ts';
import { PointerOrbit } from './core/pointerOrbit.ts';
import { decorDensity, loadQuality, saveQuality, type Quality } from './core/settings.ts';
import { decorObstacles, layoutDecor } from './maps/decor.ts';
import { parseMap } from './maps/loader.ts';
import { buildShapes } from './maps/shapes.ts';
import { startFrames, startObstacles, startShapes } from './maps/startGates.ts';
import { generateSlope } from './maps/terrain.ts';
import { buildRailShapes } from './sim/rails.ts';
import testSlope from './maps/test-slope.json';
import { CONFIG } from './config.ts';
import { ChaseCamera, type OrbitDrag } from './render/chaseCamera.ts';
import { CheckpointView } from './render/checkpointMeshes.ts';
import { createDecor, disposeDecor } from './render/decor.ts';
import { createFeatureMeshes } from './render/features.ts';
import { createView, type View } from './render/scene.ts';
import { createSkierPose, interpolateSkier, SkierView } from './render/skierView.ts';
import { SlalomView } from './render/slalomView.ts';
import { StartGateView } from './render/startGates.ts';
import { createTerrainMesh } from './render/terrainMesh.ts';
import { canSetPersonal, createRun, resetRun, respawnSkier, setPersonal, updateRun } from './sim/checkpoints.ts';
import { buildObstacles, type Course } from './sim/obstacles.ts';
import { buildRace, createRace, finishRace, resetRace, stepRace } from './sim/race.ts';
import { copySkierState, createSkierState, placeSkierAt, stepSkier } from './sim/skier.ts';
import type { DevPanel } from './ui/devPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { Fader } from './ui/fade.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountControlsHint, mountCrashHint, mountFocusHint } from './ui/hints.ts';
import { formatTime, missedText, RaceHud } from './ui/raceHud.ts';
import { RunHud } from './ui/runHud.ts';
import { Toast } from './ui/toast.ts';

const app = byId('app');
const hud = byId('hud');

// The map: terrain, the shapes built on it (jumps, pipes, raised starts),
// rails and boxes, and everything solid a rider can run into.
const map = parseMap(testSlope);
const heightfield = generateSlope(map.terrain);
const starts = startFrames(map.features);
heightfield.shapes = [...buildShapes(map.features), ...startShapes(starts)];
const rails = buildRailShapes(map.features, heightfield);
const course: Course = {
  hf: heightfield,
  rails,
  // Solid decoration is the same at every density, so the full layout gives it.
  obstacles: buildObstacles([...startObstacles(starts), ...decorObstacles(layoutDecor(map, heightfield, 1))], heightfield),
};
const raceDef = buildRace(map.features, heightfield);
const race = raceDef ? createRace(raceDef) : null;
let quality: Quality = loadQuality();

let view: View;
try {
  view = createView(app, map);
} catch (err) {
  console.error(err);
  showFatal('This game needs WebGL, which this browser could not start. Try updating Chrome or turning on hardware acceleration.');
  throw err;
}
const { renderer, scene, camera } = view;

scene.add(createTerrainMesh(heightfield, map.terrain.seed));
scene.add(createFeatureMeshes(heightfield, rails));
const startView = new StartGateView(starts, heightfield);
scene.add(startView.group);
const slalomView = raceDef && raceDef.gates.length > 0 ? new SlalomView(raceDef, heightfield) : null;
if (slalomView) scene.add(slalomView.mesh);
let decor: Group = createDecor(layoutDecor(map, heightfield, decorDensity(quality)), heightfield);
scene.add(decor);
const checkpointView = new CheckpointView(map, heightfield);
scene.add(checkpointView.group);

mountWindowButtons(hud);
mountControlsHint(hud);
mountFocusHint(hud);
const fps = mountFpsMeter(hud);
const crashHint = mountCrashHint(hud);
const fader = new Fader(hud);
const toast = new Toast(hud);
const raceHud = new RaceHud(hud);
const runHud = new RunHud(hud, backToTop);

// Simulation state: the current step and the one before it, for interpolation.
const keyboard = new Keyboard(DEFAULT_BINDINGS);
keyboard.attach(window);
const keys = createInputState();
const skier = createSkierState();
const skierPrev = createSkierState();
const run = createRun(map);
/** Seconds R has been held; past CONFIG.checkpoints.holdToTop it goes back to the top, once per hold. */
let holdTime = 0;
let heldToTop = false;

// Render state.
const pose = createSkierPose();
const skierView = new SkierView(scene, heightfield);
const chase = new ChaseCamera(camera, heightfield);
const orbit = new PointerOrbit();
orbit.attach(renderer.domElement);
const drag: OrbitDrag = { x: 0, y: 0, active: false };
let snapView = true;

/** True from the timing wand until back to the start (a timed run, finished or not). */
function timedRun(): boolean {
  return race !== null && (race.running || race.finished);
}

/** Back to the latest checkpoint; on a timed run, back to the start house for another go. */
function respawn(): void {
  const start = raceDef?.start;
  if (race && start && timedRun()) {
    resetRace(race);
    run.finished = false;
    placeSkierAt(skier, start.x, start.z, start.heading, heightfield);
  } else {
    respawnSkier(run, skier, map, heightfield);
  }
  copySkierState(skierPrev, skier);
  snapView = true;
  fader.reveal();
}

/** A fresh run from the top: every checkpoint and passed flag is forgotten. */
function backToTop(): void {
  resetRun(run);
  if (race) resetRace(race);
  respawn();
}
respawn();

/** Redraws the decoration for a quality preset (and remembers it). */
function setQuality(q: Quality): void {
  quality = q;
  saveQuality(q);
  scene.remove(decor);
  disposeDecor(decor);
  decor = createDecor(layoutDecor(map, heightfield, decorDensity(q)), heightfield);
  scene.add(decor);
}

/** Dev testing: puts the skier at (x, z) facing `heading` (radians), moving along the skis at `speed`. */
const tmp = new Vector3();
function teleport(x: number, z: number, heading: number, speed: number): void {
  resetRun(run);
  if (race) resetRace(race);
  placeSkierAt(skier, x, z, heading, heightfield);
  skier.velocity.copy(tmp.set(0, 0, -1).applyQuaternion(skier.orient)).multiplyScalar(speed);
  copySkierState(skierPrev, skier);
  snapView = true;
}

let devPanel: DevPanel | null = null;
if (import.meta.env.DEV) {
  void import('./ui/devPanel.ts').then(({ mountDevPanel }) => {
    devPanel = mountDevPanel({ respawn, backToTop, teleport, setQuality, quality, map });
  });
  // Handle for inspecting the sim from the browser console while testing.
  Object.assign(window, {
    parkLaps: { skier, run, race, raceDef, map, respawn, backToTop, teleport, setQuality, config: CONFIG, skierView, camera, course, keys },
  });
}

startLoop(
  (dt) => {
    keyboard.sample(keys);
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
    stepSkier(skier, keys, course, dt);
    const event = updateRun(run, map, skierPrev.position, skier);
    if (race && raceDef) {
      const raceEvent = stepRace(race, raceDef, skierPrev.position, skier, dt);
      if (raceEvent === 'missed') toast.show('Missed gate');
      if (event === 'finish') finishRace(race);
    }
    if (event === 'flag' && !timedRun()) toast.show(`Checkpoint: flag ${run.flag + 1} of ${map.flags.length}`);
    // After a crash, let the tumble play out, then fade and respawn.
    if (skier.bailed && skier.bailTime >= CONFIG.bail.respawnDelay && !fader.busy) fader.fadeOut(respawn);
  },
  (alpha, frameTime) => {
    interpolateSkier(pose, skierPrev, skier, alpha);
    if (snapView) {
      skierView.snap(pose);
      chase.snap(pose);
      snapView = false;
    }
    skierView.update(pose, frameTime);
    orbit.take(drag);
    drag.active = orbit.dragging;
    chase.update(pose, frameTime, drag);
    startView.update(race ? race.wandTime : Infinity);
    slalomView?.update(race);

    renderer.render(scene, camera);
    fader.update(frameTime);
    crashHint.show(pose.bailed);
    checkpointView.update(run, heightfield, frameTime);
    toast.update(frameTime);
    raceHud.update(timedRun(), race?.time ?? 0, race?.missed ?? 0);
    const result = race?.finished ? `${formatTime(race.time)} · ${missedText(race.missed)}` : '';
    runHud.update(run.finished, result, heldToTop ? 0 : holdTime);
    fps.frame(frameTime);
    devPanel?.update(pose, skier);
  },
);

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
