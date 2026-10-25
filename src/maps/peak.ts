import { hash2, sectionPitch, smoothstep } from './terrain.ts';
import type { Heightfield, HeightPoint, PeakTerrainDef, TerrainElement, XZ } from './types.ts';

// A mountain built around a summit at x = z = 0, ridable down any side.
//
// Spokes run out from the summit: down the middle of each face and along
// each ridge between them. Each has its own fall line (pitch sections, like
// a slope's profile), giving its drop at every distance from the summit.
// Between two spokes the drop blends from one to the other across the angle
// between them, so a face sits lower than the ridges beside it and its
// flanks fall in toward its middle: valleys between spurs.
//
// Big folds go over the faces (more where it's steep), a gentle roll over
// everything, and past the play area the ground climbs into a rim of hills
// (which, with rim.ease, lets go again a little past the play area, so the
// land carries on into the foothills).
// Then the terrain elements, in order:
// ridges, gullies, cliff bands, wind lips, bowls, pillows, bumps, dips and
// flat pads. Each is an exact function of position, sampled onto the grid.

const DEG = Math.PI / 180;
/** Step (m) of each spoke's drop table out from the summit. */
const TABLE_STEP = 1;
/** Side (m) of the bins that sort elements by the ground they reach. */
const BIN = 64;
/** The roll and folds fade in over this distance (m) from the summit, so the start area stays as built. */
const ROLL_FADE = 80;
/** Ground this steep (drop per m) or steeper gets the folds at full height; flatter gets less. */
const RELIEF_GRADE = 0.45;
/** Steps per degree of the table of how far the bounds reach out from the summit. */
const REACH_STEPS = 4;
/**
 * How far (m) past the bounds the rim keeps climbing before an easing rim
 * (rim.ease) lets go: past everything a rider can touch (kept inside the
 * bounds, the sim samples a few meters round them) and the chase camera
 * behind them, so the riding is the same either way.
 */
const RIM_HOLD = 30;

export function generatePeak(def: PeakTerrainDef): Heightfield {
  const cols = Math.round(def.size / def.cellSize) + 1;
  const rows = cols;
  const half = ((cols - 1) * def.cellSize) / 2;
  const originX = -half;
  const originZ = -half;
  const sampler = new PeakSampler(def, originX, originZ, (cols - 1) * def.cellSize);
  const heights = new Float32Array(cols * rows);
  // The broad shape (spokes, folds, roll, the rim of hills) has nothing
  // finer than tens of meters, so it's worked out at every other sample and
  // filled in between; the elements on it are exact at every sample.
  broadShape(sampler, heights, cols, rows, originX, originZ, def.cellSize);
  // Samples a gully or wind lip shaped: their walls stay snow however steep.
  const snowy = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const z = originZ + row * def.cellSize;
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      heights[i] = sampler.addElements(originX + col * def.cellSize, z, heights[i]!);
      snowy[i] = sampler.snowy ? 1 : 0;
    }
  }

  // Rock where a sample sits on ground steeper than rockSlope (the steeper
  // way to each neighbor, so a narrow rock wall counts); the renderer colors
  // whole cells from their corners, so a wall reads as one face rather than
  // a stripe of single steep triangles. Facet jitter is rougher on rock:
  // steep ground gets craggy.
  const rock = new Uint8Array(cols * rows);
  const detail = new Float32Array(cols * rows);
  const rock0 = Math.tan((def.rockSlope - 4) * DEG);
  const rock1 = Math.tan((def.rockSlope + 4) * DEG);
  const h = (i: number): number => heights[i] ?? 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const here = h(i);
      const gx = Math.max(col < cols - 1 ? Math.abs(h(i + 1) - here) : 0, col > 0 ? Math.abs(here - h(i - 1)) : 0) / def.cellSize;
      const gz = Math.max(row < rows - 1 ? Math.abs(h(i + cols) - here) : 0, row > 0 ? Math.abs(here - h(i - cols)) : 0) / def.cellSize;
      const r = snowy[i] ? 0 : smoothstep(rock0, rock1, Math.sqrt(gx * gx + gz * gz));
      rock[i] = Math.round(r * 255);
      detail[i] = hash2(col, row, def.seed) * (def.noise + def.rockNoise * r);
    }
  }

  const polygon = new Float32Array(def.bounds.length * 2);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  def.bounds.forEach((p, i) => {
    polygon[i * 2] = p.x;
    polygon[i * 2 + 1] = p.z;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  });
  return {
    cols,
    rows,
    cellSize: def.cellSize,
    originX,
    originZ,
    heights,
    detail,
    bounds: { minX: Math.max(minX, -half), maxX: Math.min(maxX, half), minZ: Math.max(minZ, -half), maxZ: Math.min(maxZ, half), polygon },
    rock,
  };
}

/**
 * Fills `heights` with the sampler's broad shape: worked out at every other
 * sample (and a ring past the edge) and filled in between along Catmull-Rom
 * curves, which halfway between samples weigh the four nearest -1, 9, 9, -1
 * (sixteenths).
 */
function broadShape(sampler: PeakSampler, heights: Float32Array, cols: number, rows: number, originX: number, originZ: number, cell: number): void {
  // Coarse node k sits at fine index 2 (k - 1), from one coarse step before the first sample to one past the last.
  const kx = Math.ceil((cols - 1) / 2) + 3;
  const kz = Math.ceil((rows - 1) / 2) + 3;
  const coarse = new Float32Array(kx * kz);
  for (let m = 0; m < kz; m++) {
    const z = originZ + 2 * (m - 1) * cell;
    for (let k = 0; k < kx; k++) coarse[m * kx + k] = sampler.shape(originX + 2 * (k - 1) * cell, z);
  }
  // Along x first: every fine column for each coarse row.
  const across = new Float32Array(kz * cols);
  for (let m = 0; m < kz; m++) {
    const at = m * kx;
    for (let col = 0; col < cols; col++) {
      const k = (col >> 1) + 1;
      across[m * cols + col] =
        (col & 1) === 0
          ? coarse[at + k]!
          : (9 * (coarse[at + k]! + coarse[at + k + 1]!) - coarse[at + k - 1]! - coarse[at + k + 2]!) / 16;
    }
  }
  // Then along z.
  for (let row = 0; row < rows; row++) {
    const m = (row >> 1) + 1;
    for (let col = 0; col < cols; col++) {
      heights[row * cols + col] =
        (row & 1) === 0
          ? across[m * cols + col]!
          : (9 * (across[m * cols + col]! + across[(m + 1) * cols + col]!) - across[(m - 1) * cols + col]! - across[(m + 2) * cols + col]!) / 16;
    }
  }
}

/** An element ready to sample: the ground it reaches, and what it does to the height there. */
interface Compiled {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  apply(x: number, z: number, h: number): number;
  /** Ground it shapes is always drawn as snow (gully walls, wind lips). */
  snowy?: boolean;
}

/** Height of the mountain at any point: spokes, roll, then elements in order. */
class PeakSampler {
  private readonly def: PeakTerrainDef;
  /** Spokes sorted by heading: heading and bend (degrees, per m), sharpness, and drop tables. */
  private readonly heading: Float64Array;
  private readonly bend: Float64Array;
  private readonly sharp: Float64Array;
  private readonly sharpTo: Float64Array;
  private readonly drops: Float32Array[];
  /** Pitch (as a gradient) past each table's end, to carry on with. */
  private readonly tail: Float64Array;
  private readonly tableEnd: number;
  /** Per-sample scratch: each spoke's angle there. */
  private readonly angle: Float64Array;
  /** How far the bounds reach from the summit, by heading (REACH_STEPS per degree). */
  private readonly reach: Float64Array;
  private readonly roll: FbmField;
  private readonly folds: FbmField;
  private readonly elements: Compiled[] = [];
  private readonly binCols: number;
  private readonly binRows: number;
  private readonly binOrigin: number;
  private readonly bins: number[][];
  /** After height(): whether a snowy element (a gully, a wind lip) shaped that spot. */
  snowy = false;

  constructor(def: PeakTerrainDef, originX: number, originZ: number, extent: number) {
    this.def = def;
    const spokes = [...def.spokes].sort((a, b) => wrap360(a.heading) - wrap360(b.heading));
    const n = spokes.length;
    this.heading = new Float64Array(spokes.map((s) => wrap360(s.heading)));
    this.bend = new Float64Array(spokes.map((s) => s.bend / 1000));
    this.sharp = new Float64Array(spokes.map((s) => s.sharp));
    this.sharpTo = new Float64Array(spokes.map((s) => Math.max(1, s.sharpTo)));
    this.angle = new Float64Array(n);
    // Far enough for the corners of the map.
    this.tableEnd = Math.ceil((extent * Math.SQRT2) / 2 + def.cellSize * 2);
    const steps = Math.ceil(this.tableEnd / TABLE_STEP) + 1;
    this.tail = new Float64Array(n);
    this.drops = spokes.map((s, k) => {
      const table = new Float32Array(steps);
      const first = s.sections[0]?.pitch ?? 0;
      const grade = (r: number): number => Math.tan(sectionPitch(s.sections, 0, r, first) * DEG);
      let d = 0;
      for (let i = 1; i < steps; i++) {
        const r0 = (i - 1) * TABLE_STEP;
        // Midpoint rule in quarter steps.
        for (let q = 0; q < 4; q++) d += grade(r0 + (q + 0.5) * (TABLE_STEP / 4)) * (TABLE_STEP / 4);
        table[i] = d;
      }
      this.tail[k] = grade(this.tableEnd);
      return table;
    });

    this.reach = boundsReach(def.bounds);
    const lo = Math.min(originX, originZ);
    const hi = lo + extent;
    this.roll = new FbmField(def.seed, def.roll.wavelength, lo, hi);
    this.folds = new FbmField(def.seed + 3, def.relief.wavelength, lo, hi);

    // Elements, binned by the ground they reach so each sample visits only its own.
    this.binOrigin = Math.min(originX, originZ);
    this.binCols = Math.ceil(extent / BIN) + 1;
    this.binRows = this.binCols;
    this.bins = Array.from({ length: this.binCols * this.binRows }, () => []);
    def.elements.forEach((e, i) => {
      const c = this.compile(e, `terrain.elements[${i}]`);
      this.elements.push(c);
      const c0 = this.bin(c.minX);
      const c1 = this.bin(c.maxX);
      const r0 = this.bin(c.minZ);
      const r1 = this.bin(c.maxZ);
      for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) this.bins[r * this.binCols + col]!.push(i);
    });
  }

  private bin(v: number): number {
    return Math.min(this.binCols - 1, Math.max(0, Math.floor((v - this.binOrigin) / BIN)));
  }

  height(x: number, z: number): number {
    return this.addElements(x, z, this.base(x, z));
  }

  /** The broad shape at (x, z): spokes, folds, roll and the rim, before any element. */
  shape(x: number, z: number): number {
    return this.base(x, z);
  }

  /** The elements laid on height h at (x, z), in order. Sets `snowy`. */
  addElements(x: number, z: number, base: number): number {
    let h = base;
    this.snowy = false;
    const list = this.bins[this.bin(z) * this.binCols + this.bin(x)]!;
    for (let k = 0; k < list.length; k++) {
      const e = this.elements[list[k]!]!;
      if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
      const next = e.apply(x, z, h);
      if (e.snowy && next !== h) this.snowy = true;
      h = next;
    }
    return h;
  }

  /** Height from the spokes, folds and roll, before any element. Runs millions of times, so it keeps to cheap math. */
  private base(x: number, z: number): number {
    const def = this.def;
    const r = Math.sqrt(x * x + z * z);
    if (r < 1e-6) return def.summit;
    const roll = def.roll.amplitude * smoothstep(0, ROLL_FADE, r) * this.roll.at(x, z);
    // Heading of this point from the summit, in [0, 360).
    let theta = Math.atan2(-x, -z) / DEG;
    if (theta < 0) theta += 360;
    const n = this.heading.length;
    let drop: number;
    let grade: number;
    if (n === 1) {
      drop = this.drop(0, r);
      grade = this.grade(0, r);
    } else {
      // The spoke just clockwise of this point (a), the next one round (b), and how far round from a to b it is.
      let a = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const angle = this.heading[i]! + this.bend[i]! * r;
        this.angle[i] = angle;
        const d = around(theta - angle);
        if (d < best) {
          best = d;
          a = i;
        }
      }
      const b = a + 1 < n ? a + 1 : 0;
      const span = around(this.angle[b]! - this.angle[a]!) || 360;
      const t = Math.min(1, best / span);
      // Cubic Hermite across: zero slope at a spoke rounds it; a slope makes a sharp crest or a V.
      const ma = this.sharp[a]! * Math.max(0, 1 - r / this.sharpTo[a]!);
      const mb = this.sharp[b]! * Math.max(0, 1 - r / this.sharpTo[b]!);
      const t2 = t * t;
      const t3 = t2 * t;
      const s = 3 * t2 - 2 * t3 + ma * (t3 - 2 * t2 + t) + mb * (t3 - t2);
      const da = this.drop(a, r);
      const ga = this.grade(a, r);
      drop = da + (this.drop(b, r) - da) * s;
      grade = ga + (this.grade(b, r) - ga) * s;
    }
    const folds = def.relief.amplitude * Math.min(1, Math.max(0, grade) / RELIEF_GRADE) * this.folds.at(x, z);
    return def.summit - drop + smoothstep(0, ROLL_FADE, r) * folds + roll + this.rim(theta, r);
  }

  /** The rim of hills: how much the ground climbs past (and just inside) the edge of the play area, at heading theta. */
  private rim(theta: number, r: number): number {
    const { inset, ramp, rise, ease } = this.def.rim;
    const steps = this.reach.length;
    const f = theta * REACH_STEPS;
    const i = Math.floor(f);
    const a = this.reach[i < steps ? i : i - steps]!;
    const out = r - (a + (this.reach[i + 1 < steps ? i + 1 : i + 1 - steps]! - a) * (f - i)) + inset;
    if (out <= 0) return 0;
    // The grade builds from 0 to `rise` over `ramp`, then holds.
    const hold = inset + RIM_HOLD;
    if (ease === undefined || out <= hold) return out < ramp ? (rise * out * out) / (2 * ramp) : rise * (out - ramp / 2);
    // Past the play area, the climb eases back off and the ground goes on down its own lie.
    const top = hold < ramp ? (rise * hold * hold) / (2 * ramp) : rise * (hold - ramp / 2);
    return top * (1 - smoothstep(hold, hold + ease, out));
  }

  /** Gradient (drop per m) along spoke k at distance r. */
  private grade(k: number, r: number): number {
    const table = this.drops[k]!;
    if (r >= this.tableEnd - TABLE_STEP) return this.tail[k]!;
    const i = Math.floor(r / TABLE_STEP);
    return ((table[i + 1] ?? 0) - (table[i] ?? 0)) / TABLE_STEP;
  }

  /** Drop (m) from the summit along spoke k at distance r. */
  private drop(k: number, r: number): number {
    const table = this.drops[k]!;
    if (r >= this.tableEnd) return (table[table.length - 1] ?? 0) + (r - this.tableEnd) * this.tail[k]!;
    const f = r / TABLE_STEP;
    const i = Math.floor(f);
    const v0 = table[i] ?? 0;
    return v0 + ((table[i + 1] ?? v0) - v0) * (f - i);
  }

  /** Height at (x, z) from everything before element `upTo` (for pads that sit at the ground's height). */
  private heightBefore(x: number, z: number, upTo: number): number {
    let h = this.base(x, z);
    for (let k = 0; k < upTo; k++) {
      const e = this.elements[k]!;
      if (x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ) h = e.apply(x, z, h);
    }
    return h;
  }

  private compile(e: TerrainElement, path: string): Compiled {
    switch (e.type) {
      case 'ridge': {
        const line = new Polyline(e.points, path);
        const reach = e.crest + e.side;
        return {
          ...line.box(reach),
          apply: (x, z, h) => {
            line.nearest(x, z);
            if (line.dist >= reach) return h;
            const top = line.heightAt(e.points) * line.taper(e.taper);
            return h + top * (1 - smoothstep(e.crest, reach, line.dist));
          },
        };
      }
      case 'gully': {
        const line = new Polyline(e.points, path);
        const edge = e.floor / 2;
        const reach = edge + e.wall;
        return {
          ...line.box(reach),
          snowy: true,
          apply: (x, z, h) => {
            line.nearest(x, z);
            if (line.dist >= reach) return h;
            const q = Math.max(0, line.dist - edge) / e.wall;
            return h - e.depth * line.taper(e.taper) * (1 - q * q);
          },
        };
      }
      case 'cliffs': {
        const line = new Polyline(e.points, path);
        const dir = headingDir(e.heading);
        const half = e.face / 2;
        return {
          ...line.box(Math.max(e.bench, e.face)),
          apply: (x, z, h) => {
            line.nearest(x, z);
            const s = (x - line.qx) * dir.x + (z - line.qz) * dir.z;
            if (s >= half || -s >= e.bench) return h;
            const drop = line.heightAt(e.points) * line.taper(e.taper);
            return h + drop * (1 - smoothstep(-half, half, s)) * (1 - smoothstep(half, e.bench, -s));
          },
        };
      }
      case 'lip': {
        const line = new Polyline(e.points, path);
        const dir = headingDir(e.heading);
        return {
          ...line.box(Math.max(e.ramp, e.drop)),
          snowy: true,
          apply: (x, z, h) => {
            line.nearest(x, z);
            const s = (x - line.qx) * dir.x + (z - line.qz) * dir.z;
            if (s <= -e.ramp || s >= e.drop) return h;
            // Concave up the windward side to a sharp crest, then a steep drop.
            const up = s <= 0 ? (1 + s / e.ramp) ** 2 : 1 - smoothstep(0, e.drop, s);
            return h + e.height * line.taper(e.taper) * up;
          },
        };
      }
      case 'bowl': {
        // A U from above: a half-circle headwall at the back, straight side
        // walls, open at the front where the floor rises back to the slope.
        const f = frame(e.x, e.z, e.heading);
        const half = e.width / 2;
        return {
          ...f.box(0, e.length, half),
          apply: (x, z, h) => {
            const u = f.along(x, z);
            const v = f.across(x, z);
            if (u <= 0 || u >= e.length || Math.abs(v) >= half) return h;
            const back = u < half;
            const d = back ? Math.hypot(u - half, v) : Math.abs(v);
            if (d >= half) return h;
            // The wall is the headwall's width at the very back, the side walls' along the sides.
            const wall = back ? e.rim + (e.head - e.rim) * ((half - u) / half) : e.rim;
            const exit = 1 - smoothstep(e.length - e.exit, e.length, u);
            return h - e.depth * exit * (1 - smoothstep(half - wall, half, d));
          },
        };
      }
      case 'pillows': {
        const f = frame(e.x, e.z, e.heading);
        const nu = Math.max(1, Math.round(Math.sqrt((e.count * e.length) / Math.max(1, e.width))));
        const nv = Math.max(1, Math.round(e.count / nu));
        const pu: number[] = [];
        const pv: number[] = [];
        const pr: number[] = [];
        const ph: number[] = [];
        for (let i = 0; i < nu; i++) {
          for (let j = 0; j < nv; j++) {
            const rnd = (k: number): number => 0.5 + 0.5 * hash2(i * 7 + k, j * 13 + k * 5, e.seed);
            pu.push(-e.length / 2 + ((i + 0.2 + 0.6 * rnd(1)) * e.length) / nu);
            pv.push(-e.width / 2 + ((j + 0.2 + 0.6 * rnd(2)) * e.width) / nv);
            pr.push(e.size[0] + (e.size[1] - e.size[0]) * rnd(3));
            ph.push(e.height[0] + (e.height[1] - e.height[0]) * rnd(4));
          }
        }
        const reach = e.size[1];
        return {
          ...f.box(-e.length / 2 - reach, e.length / 2 + reach, e.width / 2 + reach),
          apply: (x, z, h) => {
            const u = f.along(x, z);
            const v = f.across(x, z);
            let top = 0;
            for (let k = 0; k < pu.length; k++) {
              const r = pr[k]!;
              const du = u - pu[k]!;
              const dv = v - pv[k]!;
              // Steeper on the downhill side.
              const ru = du > 0 ? r * 0.6 : r;
              const rho2 = (du / ru) ** 2 + (dv / r) ** 2;
              if (rho2 < 1) top = Math.max(top, ph[k]! * (1 - rho2) ** 1.5);
            }
            return h + top;
          },
        };
      }
      case 'bumps': {
        const noise = new FbmField(e.seed, e.wavelength, Math.min(e.x, e.z) - e.radius, Math.max(e.x, e.z) + e.radius);
        return {
          minX: e.x - e.radius,
          maxX: e.x + e.radius,
          minZ: e.z - e.radius,
          maxZ: e.z + e.radius,
          apply: (x, z, h) => {
            const d = Math.hypot(x - e.x, z - e.z);
            if (d >= e.radius) return h;
            const w = 1 - smoothstep(e.radius - e.fade, e.radius, d);
            return h + e.amplitude * w * noise.at(x, z);
          },
        };
      }
      case 'dip':
        return {
          minX: e.x - e.radius,
          maxX: e.x + e.radius,
          minZ: e.z - e.radius,
          maxZ: e.z + e.radius,
          apply: (x, z, h) => {
            const d = Math.hypot(x - e.x, z - e.z);
            if (d >= e.radius) return h;
            const k = 1 - d / e.radius;
            return h - e.depth * k * k;
          },
        };
      case 'flat': {
        const f = frame(e.x, e.z, e.heading);
        const h0 = this.heightBefore(e.x, e.z, this.elements.length);
        const grade = Math.tan(e.pitch * DEG);
        const reachU = (e.radius > 0 ? e.radius : e.length / 2) + e.blend;
        const reachV = (e.radius > 0 ? e.radius : e.width / 2) + e.blend;
        return {
          ...f.box(-reachU, reachU, Math.max(reachU, reachV)),
          apply: (x, z, h) => {
            const u = f.along(x, z);
            const v = f.across(x, z);
            const out =
              e.radius > 0 ? Math.max(0, Math.hypot(u, v) - e.radius) : Math.hypot(Math.max(0, Math.abs(u) - e.length / 2), Math.max(0, Math.abs(v) - e.width / 2));
            if (out >= e.blend) return h;
            const w = 1 - smoothstep(0, e.blend, out);
            return h + (h0 - grade * u - h) * w;
          },
        };
      }
    }
  }
}

/** How far (m) a polygon around the summit reaches out along each heading, REACH_STEPS per degree. */
function boundsReach(points: readonly XZ[]): Float64Array {
  const out = new Float64Array(360 * REACH_STEPS);
  for (let k = 0; k < out.length; k++) {
    const d = headingDir(k / REACH_STEPS);
    // The farthest crossing of the ray from the summit with the polygon's edges.
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const den = d.x * ez - d.z * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (a.x * ez - a.z * ex) / den;
      const u = (a.x * d.z - a.z * d.x) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    out[k] = best;
  }
  return out;
}

/** Unit direction (x, z) of a heading in degrees. */
function headingDir(heading: number): XZ {
  const h = heading * DEG;
  return { x: -Math.sin(h), z: -Math.cos(h) };
}

/** A frame at (x0, z0) facing `heading`: distances along and across (to the right) from there. */
function frame(x0: number, z0: number, heading: number) {
  const d = headingDir(heading);
  const rx = -d.z;
  const rz = d.x;
  return {
    along: (x: number, z: number): number => (x - x0) * d.x + (z - z0) * d.z,
    across: (x: number, z: number): number => (x - x0) * rx + (z - z0) * rz,
    /** World bounding box of the frame's rectangle from along u0..u1, ±half across. */
    box(u0: number, u1: number, half: number) {
      const xs: number[] = [];
      const zs: number[] = [];
      for (const u of [u0, u1]) {
        for (const v of [-half, half]) {
          xs.push(x0 + d.x * u + rx * v);
          zs.push(z0 + d.z * u + rz * v);
        }
      }
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    },
  };
}

/** A polyline with a nearest-point query that writes its answer into fields (no allocation per sample). */
class Polyline {
  private readonly xs: Float64Array;
  private readonly zs: Float64Array;
  /** Distance along the line to each point. */
  private readonly at: Float64Array;
  readonly total: number;
  /** Results of the last nearest(): the distance to the line, how far along it, the segment and the spot on it. */
  dist = 0;
  along = 0;
  seg = 0;
  t = 0;
  qx = 0;
  qz = 0;

  constructor(points: readonly XZ[], path: string) {
    if (points.length < 2) throw new Error(`Map: ${path} needs at least 2 points`);
    this.xs = new Float64Array(points.map((p) => p.x));
    this.zs = new Float64Array(points.map((p) => p.z));
    this.at = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++) {
      this.at[i] = this.at[i - 1]! + Math.hypot(this.xs[i]! - this.xs[i - 1]!, this.zs[i]! - this.zs[i - 1]!);
    }
    this.total = this.at[points.length - 1]!;
    if (!(this.total > 0)) throw new Error(`Map: ${path} has no length`);
  }

  box(reach: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.xs.length; i++) {
      minX = Math.min(minX, this.xs[i]!);
      maxX = Math.max(maxX, this.xs[i]!);
      minZ = Math.min(minZ, this.zs[i]!);
      maxZ = Math.max(maxZ, this.zs[i]!);
    }
    return { minX: minX - reach, maxX: maxX + reach, minZ: minZ - reach, maxZ: maxZ + reach };
  }

  nearest(x: number, z: number): void {
    let best = Infinity;
    for (let i = 0; i < this.xs.length - 1; i++) {
      const ax = this.xs[i]!;
      const az = this.zs[i]!;
      const sx = this.xs[i + 1]! - ax;
      const sz = this.zs[i + 1]! - az;
      const len2 = sx * sx + sz * sz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * sx + (z - az) * sz) / len2)) : 0;
      const qx = ax + sx * t;
      const qz = az + sz * t;
      const d2 = (x - qx) ** 2 + (z - qz) ** 2;
      if (d2 < best) {
        best = d2;
        this.seg = i;
        this.t = t;
        this.qx = qx;
        this.qz = qz;
      }
    }
    this.dist = Math.sqrt(best);
    this.along = this.at[this.seg]! + (this.at[this.seg + 1]! - this.at[this.seg]!) * this.t;
  }

  /** Height at the last nearest spot, between the points' heights. */
  heightAt(points: readonly HeightPoint[]): number {
    const a = points[this.seg]!.height;
    return a + (points[this.seg + 1]!.height - a) * this.t;
  }

  /** 0 at either end, rising to 1 `taper` meters in (at the last nearest spot). */
  taper(taper: number): number {
    if (taper <= 0) return 1;
    return smoothstep(0, taper, this.along) * smoothstep(0, taper, this.total - this.along);
  }
}

/** Smooth value noise in about [-1, 1] at lattice spacing 1. */
export function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Two octaves of value noise, in about [-1, 1]. */
export function fbm(x: number, z: number, seed: number): number {
  return (valueNoise(x, z, seed) + 0.5 * valueNoise(2 * x + 17.3, 2 * z - 9.1, seed + 1)) / 1.5;
}

/**
 * Value noise over a square of the world with every lattice corner worked
 * out once, for sampling it millions of times: the same values as
 * valueNoise, from a table. Outside the square it falls back to hashing.
 */
class Lattice {
  private readonly seed: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly n: number;
  private readonly table: Float32Array;

  /** Covers lattice coordinates from `min` to `max` on both axes. */
  constructor(seed: number, min: number, max: number) {
    this.seed = seed;
    this.x0 = Math.floor(min) - 1;
    this.z0 = this.x0;
    this.n = Math.ceil(max) + 2 - this.x0;
    this.table = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.table[j * this.n + i] = hash2(this.x0 + i, this.z0 + j, seed);
  }

  at(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const i = xi - this.x0;
    const j = zi - this.z0;
    if (i < 0 || j < 0 || i >= this.n - 1 || j >= this.n - 1) return valueNoise(x, z, this.seed);
    const fx = x - xi;
    const fz = z - zi;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const k = j * this.n + i;
    const t = this.table;
    const a = t[k]!;
    const b = t[k + 1]!;
    const c = t[k + this.n]!;
    const d = t[k + this.n + 1]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
}

/** fbm(x / wavelength, z / wavelength, seed) over a square of the world (min..max on both axes), from lattice tables. */
class FbmField {
  private readonly inv: number;
  private readonly first: Lattice;
  private readonly second: Lattice;

  constructor(seed: number, wavelength: number, min: number, max: number) {
    this.inv = 1 / wavelength;
    this.first = new Lattice(seed, min * this.inv, max * this.inv);
    // The second octave is offset differently on each axis, so cover both.
    this.second = new Lattice(seed + 1, 2 * min * this.inv - 9.1, 2 * max * this.inv + 17.3);
  }

  at(x: number, z: number): number {
    const u = x * this.inv;
    const v = z * this.inv;
    return (this.first.at(u, v) + 0.5 * this.second.at(2 * u + 17.3, 2 * v - 9.1)) / 1.5;
  }
}

function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** An angle difference (degrees, within a turn and a half either way) brought into [0, 360) without %. */
function around(a: number): number {
  if (a < 0) a += 360;
  if (a < 0) a += 360;
  if (a >= 360) a -= 360;
  return a;
}
