import { Color, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Vector3, type BufferGeometry, type Mesh } from 'three';
import { CONFIG } from '../config.ts';
import { hash2 } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';
import { chairAt, LIFT, outAt, type ChairSpot, type LiftPath, type Lifts } from '../sim/lift.ts';
import { MeshKit } from './meshKit.ts';
import { PALETTE } from './models.ts';
import { renderedHeightAt } from './terrainMesh.ts';
import { uploadFirst } from './upload.ts';

// The chairlift riders can take (milestone 17), drawn from the sim's own
// loop and clock (sim/lift.ts), so the chair the skier sits on is one of
// these. A detachable quad: padded four-seat chairs on a bent hanger, each
// with a safety bar and footrests that swing down once it's out of the
// station and back up before the next; tube towers on padded footings, with
// a crossarm, sheave trains and a catwalk; and at each end a terminal: a
// long housing on two columns, its bullwheel turning under it, an
// operator's booth beside it and a mat where riders load or get off.
// Chairs, bars, riders and wheels are instanced (four draw calls for all of
// them); the towers, cables and stations are merged into a few meshes along
// the line, which the renderer culls by view.

/** Chairs this far (m) past the view range are still placed. */
const SLACK = 40;
/** Towers (and the cable between them) merged per mesh. */
const TOWERS_PER_MESH = 5;
/** A chair's safety bar: its pivot in the chair (on the carrier bar), and how far it swings up (radians). */
const BAR_PIVOT = { y: -1.75, z: 0.42 };
const BAR_UP = 1.65;
/** The bar comes down between these distances (m) out of a station, going up the line. */
const BAR_FROM = 12;
const BAR_DOWN = 30;

const PAD = new Color('#b3261c');
const PAD_DARK = new Color('#8f1d15');
const FRAME = new Color('#2b3440');
const GALVANIZED = new Color('#a9b3bc');
const CONCRETE = new Color('#b7bcc2');
const HOUSING = new Color('#e9edf2');
const HOUSING_SHADE = new Color('#cfd6de');
const GLASS = new Color('#27394f');
const STRIPE = new Color('#c8331f');
const MAT = new Color('#2f9a5a');
const RIDER_COLORS = ['#c8331f', '#2f6fe0', '#33c26a', '#e0c21f', '#8a4fd6', '#ff7a1a', '#1b2430', '#f4f6fa'].map((h) => new Color(h));

const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** The riders' own (per-rider jacket colors need another shader program). */
const riderMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

interface Line {
  path: LiftPath;
  /** Riders on each chair going up (0 to 3: the skier's seat stays free). */
  riders: Uint8Array;
}

const spot: ChairSpot = { x: 0, y: 0, z: 0, yaw: 0, s: 0 };
const mChair = new Matrix4();
const mTilt = new Matrix4();
const mBar = new Matrix4();
const mShift = new Matrix4();

export class ExpressLiftView {
  readonly group = new Group();
  private readonly lifts: Lifts;
  private readonly lines: Line[] = [];
  private readonly chairs: InstancedMesh;
  private readonly bars: InstancedMesh;
  private readonly riders: InstancedMesh;
  private readonly wheels: InstancedMesh;

  constructor(lifts: Lifts, hf: Heightfield) {
    this.lifts = lifts;
    let chairCount = 0;
    lifts.paths.forEach((path, i) => {
      const riders = new Uint8Array(path.chairs);
      for (let c = 0; c < path.chairs; c++) {
        const r = 0.5 + 0.5 * hash2(c, i, 31);
        riders[c] = r < 0.4 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
      }
      this.lines.push({ path, riders });
      chairCount += path.chairs;
      for (const mesh of staticMeshes(path, hf)) this.group.add(mesh);
    });
    this.chairs = new InstancedMesh(chairGeometry(), material, Math.max(1, chairCount));
    this.bars = new InstancedMesh(barGeometry(), material, Math.max(1, chairCount));
    this.riders = new InstancedMesh(riderGeometry(), riderMaterial, Math.max(1, chairCount * 3));
    this.wheels = new InstancedMesh(wheelGeometry(), material, Math.max(1, lifts.paths.length * 2));
    for (let k = 0; k < chairCount * 3; k++) this.riders.setColorAt(k, RIDER_COLORS[0]!);
    for (const m of [this.chairs, this.bars, this.riders, this.wheels]) {
      // Placed every frame, so their bounds are never known ahead: always drawn (only the near ones are in the list).
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.count = 0;
      this.group.add(m);
    }
    this.group.matrixAutoUpdate = false;
  }

  /** Places the chairs within `range` m of the camera at (cx, cz), as the lifts' clock stands `alpha` of the way through the sim's last step. */
  update(alpha: number, cx: number, cz: number, range: number): void {
    const lifts = this.lifts;
    const clock = lifts.prev + (lifts.clock - lifts.prev) * alpha;
    const reach2 = (range + SLACK) * (range + SLACK);
    const cm = this.chairs.instanceMatrix.array as Float32Array;
    const bm = this.bars.instanceMatrix.array as Float32Array;
    const rm = this.riders.instanceMatrix.array as Float32Array;
    const wm = this.wheels.instanceMatrix.array as Float32Array;
    const colors = this.riders.instanceColor?.array as Float32Array | undefined;
    let chairs = 0;
    let riders = 0;
    let wheels = 0;
    for (let l = 0; l < this.lines.length; l++) {
      const { path, riders: seats } = this.lines[l]!;
      for (let c = 0; c < path.chairs; c++) {
        chairAt(path, clock, c, spot);
        const dx = spot.x - cx;
        const dz = spot.z - cz;
        if (dx * dx + dz * dz > reach2) continue;
        const up = spot.s < path.upLength;
        const out = outAt(path, spot.s);
        // A little swing: with the wind, and back as the chair speeds out of a station.
        const leaving = up ? Math.max(0, 1 - Math.abs(out - 20) / 14) : 0;
        const swing = 0.025 * Math.sin(clock * 1.1 + c * 1.7) - 0.09 * leaving;
        mChair.makeRotationY(spot.yaw).multiply(mTilt.makeRotationX(swing)).setPosition(spot.x, spot.y, spot.z);
        mChair.toArray(cm, chairs * 16);
        // The bar: down on the way up the line, up through the stations and all the way back down.
        const down = up ? smooth(BAR_FROM, BAR_DOWN, out) : 0;
        mBar.copy(mChair).multiply(mShift.makeTranslation(0, BAR_PIVOT.y, BAR_PIVOT.z)).multiply(mTilt.makeRotationX(BAR_UP * (1 - down)));
        mBar.toArray(bm, chairs * 16);
        chairs++;
        // Riders: on from the loading point to the top.
        const n = up && spot.s > path.loadS && spot.s < path.unloadS ? seats[c]! : 0;
        for (let r = 0; r < n; r++) {
          mBar.copy(mChair).multiply(mShift.makeTranslation(LIFT.seats[r]!, 0, 0));
          mBar.toArray(rm, riders * 16);
          if (colors) {
            const color = RIDER_COLORS[Math.floor((0.5 + 0.5 * hash2(c * 3 + r, l, 7)) * RIDER_COLORS.length) % RIDER_COLORS.length]!;
            colors[riders * 3] = color.r;
            colors[riders * 3 + 1] = color.g;
            colors[riders * 3 + 2] = color.b;
          }
          riders++;
        }
      }
      // The bullwheels turn with the cable (at the stations' pace).
      const angle = (clock * CONFIG.lift.stationSpeed) / LIFT.arm;
      for (const end of [0, 1] as const) {
        const p = end === 0 ? path.bottom : path.top;
        const dx = p.x - cx;
        const dz = p.z - cz;
        if (dx * dx + dz * dz > reach2) continue;
        mChair.makeRotationY(angle).setPosition(p.x, path.floorY[end] + CONFIG.lift.stationCable + 0.16, p.z);
        mChair.toArray(wm, wheels * 16);
        wheels++;
      }
    }
    this.chairs.count = chairs;
    this.bars.count = chairs;
    this.riders.count = riders;
    this.wheels.count = wheels;
    uploadFirst(this.chairs.instanceMatrix, chairs * 16);
    uploadFirst(this.bars.instanceMatrix, chairs * 16);
    uploadFirst(this.riders.instanceMatrix, riders * 16);
    if (this.riders.instanceColor) uploadFirst(this.riders.instanceColor, riders * 3);
    uploadFirst(this.wheels.instanceMatrix, wheels * 16);
  }
}

function smooth(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- the chair
/**
 * A four-seat chair hanging from its grip on the cable (the local origin),
 * facing -Z: the grip, a hanger bent back over the riders' heads, the
 * carrier bar, a frame at each end with an armrest, the seat with a pad per
 * rider, and a padded back.
 */
function chairGeometry(): BufferGeometry {
  const k = new MeshKit();
  const seat = -LIFT.hang;
  const half = 1.08;
  // Grip and its housing.
  k.box(0, 0.02, 0, 0.18, 0.16, 0.56, FRAME);
  k.box(0, -0.14, 0, 0.12, 0.2, 0.3, PALETTE.metalDark);
  // The hanger: down, back, then down behind the riders to the carrier bar.
  k.beam(0, -0.2, 0, 0, -0.62, 0.42, 0.1, FRAME);
  k.beam(0, -0.62, 0.42, 0, BAR_PIVOT.y, BAR_PIVOT.z, 0.1, FRAME);
  k.beam(-half, BAR_PIVOT.y, BAR_PIVOT.z, half, BAR_PIVOT.y, BAR_PIVOT.z, 0.09, FRAME);
  for (const x of [-half, half]) {
    // The end frame: down the back, under the seat, and an armrest.
    k.beam(x, BAR_PIVOT.y, BAR_PIVOT.z, x, seat - 0.02, 0.38, 0.07, FRAME);
    k.beam(x, seat - 0.04, 0.38, x, seat - 0.04, -0.3, 0.07, FRAME);
    k.beam(x, seat + 0.3, 0.36, x, seat + 0.3, -0.2, 0.05, PALETTE.metal);
    k.beam(x, seat + 0.3, -0.2, x, seat - 0.02, -0.3, 0.05, PALETTE.metal);
  }
  // Seat pan and a pad for each rider; the back's rail and pads.
  k.box(0, seat - 0.07, 0.04, 2 * half, 0.05, 0.66, FRAME);
  k.box(0, seat + 0.52, 0.41, 2 * half, 0.05, 0.05, FRAME);
  LIFT.seats.forEach((x, i) => {
    const pad = i % 2 === 0 ? PAD : PAD_DARK;
    k.box(x, seat - 0.02, 0.02, 0.49, 0.06, 0.58, pad);
    k.box(x, seat + 0.36, 0.37, 0.49, 0.56, 0.06, pad);
  });
  return k.geometry();
}

/**
 * A chair's safety bar, about its pivot on the carrier bar (the local
 * origin), drawn down: an arm at each end to the bar across the riders'
 * laps, and two footrests hanging from it.
 */
function barGeometry(): BufferGeometry {
  const k = new MeshKit();
  const lap = { y: -0.62, z: -0.9 };
  for (const x of [-1.0, 1.0]) k.beam(x, 0, 0, x, lap.y, lap.z, 0.045, PALETTE.metal);
  k.beam(-1.0, lap.y, lap.z, 1.0, lap.y, lap.z, 0.05, PALETTE.metal);
  for (const x of [-0.52, 0.52]) {
    k.beam(x, lap.y, lap.z, x, -1.42, lap.z - 0.06, 0.04, PALETTE.metal);
    k.beam(x - 0.34, -1.42, lap.z - 0.06, x + 0.34, -1.42, lap.z - 0.06, 0.055, FRAME);
  }
  return k.geometry();
}

/** A rider sitting on a chair (local origin at the chair's grip, shifted across to a seat): jacket in the instance's color. */
function riderGeometry(): BufferGeometry {
  const k = new MeshKit();
  const seat = -LIFT.hang;
  const jacket = new Color('#ffffff');
  const pants = PALETTE.dark;
  k.box(0, seat + 0.4, 0.14, 0.42, 0.6, 0.28, jacket);
  // Helmet and goggles.
  k.box(0, seat + 0.86, 0.1, 0.25, 0.26, 0.26, pants);
  k.box(0, seat + 0.86, -0.04, 0.2, 0.08, 0.04, new Color('#ffb21f'));
  // Arms forward onto the bar.
  k.box(-0.25, seat + 0.36, -0.12, 0.11, 0.11, 0.5, jacket);
  k.box(0.25, seat + 0.36, -0.12, 0.11, 0.11, 0.5, jacket);
  // Thighs along the seat, shins down to the footrest, skis under the boots.
  k.box(-0.11, seat + 0.1, -0.14, 0.16, 0.16, 0.6, pants);
  k.box(0.11, seat + 0.1, -0.14, 0.16, 0.16, 0.6, pants);
  k.box(-0.11, seat - 0.2, -0.43, 0.15, 0.56, 0.15, pants);
  k.box(0.11, seat - 0.2, -0.43, 0.15, 0.56, 0.15, pants);
  k.box(-0.11, seat - 0.5, -0.5, 0.09, 0.05, 1.6, new Color('#3f7fe0'));
  k.box(0.11, seat - 0.5, -0.5, 0.09, 0.05, 1.6, new Color('#3f7fe0'));
  return k.geometry();
}

/** A bullwheel lying flat: a rim on spokes round a hub, in two colors so its turning shows. */
function wheelGeometry(): BufferGeometry {
  const k = new MeshKit();
  const r = LIFT.arm;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    k.beam(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r, 0.24, i % 4 < 2 ? STRIPE : FRAME);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    k.beam(-Math.cos(a) * r, 0.04, -Math.sin(a) * r, Math.cos(a) * r, 0.04, Math.sin(a) * r, 0.13, PALETTE.metalDark);
  }
  k.prism(0, 0, -0.2, 0.5, 0.5, 0.36, 8, PALETTE.metalDark, true);
  return k.geometry();
}

// ---------------------------------------------------------------- towers, cable, stations
/** A sheave: a wheel standing in the line's plane at local (x, y, z), turning about the local X axis. */
function sheave(k: MeshKit, x: number, y: number, z: number, r: number, w: number, color: Color): void {
  const n = 6;
  const hub = k.p(x + w / 2, y, z);
  const back = k.p(x - w / 2, y, z);
  const outX = k.p(x + 1, y, z).sub(k.p(x, y, z));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const f0 = k.p(x + w / 2, y + Math.cos(a0) * r, z + Math.sin(a0) * r);
    const f1 = k.p(x + w / 2, y + Math.cos(a1) * r, z + Math.sin(a1) * r);
    const b0 = k.p(x - w / 2, y + Math.cos(a0) * r, z + Math.sin(a0) * r);
    const b1 = k.p(x - w / 2, y + Math.cos(a1) * r, z + Math.sin(a1) * r);
    k.tri(hub, f0, f1, color, outX);
    k.tri(back, b0, b1, color, outX.clone().negate());
    k.quad(f0, f1, b1, b0, color, new Vector3().addVectors(f0, f1).multiplyScalar(0.5).sub(k.p(x + w / 2, y, z)));
  }
}

/** A tower in a kit placed at its foot, the line running along local Z: `h` is the cable's height over the foot. */
function tower(k: MeshKit, h: number, number: number): void {
  const arm = LIFT.arm;
  // Footing, the safety pad round the mast's foot, the mast.
  k.box(0, 0.2, 0, 1.7, 1, 1.7, CONCRETE);
  k.prism(0, 0, 0.7, 2.5, 0.78, 0.78, 8, PALETTE.orange);
  k.prism(0, 0, 1.45, 1.75, 0.8, 0.8, 8, PALETTE.white);
  k.prism(0, 0, 0.7, h + 0.55, 0.44, 0.3, 8, GALVANIZED);
  // A ladder up one side, and the tower's number plate.
  k.box(0.5, (h + 2.4) / 2, 0, 0.05, h - 2.2, 0.36, PALETTE.metalDark);
  k.box(0, 3.6, 0.46, 0.62, 0.62, 0.05, PALETTE.white);
  k.box(0, 3.6, 0.49, 0.36 + 0.02 * (number % 5), 0.12, 0.02, FRAME);
  // The crossarm on its haunches.
  k.box(0, h + 0.62, 0, 2 * arm + 1.5, 0.36, 0.5, PALETTE.metalDark);
  for (const s of [-1, 1]) k.beam(s * 0.25, h - 0.7, 0, s * (arm - 0.5), h + 0.5, 0, 0.16, PALETTE.metalDark);
  // A catwalk along it with a handrail.
  k.box(0, h + 0.86, -0.52, 2 * arm + 1.5, 0.05, 0.5, FRAME);
  k.beam(-arm - 0.75, h + 1.8, -0.76, arm + 0.75, h + 1.8, -0.76, 0.05, PALETTE.metal);
  for (const x of [-arm - 0.75, 0, arm + 0.75]) k.beam(x, h + 0.86, -0.76, x, h + 1.8, -0.76, 0.05, PALETTE.metal);
  // A sheave train under each end: its hanger, the rocker beam, six wheels the cable runs over.
  for (const s of [-1, 1]) {
    const x = s * arm;
    k.box(x, h + 0.2, 0, 0.16, 0.56, 0.3, PALETTE.metalDark);
    k.box(x + s * 0.13, h - 0.2, 0, 0.08, 0.14, 3.1, STRIPE);
    for (let i = 0; i < 6; i++) sheave(k, x, h - 0.2, -1.25 + i * 0.5, 0.2, 0.1, FRAME);
  }
}

/**
 * A station in a kit placed at its bullwheel on the floor, local +Z running
 * toward the other station: `side` is the local X side riders use (the up
 * cable's), `load` whether they get on here (a green mat) or off (an orange one).
 */
function station(k: MeshKit, side: number, load: boolean): void {
  const cable = CONFIG.lift.stationCable;
  for (const z of LIFT.pillars) {
    k.box(0, 0.25, z, 1.5, 0.9, 1.5, CONCRETE);
    k.prism(0, z, 0.6, cable + 0.9, 0.52, 0.44, 8, GALVANIZED);
  }
  // The housing over the wheel and the cable, on the columns: a long body, a lower nose at each end, windows down both sides.
  const y0 = cable + 0.55;
  const top = y0 + 2.3;
  k.box(0, (y0 + top) / 2, 0.5, 6.9, top - y0, 13.4, HOUSING);
  k.box(0, y0 + 0.85, 8.1, 6.3, 1.7, 1.8, HOUSING_SHADE);
  k.box(0, y0 + 0.85, -7.1, 6.3, 1.7, 1.8, HOUSING_SHADE);
  k.box(0, top + 0.12, 0.5, 6.5, 0.24, 13, STRIPE);
  k.box(0, top + 0.3, 0.5, 6.3, 0.14, 12.8, PALETTE.snow);
  for (const s of [-1, 1]) {
    k.box(s * 3.46, y0 + 1.45, 0.5, 0.04, 0.8, 11.6, GLASS);
    k.box(s * 3.46, y0 + 0.5, 0.5, 0.04, 0.26, 13.2, STRIPE);
    for (let i = -2; i <= 2; i++) k.box(s * 3.47, y0 + 1.45, 0.5 + i * 2.3, 0.05, 0.84, 0.1, HOUSING);
  }
  // The wheel's shaft down from the housing.
  k.prism(0, 0, cable + 0.2, y0 + 0.1, 0.3, 0.3, 8, PALETTE.metalDark);
  // The mat riders stand on, and a marker board on a post beside it.
  const matX = side * (LIFT.arm + 0.5);
  k.box(matX, 0.04, 3.2, 2.9, 0.06, 2.2, load ? MAT : PALETTE.orange);
  k.box(matX, 0.05, 2.15, 2.9, 0.07, 0.14, PALETTE.white);
  const boardX = side * (LIFT.arm + 3.4);
  k.beam(boardX, 0, 0.6, boardX, 2.1, 0.6, 0.08, PALETTE.post);
  k.box(boardX, 1.85, 0.6, 0.7, 0.4, 0.06, load ? MAT : PALETTE.orange);
  k.box(boardX, 1.85, 0.64, 0.46, 0.08, 0.02, PALETTE.white);
  // The operator's booth on the other side: timber walls, a window band, a snowy roof.
  const bx = -side * 6.4;
  k.box(bx, 1.3, 1.5, 2.6, 2.6, 3.2, PALETTE.wood);
  k.box(bx, 1.75, 1.5, 2.66, 0.8, 2.6, GLASS);
  k.box(bx + side * 1.31, 1.75, 1.5, 0.04, 0.84, 0.1, PALETTE.woodDark);
  k.box(bx, 2.7, 1.5, 3, 0.2, 3.6, STRIPE);
  k.box(bx, 2.86, 1.5, 2.9, 0.14, 3.5, PALETTE.snow);
}

/** The lift's still parts: a mesh for each station, and one for every few towers with the cables past them. */
function staticMeshes(path: LiftPath, hf: Heightfield): Mesh[] {
  const meshes: Mesh[] = [];
  const finish = (k: MeshKit): void => {
    const mesh = k.mesh(material);
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
  };
  const up = Math.atan2(path.dirX, path.dirZ);
  // Stations: local +Z toward the other one. Seen that way, the up cable is on the left at the bottom and on the right at the top.
  const bottom = new MeshKit().at(path.bottom.x, Math.min(path.floorY[0], renderedHeightAt(hf, path.bottom.x, path.bottom.z)), path.bottom.z, up);
  station(bottom, -1, true);
  finish(bottom);
  const top = new MeshKit().at(path.top.x, Math.min(path.floorY[1], renderedHeightAt(hf, path.top.x, path.top.z)), path.top.z, up + Math.PI);
  station(top, 1, false);
  finish(top);
  // The cable, sampled every few meters along the loop (the wheels' arcs included).
  const STEP = 8;
  const a = new Vector3();
  const b = new Vector3();
  for (let from = 0; from < path.towers.length; from += TOWERS_PER_MESH) {
    const k = new MeshKit();
    const to = Math.min(path.towers.length, from + TOWERS_PER_MESH);
    for (let i = from; i < to; i++) {
      const p = path.towers[i]!;
      const foot = renderedHeightAt(hf, p.x, p.z);
      tower(k.at(p.x, foot - 0.3, p.z, up), path.towerY[i]! - foot + 0.3, i + 1);
    }
    k.at(0, 0, 0);
    // The stretch of the line this mesh covers: from just below its first tower to its last (the ends reach the stations).
    const span = Math.hypot(path.top.x - path.bottom.x, path.top.z - path.bottom.z) / (path.towers.length + 1);
    const lo = from === 0 ? -1 : (from + 0.5) * span;
    const hi = to === path.towers.length ? Infinity : (to + 0.5) * span;
    for (let s = 0; s < path.count; s += STEP) {
      const t = Math.min(path.count - 1, s + STEP) % path.count;
      const along = (path.x[s]! - path.bottom.x) * path.dirX + (path.z[s]! - path.bottom.z) * path.dirZ;
      if (along < lo || along >= hi) continue;
      a.set(path.x[s]!, path.y[s]!, path.z[s]!);
      b.set(path.x[t]!, path.y[t]!, path.z[t]!);
      k.beamWorld(a.clone(), b.clone(), 0.07, PALETTE.dark);
    }
    finish(k);
  }
  return meshes;
}
