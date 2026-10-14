// Pose showcase: every skier pose side by side in a static scene, one view
// per pose. Not part of the game; it's for reviewing the model and poses.
import './style.css';
import './poses.css';
import {
  BufferAttribute,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CONFIG } from './config.ts';
import { SkierRig } from './render/skierRig.ts';
import {
  CROUCH,
  LEFT_JAPAN,
  LEFT_MUTE,
  LEFT_SAFETY,
  LEFT_TAIL,
  type PoseDef,
  RIGHT_JAPAN,
  RIGHT_MUTE,
  RIGHT_SAFETY,
  RIGHT_TAIL,
  STANCE,
  TUCK,
} from './render/skierPoses.ts';

interface Entry {
  name: string;
  note: string;
  pose: PoseDef;
  airborne: boolean;
}

// Grid order, left to right and top to bottom; null is the info card.
const ENTRIES: (Entry | null)[] = [
  { name: 'Stance', note: 'Riding on the snow', pose: STANCE, airborne: false },
  { name: 'Crouch', note: 'Loading a pop (hold ↑)', pose: CROUCH, airborne: false },
  { name: 'Tuck', note: 'Low and fast', pose: TUCK, airborne: false },
  null,
  { name: 'Left mute', note: 'Left hand, right ski, outside edge in front of the boot', pose: LEFT_MUTE, airborne: true },
  { name: 'Right mute', note: 'Right hand, left ski, outside edge in front of the boot', pose: RIGHT_MUTE, airborne: true },
  { name: 'Left safety', note: 'Left hand, left ski, outside edge beside the boot', pose: LEFT_SAFETY, airborne: true },
  { name: 'Right safety', note: 'Right hand, right ski, outside edge beside the boot', pose: RIGHT_SAFETY, airborne: true },
  { name: 'Left japan', note: 'Left hand on the left ski’s inside edge, ski tweaked up behind', pose: LEFT_JAPAN, airborne: true },
  { name: 'Right japan', note: 'Right hand on the right ski’s inside edge, ski tweaked up behind', pose: RIGHT_JAPAN, airborne: true },
  { name: 'Left tail', note: 'Left hand back to the left ski’s tail', pose: LEFT_TAIL, airborne: true },
  { name: 'Right tail', note: 'Right hand back to the right ski’s tail', pose: RIGHT_TAIL, airborne: true },
];

const COLS = 4;
const ROWS = 3;
const AIR_HEIGHT = 0.55;

const app = document.getElementById('app');
const cells = document.getElementById('cells');
if (!app || !cells) throw new Error('poses.html is missing #app or #cells');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
app.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#dce8f3');
scene.add(new HemisphereLight('#9fc3e6', '#7d8796', CONFIG.light.hemiIntensity));
const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
const from = CONFIG.light.sunFrom;
sun.position.set(from.x, from.y, from.z).normalize();
scene.add(sun);

// A faceted snow pad and a soft shadow under the one skier drawn per view.
const snow = new Mesh(
  new CircleGeometry(1.4, 9).rotateX(-Math.PI / 2),
  new MeshLambertMaterial({ color: '#f5f8fc', flatShading: true }),
);
scene.add(snow);
const shadowDisc = new CircleGeometry(0.6, 16).rotateX(-Math.PI / 2);
const shadowAlpha = new Float32Array(shadowDisc.getAttribute('position').count * 4).fill(1);
for (let i = 1; i < shadowAlpha.length / 4; i++) shadowAlpha[i * 4 + 3] = 0;
shadowDisc.setAttribute('color', new BufferAttribute(shadowAlpha, 4));
const shadow = new Mesh(
  shadowDisc,
  new MeshBasicMaterial({ color: '#0b1a2a', vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false }),
);
shadow.position.y = 0.005;
scene.add(shadow);

const camera = new PerspectiveCamera(30, 1, 0.1, 50);

const rigs = ENTRIES.map((entry) => {
  if (!entry) return null;
  const rig = new SkierRig();
  rig.apply(entry.pose);
  rig.root.position.y = entry.airborne ? AIR_HEIGHT : 0;
  rig.root.visible = false;
  scene.add(rig.root);
  return rig;
});

// Labels laid over the grid.
ENTRIES.forEach((entry, i) => {
  const cell = document.createElement('div');
  cell.className = 'cell';
  if (entry) {
    const label = document.createElement('div');
    label.className = 'cell-label';
    const title = document.createElement('strong');
    title.textContent = entry.name;
    label.append(title, entry.note);
    const error = rigs[i]?.reachError ?? 0;
    if (error > 0.02) {
      const warn = document.createElement('div');
      warn.className = 'reach-warning';
      warn.textContent = `Hand or foot ${Math.round(error * 100)} cm short of its target`;
      label.append(warn);
    }
    cell.append(label);
  } else {
    cell.classList.add('cell-info');
    cell.innerHTML =
      '<h1>Park Laps · skier poses</h1>' +
      '<p>Low-poly skier with procedural poses. Grabs are shown mid-air.</p>' +
      '<p><strong>← →</strong> rotate every view · <strong>↑ ↓</strong> tilt · <strong>0</strong> reset</p>';
  }
  cells.append(cell);
});

// View angle shared by all cells: 0 looks at the skier's front.
const DEFAULT_YAW = 0.6;
const DEFAULT_PITCH = 0.18;
let viewYaw = DEFAULT_YAW;
let viewPitch = DEFAULT_PITCH;
const held = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
  if (e.key === '0') {
    viewYaw = DEFAULT_YAW;
    viewPitch = DEFAULT_PITCH;
  }
  held.add(e.key);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());
window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  viewYaw += ((held.has('ArrowLeft') ? 1 : 0) - (held.has('ArrowRight') ? 1 : 0)) * 1.5 * dt;
  viewPitch += ((held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0)) * 0.8 * dt;
  viewPitch = Math.min(1.2, Math.max(-0.2, viewPitch));

  const w = window.innerWidth / COLS;
  const h = window.innerHeight / ROWS;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  ENTRIES.forEach((entry, i) => {
    const rig = rigs[i];
    if (!entry || !rig) return;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * w;
    const y = window.innerHeight - (row + 1) * h;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);

    const lift = entry.airborne ? AIR_HEIGHT : 0;
    const targetY = 0.92 + lift * 0.55;
    const dist = 4.1;
    camera.position.set(
      Math.sin(viewYaw) * Math.cos(viewPitch) * dist,
      targetY + Math.sin(viewPitch) * dist,
      -Math.cos(viewYaw) * Math.cos(viewPitch) * dist,
    );
    camera.lookAt(0, targetY, 0);

    rig.root.visible = true;
    renderer.render(scene, camera);
    rig.root.visible = false;
  });
}
requestAnimationFrame(frame);
