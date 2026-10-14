import './style.css';
import { createInputState, DEFAULT_BINDINGS, Keyboard } from './core/input.ts';
import { startLoop } from './core/loop.ts';
import { parseMap } from './maps/loader.ts';
import { generateSlope } from './maps/terrain.ts';
import testSlope from './maps/test-slope.json';
import { ChaseCamera } from './render/chaseCamera.ts';
import { createFeatureMeshes } from './render/features.ts';
import { createView, type View } from './render/scene.ts';
import { createSkierPose, interpolateSkier, SkierView } from './render/skierView.ts';
import { createTerrainMesh } from './render/terrainMesh.ts';
import { copySkierState, createSkierState, placeSkier, stepSkier } from './sim/skier.ts';
import type { DevPanel } from './ui/devPanel.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { mountFpsMeter } from './ui/fps.ts';
import { mountControlsHint, mountFocusHint } from './ui/hints.ts';

const app = byId('app');
const hud = byId('hud');

const map = parseMap(testSlope);
const heightfield = generateSlope(map.terrain);

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
scene.add(createFeatureMeshes(map.features, heightfield));

mountWindowButtons(hud);
mountControlsHint(hud);
mountFocusHint(hud);
const fps = mountFpsMeter(hud);

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
}

startLoop(
  (dt) => {
    keyboard.sample(keys);
    if (keys.respawn.pressed) {
      respawn();
      return;
    }
    copySkierState(skierPrev, skier);
    stepSkier(skier, keys, heightfield, dt);
  },
  (alpha, frameTime) => {
    interpolateSkier(pose, skierPrev, skier, alpha);
    if (snapView) {
      skierView.snap(pose);
      chase.snap(pose);
      snapView = false;
    }
    skierView.update(pose, frameTime);
    chase.update(pose, frameTime);

    renderer.render(scene, camera);
    fps.frame(frameTime);
    devPanel?.update(pose);
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
