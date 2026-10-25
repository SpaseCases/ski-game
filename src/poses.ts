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
  CylinderGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CONFIG } from './config.ts';
import type { Heightfield } from './maps/types.ts';
import { createSkierPose, SkierView, type SkierPose } from './render/skierView.ts';
import { SkierRig } from './render/skierRig.ts';
import { COLOR_PARTS, DEFAULT_OUTFIT, HEADWEAR, type Outfit } from './core/outfit.ts';
import {
  CROUCH,
  DAFFY,
  IRON_CROSS,
  LEFT_JAPAN,
  LEFT_MUTE,
  LEFT_NOSE,
  LEFT_SAFETY,
  LEFT_TAIL,
  type PoseDef,
  RIGHT_JAPAN,
  RIGHT_MUTE,
  RIGHT_NOSE,
  RIGHT_SAFETY,
  RIGHT_TAIL,
  SEAMAN,
  SPREAD_EAGLE,
  STANCE,
  TUCK,
  TUMBLE,
} from './render/skierPoses.ts';

interface Entry {
  name: string;
  note: string;
  /** A pose drawn straight from the rig, or a riding state drawn the way the game draws it. */
  pose?: PoseDef;
  ride?: Partial<RideState>;
  airborne: boolean;
}

/** The riding state the game turns into a pose (see SkierView). */
interface RideState {
  speed: number;
  crouch: number;
  lean: number;
  brake: number;
  brakeSide: number;
  onRail: boolean;
  railYaw: number;
  /** How far through a pole push (0..1); 1 is not pushing. */
  polePhase: number;
  /** Butter: 1 on the tips, -1 on the tails. */
  butter: number;
}

const RAIL_HEIGHT = 0.45;

// Grid order, left to right and top to bottom; null is the info card.
const POSES: (Entry | null)[] = [
  { name: 'Stance', note: 'Riding on the snow', pose: STANCE, airborne: false },
  { name: 'Crouch', note: 'Loading a pop (hold ↑)', pose: CROUCH, airborne: false },
  { name: 'Tuck', note: 'Low and fast', pose: TUCK, airborne: false },
  null,
  { name: 'Left mute', note: 'Left hand, right ski, outside edge in front of the boot', pose: LEFT_MUTE, airborne: true },
  { name: 'Right mute', note: 'Right hand, left ski, outside edge in front of the boot', pose: RIGHT_MUTE, airborne: true },
  { name: 'Left safety', note: 'Left hand, left ski, outside edge beside the boot', pose: LEFT_SAFETY, airborne: true },
  { name: 'Right safety', note: 'Right hand, right ski, outside edge beside the boot', pose: RIGHT_SAFETY, airborne: true },
  { name: 'Left japan', note: 'Left hand behind the leg to the left ski’s inside edge; tail up behind', pose: LEFT_JAPAN, airborne: true },
  { name: 'Right japan', note: 'Right hand behind the leg to the right ski’s inside edge; tail up behind', pose: RIGHT_JAPAN, airborne: true },
  { name: 'Left tail', note: 'Left hand back to the left ski’s tail', pose: LEFT_TAIL, airborne: true },
  { name: 'Right tail', note: 'Right hand back to the right ski’s tail', pose: RIGHT_TAIL, airborne: true },
  { name: 'Left nose', note: 'Left hand forward to the left ski’s nose, tip pulled up', pose: LEFT_NOSE, airborne: true },
  { name: 'Right nose', note: 'Right hand forward to the right ski’s nose, tip pulled up', pose: RIGHT_NOSE, airborne: true },
  { name: 'Screamin’ seaman', note: 'Right leg kicked out front, left ski held up behind, chest out', pose: SEAMAN, airborne: true },
  { name: 'Daffy', note: 'One ski forward, one back', pose: DAFFY, airborne: true },
  { name: 'Iron cross', note: 'Heels up behind, ski tips crossed', pose: IRON_CROSS, airborne: true },
  { name: 'Spread eagle', note: 'Arms and legs flung out wide', pose: SPREAD_EAGLE, airborne: true },
  { name: 'Tumble', note: 'Crash: balled up, rolling to a stop', pose: TUMBLE, airborne: true },
  { name: 'Carve', note: 'In game: hard left turn at speed', ride: { speed: 12, lean: 0.85 }, airborne: false },
  { name: 'Crouch carve', note: 'In game: loading a pop mid-turn', ride: { speed: 5, crouch: 1, lean: 0.6 }, airborne: false },
  { name: 'Tuck', note: 'In game: holding ↑ fast', ride: { speed: 15, crouch: 1 }, airborne: false },
  { name: 'Tuck carve', note: 'In game: tucked in a hard left turn', ride: { speed: 15, crouch: 1, lean: 0.85 }, airborne: false },
  { name: 'Hockey stop', note: 'In game: full brake', ride: { speed: 8, brake: 1, brakeSide: 1 }, airborne: false },
  { name: 'Rail', note: 'In game: sliding a rail sideways', ride: { speed: 6, onRail: true, railYaw: Math.PI / 2 }, airborne: false },
  { name: 'Nose press', note: 'In game: buttering on the tips (nose grab key on the snow)', ride: { speed: 6, butter: 1 }, airborne: false },
  { name: 'Tail press', note: 'In game: buttering on the tails (tail grab key on the snow)', ride: { speed: 6, butter: -1 }, airborne: false },
];

/** ?set=poling: a pole push from the stance, a crouch and a tuck, at five points through the stroke. */
const STROKE_POINTS: readonly [number, string][] = [
  [0.07, 'reaching'],
  [0.15, 'planted'],
  [0.4, 'pushing'],
  [0.65, 'pushed through'],
  [0.85, 'swinging back'],
];
const POLING: (Entry | null)[] = [
  ...([
    ['Stance', { speed: 4 }],
    ['Crouch', { speed: 4, crouch: 1 }],
    ['Tuck', { speed: 15, crouch: 1 }],
  ] as const).flatMap(([name, ride]) =>
    STROKE_POINTS.map(([phase, what]) => ({ name: `${name} pole push`, note: `${what} (${phase})`, ride: { ...ride, polePhase: phase }, airborne: false })),
  ),
  null,
];
const ENTRIES = new URLSearchParams(window.location.search).get('set') === 'poling' ? POLING : POSES;

const COLS = 6;
const ROWS = 5;
const AIR_HEIGHT = 0.55;

const app = document.getElementById('app');
const cells = document.getElementById('cells');
if (!app || !cells) throw new Error('poses.html is missing #app or #cells');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
app.appendChild(renderer.domElement);

// Every view has its own scene: lights, a faceted snow pad and a soft shadow.
const snowGeometry = new CircleGeometry(1.4, 9).rotateX(-Math.PI / 2);
const snowMaterial = new MeshLambertMaterial({ color: '#f5f8fc', flatShading: true });
const shadowDisc = new CircleGeometry(0.6, 16).rotateX(-Math.PI / 2);
const shadowAlpha = new Float32Array(shadowDisc.getAttribute('position').count * 4).fill(1);
for (let i = 1; i < shadowAlpha.length / 4; i++) shadowAlpha[i * 4 + 3] = 0;
shadowDisc.setAttribute('color', new BufferAttribute(shadowAlpha, 4));
const shadowMaterial = new MeshBasicMaterial({
  color: '#0b1a2a',
  vertexColors: true,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const railGeometry = new CylinderGeometry(0.045, 0.045, 2.4, 6).rotateX(Math.PI / 2);
const railMaterial = new MeshLambertMaterial({ color: '#b4bec8', flatShading: true });

function makeScene(): Scene {
  const scene = new Scene();
  scene.background = new Color('#dce8f3');
  scene.add(new HemisphereLight('#9fc3e6', '#7d8796', CONFIG.light.hemiIntensity));
  const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
  const from = CONFIG.light.sunFrom;
  sun.position.set(from.x, from.y, from.z).normalize();
  scene.add(sun);
  scene.add(new Mesh(snowGeometry, snowMaterial));
  return scene;
}

// Flat snow for the riding views.
const flat: Heightfield = {
  cols: 5,
  rows: 5,
  cellSize: 2,
  originX: -4,
  originZ: -4,
  heights: new Float32Array(25),
  bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4, polygon: new Float32Array(0) },
};

const RIDE_DEFAULTS: RideState = { speed: 0, crouch: 0, lean: 0, brake: 0, brakeSide: 1, onRail: false, railYaw: 0, polePhase: 1, butter: 0 };

/** The interpolated state the game would hand SkierView while riding like this. */
function ridePose(r: RideState): SkierPose {
  const pose = createSkierPose();
  pose.position.set(0, r.onRail ? RAIL_HEIGHT : 0, 0);
  pose.center.copy(pose.position).add(new Vector3(0, CONFIG.air.comHeight, 0));
  pose.velocity.set(0, 0, -r.speed);
  pose.crouch = r.crouch;
  pose.lean = r.lean;
  pose.brake = r.brake;
  pose.brakeSide = r.brakeSide;
  pose.onRail = r.onRail;
  pose.yaw = r.railYaw;
  pose.polePhase = r.polePhase;
  pose.butter = r.butter;
  pose.butterAmount = r.butter !== 0 ? 1 : 0;
  return pose;
}

const camera = new PerspectiveCamera(30, 1, 0.1, 50);

// ?headwear=santa (or pumpkin) dresses every pose in it, ?jacket=23898a (any color part, hex
// without the #) recolors that part, and ?glow=1 lights the pumpkin's face.
const params = new URLSearchParams(window.location.search);
const outfit: Outfit = { ...DEFAULT_OUTFIT };
const headwear = HEADWEAR.find((h) => h.id === params.get('headwear'));
if (headwear) outfit.headwear = headwear.id;
for (const { id } of COLOR_PARTS) {
  const hex = params.get(id);
  if (hex && /^[0-9a-f]{6}$/i.test(hex)) outfit[id] = `#${hex}`;
}
const glow = Number(params.get('glow') ?? 0);

interface View {
  scene: Scene;
  rig: SkierRig;
  /** Height the skier is lifted off the snow. */
  lift: number;
}

const views: (View | null)[] = ENTRIES.map((entry) => {
  if (!entry) return null;
  const scene = makeScene();
  if (entry.pose) {
    const rig = new SkierRig(outfit);
    rig.setGlow(glow);
    rig.apply(entry.pose);
    const lift = entry.airborne ? AIR_HEIGHT : 0;
    rig.root.position.y = lift;
    scene.add(rig.root);
    const shadow = new Mesh(shadowDisc, shadowMaterial);
    shadow.position.y = 0.005;
    scene.add(shadow);
    return { scene, rig, lift };
  }
  // Riding states go through SkierView, which adds its own shadow.
  const view = new SkierView(scene, flat, outfit);
  view.rig.setGlow(glow);
  const pose = ridePose({ ...RIDE_DEFAULTS, ...entry.ride });
  view.snap(pose);
  view.update(pose, 1);
  if (pose.onRail) {
    const rail = new Mesh(railGeometry, railMaterial);
    rail.position.y = RAIL_HEIGHT - 0.045;
    scene.add(rail);
  }
  return { scene, rig: view.rig, lift: pose.onRail ? RAIL_HEIGHT : 0 };
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
    const reach = views[i]?.rig.reachError ?? 0;
    const ankle = views[i]?.rig.ankleError ?? 0;
    const problems: string[] = [];
    if (reach > 0.02) problems.push(`Hand or foot ${Math.round(reach * 100)} cm short of its target`);
    if (ankle > 0) problems.push(`Boot bent ${Math.round(ankle)}° past what an ankle allows`);
    for (const text of problems) {
      const warn = document.createElement('div');
      warn.className = 'reach-warning';
      warn.textContent = text;
      label.append(warn);
    }
    cell.append(label);
  } else {
    cell.classList.add('cell-info');
    cell.innerHTML =
      '<h1>Park Laps · skier poses</h1>' +
      '<p>Low-poly skier with procedural poses. Grabs are shown mid-air.</p>' +
      '<p><strong>← →</strong> rotate every view · <strong>↑ ↓</strong> tilt · <strong>+ −</strong> zoom · <strong>F</strong> zoom on head or feet · <strong>0</strong> reset</p>';
  }
  cells.append(cell);
});

// View angle shared by all cells: 0 looks at the skier's front.
// ?yaw=, ?pitch= and ?zoom= start from another angle (for repeatable screenshots).
const DEFAULT_YAW = Number(params.get('yaw') ?? 0.6);
const DEFAULT_PITCH = Number(params.get('pitch') ?? 0.18);
const DEFAULT_ZOOM = Number(params.get('zoom') ?? 1);
let viewYaw = DEFAULT_YAW;
let viewPitch = DEFAULT_PITCH;
let zoom = DEFAULT_ZOOM;
let focusFeet = false;
const held = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
  if (e.key === 'f' || e.key === 'F') focusFeet = !focusFeet;
  if (e.key === '0') {
    viewYaw = DEFAULT_YAW;
    viewPitch = DEFAULT_PITCH;
    zoom = DEFAULT_ZOOM;
  }
  if (e.key === '+' || e.key === '=') zoom = Math.min(4, zoom * 1.25);
  if (e.key === '-' || e.key === '_') zoom = Math.max(0.6, zoom / 1.25);
  held.add(e.key);
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());
window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

const focus = new Vector3();
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
    const view = views[i];
    if (!entry || !view) return;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * w;
    const y = window.innerHeight - (row + 1) * h;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);

    // Aim at the body; zooming in slides the aim to this pose's head (or feet).
    const lift = view.lift;
    const toFocus = Math.min(1, (zoom - 1) / 1.5);
    view.rig.root.updateWorldMatrix(true, false);
    focus.copy(focusFeet ? view.rig.feetCenter : view.rig.headCenter).applyMatrix4(view.rig.root.matrixWorld);
    const tx = focus.x * toFocus;
    const ty = (0.92 + lift * 0.55) * (1 - toFocus) + focus.y * toFocus;
    const tz = focus.z * toFocus;
    const dist = 4.1 / zoom;
    camera.position.set(
      tx + Math.sin(viewYaw) * Math.cos(viewPitch) * dist,
      ty + Math.sin(viewPitch) * dist,
      tz - Math.cos(viewYaw) * Math.cos(viewPitch) * dist,
    );
    camera.lookAt(tx, ty, tz);

    renderer.render(view.scene, camera);
  });
}
requestAnimationFrame(frame);
