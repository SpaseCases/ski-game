import type {
  Feature,
  HalfpipeFeature,
  JumpFeature,
  KickerFeature,
  LandingFeature,
  PipeShape,
  RampShape,
  TerrainShape,
} from './types.ts';

// Shapes built on top of the slope: jumps, kickers, landings, halfpipes and
// the raised start decks. They're exact functions added over the heightfield
// rather than baked into its 2 m grid, which would round a lip into a hump.
// Where two overlap, the higher one wins.
//
// A ramp's profile along its length is a list of knots joined by cubic
// Hermite curves. Each knot has a height and a slope on each side, so a lip
// is a crease (steep in, flat out) and everything else is smooth:
//   takeoff   0 -> lip         rises as a parabola to the lip angle
//   deck      lip -> knuckle   level with the lip (parallel to the slope)
//   knuckle                    rounds over (parabola) into the face
//   face                       straight at the landing angle
//   transition                 eases back into the slope (parabola)
// Across, the full height spans the ramp's width, then the sides ease down.

const DEG = Math.PI / 180;
/** Flat top (m) of a gap jump's landing before its knuckle. */
const LANDING_TOP = 1.5;

/** Builds a ramp profile knot by knot. */
export class ProfileBuilder {
  readonly u: number[] = [0];
  readonly h: number[] = [0];
  readonly mIn: number[] = [0];
  readonly mOut: number[] = [0];
  readonly wood: boolean[] = [false];
  readonly lips: number[] = [];

  /** Distance along and height of the last knot. */
  get end(): number {
    return this.u[this.u.length - 1] ?? 0;
  }

  get height(): number {
    return this.h[this.h.length - 1] ?? 0;
  }

  /** A knot `length` past the last one: the curve arrives with slope `mIn` and leaves with `mOut`. */
  to(length: number, h: number, mIn: number, mOut = mIn, wood = false): this {
    if (!(length > 0)) throw new Error(`Map: a ramp piece has length ${length}; make the feature longer`);
    this.u.push(this.end + length);
    this.h.push(h);
    this.mIn.push(mIn);
    this.mOut.push(mOut);
    this.wood.push(wood);
    return this;
  }

  /** Curved takeoff from the slope up to a sharp lip at `angle` degrees. */
  takeoff(height: number, angle: number): this {
    const m = Math.tan(angle * DEG);
    // A parabola reaching height H over length L ends with slope 2H / L.
    this.to((2 * height) / m, height, m, 0);
    this.lips.push(this.end);
    return this;
  }

  /** Level at the current height. */
  flat(length: number, wood = false): this {
    return length > 0 ? this.to(length, this.height, 0, 0, wood) : this;
  }

  /** Rounded change of height (zero slope at both ends). */
  ease(length: number, height: number, wood = false): this {
    return this.to(length, height, 0, 0, wood);
  }

  /** Rounded knuckle, straight face at `angle` degrees, rounded transition back to the slope. */
  landing(angle: number, knuckle: number, transition: number): this {
    const H = this.height;
    const s = Math.tan(angle * DEG);
    let k = knuckle;
    let t = transition;
    let face = H / s - (k + t) / 2;
    if (face < 0) {
      // Too low for the full rounding at this angle: shrink both to fit.
      const f = (2 * H) / (s * (k + t));
      k *= f;
      t *= f;
      face = 0;
    }
    this.to(k, H - (s * k) / 2, -s);
    if (face > 0) this.to(face, (s * t) / 2, -s);
    return this.to(t, 0, 0);
  }
}

/** Makes a ramp at (x, z) heading `yaw` degrees from a finished profile. */
export function makeRamp(
  x: number,
  z: number,
  yaw: number,
  width: number,
  sideWidth: number,
  p: ProfileBuilder,
  sides = true,
): RampShape {
  const a = yaw * DEG;
  const r: RampShape = {
    kind: 'ramp',
    x,
    z,
    dirX: -Math.sin(a),
    dirZ: -Math.cos(a),
    rightX: Math.cos(a),
    rightZ: -Math.sin(a),
    halfWidth: width / 2,
    sideWidth,
    ku: Float32Array.from(p.u),
    kh: Float32Array.from(p.h),
    kIn: Float32Array.from(p.mIn),
    kOut: Float32Array.from(p.mOut),
    wood: Uint8Array.from(p.wood, (w) => (w ? 1 : 0)),
    lips: p.lips.slice(),
    sides,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  setBox(r, r.ku[0] ?? 0, p.end, width / 2 + sideWidth);
  return r;
}

/** Bounding box of a shape covering u in [u0, u1] and v in [-half, half]. */
function setBox(s: TerrainShape, u0: number, u1: number, half: number): void {
  s.minX = Infinity;
  s.maxX = -Infinity;
  s.minZ = Infinity;
  s.maxZ = -Infinity;
  for (const u of [u0, u1]) {
    for (const v of [-half, half]) {
      const x = s.x + s.dirX * u + s.rightX * v;
      const z = s.z + s.dirZ * u + s.rightZ * v;
      s.minX = Math.min(s.minX, x);
      s.maxX = Math.max(s.maxX, x);
      s.minZ = Math.min(s.minZ, z);
      s.maxZ = Math.max(s.maxZ, z);
    }
  }
}

/** Builds the shapes for every jump, kicker, landing and halfpipe in a feature list. */
export function buildShapes(features: readonly Feature[]): TerrainShape[] {
  const shapes: TerrainShape[] = [];
  for (const f of features) {
    if (f.type === 'jump') shapes.push(jumpShape(f));
    else if (f.type === 'kicker') shapes.push(kickerShape(f));
    else if (f.type === 'landing') shapes.push(landingShape(f));
    else if (f.type === 'halfpipe') shapes.push(pipeShape(f));
  }
  return shapes;
}

function jumpShape(j: JumpFeature): RampShape {
  const p = new ProfileBuilder().takeoff(j.lipHeight, j.lipAngle);
  if (j.deck) {
    p.flat(j.gap);
  } else {
    // Open gap: the takeoff's back drops to the slope, then the landing's
    // back rises to its top, which stays flat for a moment before the knuckle.
    const room = j.gap - LANDING_TOP;
    let down = backLength(j.lipHeight);
    let up = backLength(j.landingHeight);
    if (room <= 0) throw new Error(`Map: a gap jump needs a gap longer than ${LANDING_TOP} m`);
    if (down + up > room) {
      const f = room / (down + up);
      down *= f;
      up *= f;
    }
    p.ease(down, 0).flat(room - down - up).ease(up, j.landingHeight).flat(LANDING_TOP);
  }
  p.landing(j.landingAngle, j.knuckle, j.transition);
  return makeRamp(j.x, j.z, j.yaw, j.width, j.sideWidth, p);
}

function kickerShape(k: KickerFeature): RampShape {
  const p = new ProfileBuilder().takeoff(k.lipHeight, k.lipAngle).ease(k.back, 0);
  return makeRamp(k.x, k.z, k.yaw, k.width, k.sideWidth, p);
}

function landingShape(l: LandingFeature): RampShape {
  const p = new ProfileBuilder().ease(l.back, l.height).flat(l.top).landing(l.angle, l.knuckle, l.transition);
  return makeRamp(l.x, l.z, l.yaw, l.width, l.sideWidth, p);
}

/** How long the back of a takeoff or landing of this height is. */
function backLength(height: number): number {
  return Math.max(1, 1.2 * height);
}

function pipeShape(f: HalfpipeFeature): PipeShape {
  const a = f.yaw * DEG;
  const wall = Math.min(f.wallAngle, 86) * DEG;
  const s: PipeShape = {
    kind: 'pipe',
    x: f.x,
    z: f.z,
    dirX: -Math.sin(a),
    dirZ: -Math.cos(a),
    rightX: Math.cos(a),
    rightZ: -Math.sin(a),
    heading: a,
    floorHalf: f.floorWidth / 2,
    radius: f.radius,
    transition: f.radius * Math.sin(wall),
    height: f.radius * (1 - Math.cos(wall)),
    deckWidth: f.deckWidth,
    outerWidth: f.outerWidth,
    length: f.length,
    dropIn: f.dropIn,
    entry: f.entry,
    back: f.back,
    exit: f.exit,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  if (f.dropIn + f.entry + f.exit >= f.length) throw new Error('Map: a halfpipe is too short for its drop-in and exit');
  setBox(s, -f.back, f.length, pipeHalfWidth(s));
  return s;
}

/** Half the full width of a pipe, out to the bottom of its outer banks. */
export function pipeHalfWidth(s: PipeShape): number {
  return s.floorHalf + s.transition + s.deckWidth + s.outerWidth;
}

/** Height a shape adds at a point, and its gradient in world X and Z. */
export interface ShapeSample {
  height: number;
  dhdx: number;
  dhdz: number;
}

/** Samples one shape at world (x, z). Returns false (and leaves `out` alone) outside it. */
export function sampleShape(s: TerrainShape, x: number, z: number, out: ShapeSample): boolean {
  if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
  return s.kind === 'ramp' ? sampleRamp(s, x, z, out) : samplePipe(s, x, z, out);
}

function sampleRamp(r: RampShape, x: number, z: number, out: ShapeSample): boolean {
  const dx = x - r.x;
  const dz = z - r.z;
  const u = dx * r.dirX + dz * r.dirZ;
  const v = dx * r.rightX + dz * r.rightZ;
  const edge = r.halfWidth + r.sideWidth;
  const last = r.ku.length - 1;
  if (u <= (r.ku[0] ?? 0) || u >= (r.ku[last] ?? 0) || v <= -edge || v >= edge) return false;

  // Along: height p and slope dp/du on the Hermite segment holding u.
  let k = 0;
  while (k < last - 1 && u > (r.ku[k + 1] ?? 0)) k++;
  const u0 = r.ku[k] ?? 0;
  const len = (r.ku[k + 1] ?? 0) - u0;
  const t = (u - u0) / len;
  const h0 = r.kh[k] ?? 0;
  const h1 = r.kh[k + 1] ?? 0;
  const m0 = (r.kOut[k] ?? 0) * len;
  const m1 = (r.kIn[k + 1] ?? 0) * len;
  const t2 = t * t;
  const t3 = t2 * t;
  const p = (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1;
  const dp = ((6 * t2 - 6 * t) * h0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * h1 + (3 * t2 - 2 * t) * m1) / len;

  // Across: full height in the middle, easing to nothing at the sides.
  const av = Math.abs(v);
  let w = 1;
  let dw = 0;
  if (av > r.halfWidth) {
    const s = (av - r.halfWidth) / r.sideWidth;
    w = 1 - s * s * (3 - 2 * s);
    dw = ((-6 * s * (1 - s)) / r.sideWidth) * Math.sign(v);
  }

  const dhdu = dp * w;
  const dhdv = p * dw;
  out.height = p * w;
  out.dhdx = dhdu * r.dirX + dhdv * r.rightX;
  out.dhdz = dhdu * r.dirZ + dhdv * r.rightZ;
  return true;
}

// Scratch for the pipe's across profile.
let across = 0;
let acrossSlope = 0;

/** The pipe's height across it at distance `a` from the middle (into `across`, with its slope). */
function pipeAcross(s: PipeShape, a: number): void {
  if (a <= s.floorHalf) {
    across = 0;
    acrossSlope = 0;
  } else if (a <= s.floorHalf + s.transition) {
    // Quarter circle: steepens to the wall angle at the top.
    const x = a - s.floorHalf;
    const r = Math.sqrt(s.radius * s.radius - x * x);
    across = s.radius - r;
    acrossSlope = x / r;
  } else {
    // The deck, then the outer bank.
    across = s.height * bankMask(s, a);
    acrossSlope = s.height * maskSlope;
  }
}

let maskSlope = 0;

/** 1 out to the edge of the deck, easing to 0 down the outer bank (slope into maskSlope). */
function bankMask(s: PipeShape, a: number): number {
  const deck = s.floorHalf + s.transition + s.deckWidth;
  if (a <= deck) {
    maskSlope = 0;
    return 1;
  }
  const t = Math.min(1, (a - deck) / s.outerWidth);
  maskSlope = (-6 * t * (1 - t)) / s.outerWidth;
  return 1 - t * t * (3 - 2 * t);
}

function samplePipe(s: PipeShape, x: number, z: number, out: ShapeSample): boolean {
  const dx = x - s.x;
  const dz = z - s.z;
  const u = dx * s.dirX + dz * s.dirZ;
  const v = dx * s.rightX + dz * s.rightZ;
  const a = Math.abs(v);
  if (u <= -s.back || u >= s.length || a >= pipeHalfWidth(s)) return false;

  const H = s.height;
  const mask = bankMask(s, a);
  const dMask = maskSlope;
  let p: number;
  let dpdu: number;
  let dpda: number;
  if (u < 0) {
    // The approach up onto the drop-in deck.
    const t = (u + s.back) / s.back;
    const e = t * t * (3 - 2 * t);
    p = H * mask * e;
    dpdu = (H * mask * 6 * t * (1 - t)) / s.back;
    dpda = H * dMask * e;
  } else {
    // The floor is raised to deck height at the top end and drops in over
    // the entry; the walls stand wherever they're higher than that.
    let lift = H;
    let dLift = 0;
    if (u > s.dropIn) {
      const t = Math.min(1, (u - s.dropIn) / s.entry);
      lift = H * (1 - t * t * (3 - 2 * t));
      dLift = t < 1 ? (-H * 6 * t * (1 - t)) / s.entry : 0;
    }
    pipeAcross(s, a);
    if (lift * mask >= across) {
      p = lift * mask;
      dpdu = dLift * mask;
      dpda = lift * dMask;
    } else {
      p = across;
      dpdu = 0;
      dpda = acrossSlope;
    }
    // The walls fade out over the exit at the bottom end.
    const fadeStart = s.length - s.exit;
    if (u > fadeStart) {
      const t = (u - fadeStart) / s.exit;
      const f = 1 - t * t * (3 - 2 * t);
      const df = (-6 * t * (1 - t)) / s.exit;
      dpdu = dpdu * f + p * df;
      dpda *= f;
      p *= f;
    }
  }

  const dpdv = dpda * Math.sign(v);
  out.height = p;
  out.dhdx = dpdu * s.dirX + dpdv * s.rightX;
  out.dhdz = dpdu * s.dirZ + dpdv * s.rightZ;
  return true;
}

/** The halfpipe whose inside (floor, walls and decks) holds (x, z), or undefined. */
export function pipeAt(shapes: readonly TerrainShape[] | undefined, x: number, z: number): PipeShape | undefined {
  if (!shapes) return undefined;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i]!;
    if (s.kind !== 'pipe') continue;
    const dx = x - s.x;
    const dz = z - s.z;
    const u = dx * s.dirX + dz * s.dirZ;
    const v = dx * s.rightX + dz * s.rightZ;
    if (u >= 0 && u <= s.length && Math.abs(v) <= s.floorHalf + s.transition + s.deckWidth) return s;
  }
  return undefined;
}
