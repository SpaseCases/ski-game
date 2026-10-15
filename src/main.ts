import './style.css';
import { createInputState, DEFAULT_BINDINGS, Keyboard } from './core/input.ts';
import { startLoop } from './core/loop.ts';
import { PointerOrbit } from './core/pointerOrbit.ts';
import { buildJumpShapes } from './maps/jumps.ts';
import { parseMap } from './maps/loader.ts';
import { generateSlope } from './maps/terrain.ts';
import { buildRailShapes } from './sim/rails.ts';
import testSlope from './maps/test-slope.json';
import { CONFIG } from './config.ts';
import { ChaseCamera, type OrbitDrag } from './render/chaseCamera.ts';
import { createFeatureMeshes } from './render/features.ts';
import { createView, type View } from './render/scene.ts';
import { createSkierPose, interpolateSkier, SkierView } from './render/skierView.ts';
import { createTerrainMesh } from './render/terrainMesh.ts';
import { copySkierState, createSkierState, placeSkier, stepSkier } from './sim/skier.ts';
import type { DevPanel } from './ui/devPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { Fader } from './ui/fade.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountControlsHint, mountCrashHint, mountFocusHint } from './ui/hints.ts';

const app = byId('app');
const hud = byId('hud');

const map = parseMap(testSlope);
const heightfield = generateSlope(map.terrain);
heightfield.jumps = buildJumpShapes(map.features);
const rails = buildRailShapes(map.features, heightfield);

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

mountWindowButtons(hud);
mountControlsHint(hud);
mountFocusHint(hud);
const fps = mountFpsMeter(hud);
const crashHint = mountCrashHint(hud);
const fader = new Fader(hud);

// Simulation state: the current step and the one before it, for interpolation.
const keyboard = new Keyboard(DEFAULT_BINDINGS);
keyboard.attach(window);
const keys = createInputState();
const skier = createSkierState();
const skierPrev = createSkierState();

// Render state.
const pose = createSkierPose();
const skierView = new SkierView(scene, heightfield);
const chase = new ChaseCamera(camera, heightfield);
const orbit = new PointerOrbit();
orbit.attach(renderer.domElement);
const drag: OrbitDrag = { x: 0, y: 0, active: false };
let snapView = true;

function respawn(): void {
  placeSkier(skier, map.spawn, heightfield);
  copySkierState(skierPrev, skier);
  snapView = true;
}
respawn();

let devPanel: DevPanel | null = null;
if (import.meta.env.DEV) {
  void import('./ui/devPanel.ts').then(({ mountDevPanel }) => {
    devPanel = mountDevPanel({ respawn });
  });
  // Handle for inspecting the sim from the browser console while testing.
  Object.assign(window, { parkLaps: { skier, respawn, config: CONFIG, skierView, camera, rails, heightfield } });
}

startLoop(
  (dt) => {
    keyboard.sample(keys);
    if (keys.respawn.pressed) {
      respawn();
      fader.reveal();
      return;
    }
    copySkierState(skierPrev, skier);
    stepSkier(skier, keys, heightfield, rails, dt);
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

    renderer.render(scene, camera);
    fader.update(frameTime);
    crashHint.show(pose.bailed);
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
