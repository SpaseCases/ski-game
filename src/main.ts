import './style.css';
import { CONFIG } from './config.ts';
import { startLoop } from './core/loop.ts';
import { parseMap } from './maps/loader.ts';
import { generateSlope } from './maps/terrain.ts';
import testSlope from './maps/test-slope.json';
import { createFeatureMeshes } from './render/features.ts';
import { createView, type View } from './render/scene.ts';
import { createTerrainMesh } from './render/terrainMesh.ts';
import { heightAt } from './sim/terrain.ts';
import { mountWindowButtons } from './ui/embed.ts';
import { mountFpsMeter } from './ui/fps.ts';

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
const fps = mountFpsMeter(hud);

// Milestone 0 has no rider yet: the camera slowly orbits the first feature.
const first = map.features[0];
const focusX = first ? first.x : map.spawn.x;
const focusZ = first ? first.z : map.spawn.z;
const focusY = heightAt(heightfield, focusX, focusZ) + 1;

const sim = { time: 0, prevTime: 0 };

startLoop(
  (dt) => {
    sim.prevTime = sim.time;
    sim.time += dt;
  },
  (alpha, frameTime) => {
    const t = sim.prevTime + (sim.time - sim.prevTime) * alpha;
    const angle = t * CONFIG.camera.orbitSpeed;
    const cx = focusX + Math.sin(angle) * CONFIG.camera.orbitRadius;
    const cz = focusZ + Math.cos(angle) * CONFIG.camera.orbitRadius;
    camera.position.set(cx, heightAt(heightfield, cx, cz) + CONFIG.camera.orbitHeight, cz);
    camera.lookAt(focusX, focusY, focusZ);

    renderer.render(scene, camera);
    fps.frame(frameTime);
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
