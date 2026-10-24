import { Color, Group, MeshLambertMaterial, Vector3 } from 'three';
import { DECK, HOUSE, RIDGE, startPoint, TOWER, type StartFrame } from '../maps/startGates.ts';
import type { Heightfield } from '../maps/types.ts';
import type { RaceDef, RaceState } from '../sim/race.ts';
import { clothMaterial } from './cloth.ts';
import { pennantString } from './decor.ts';
import { MeshKit } from './meshKit.ts';
import { FLAG_COLORS, PALETTE } from './models.ts';
import { drawnHeightAt, renderedHeightAt } from './terrainMesh.ts';
import { litByPools } from './lightPools.ts';

// The four start gates, drawn around the spot each one starts the rider
// from. The decks and the tower's in-run are ramps (drawn with the other
// shapes); here go their side boards, scaffold, railings, arch, huts and
// flags. The race start's timing wand swings open when pushed through.

const SINK = 0.2;
const BANNER = new Color('#2f7de1');
const material = litByPools(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));

export class StartGateView {
  readonly group = new Group();
  /** Timing wands, one per race start in order: each swings about its hinge post. */
  private readonly wands: Group[] = [];

  constructor(starts: readonly StartFrame[], hf: Heightfield) {
    const kit = new MeshKit();
    const cloth = new MeshKit();
    for (const s of starts) {
      if (s.style === 'deck') drawDeck(kit, s, hf);
      else if (s.style === 'tower') drawTower(kit, s, hf, cloth);
      else if (s.style === 'ridge') drawRidge(kit, s, hf, cloth);
      else this.drawRace(kit, s, hf);
    }
    if (!kit.empty) this.group.add(kit.mesh(material));
    if (!cloth.empty) this.group.add(cloth.mesh(clothMaterial));
  }

  /** Swings each race start's wand by the time since its course's clock last started there. */
  update(def: RaceDef | undefined, race: RaceState | null): void {
    if (!def || !race) return;
    for (let c = 0; c < def.courses.length; c++) {
      const wand = this.wands[def.courses[c]!.house];
      if (wand) wand.rotation.y = wandAngle(race.wandTime[c] ?? Infinity);
    }
  }

  private drawRace(kit: MeshKit, s: StartFrame, hf: Heightfield): void {
    const w = HOUSE.width / 2;
    const corners = [
      startPoint(s, -HOUSE.behind, -w),
      startPoint(s, -HOUSE.behind, w),
      startPoint(s, HOUSE.ahead, -w),
      startPoint(s, HOUSE.ahead, w),
    ];
    const heights = corners.map((p) => drawnHeightAt(hf, p.x, p.z));
    const low = Math.min(...heights) - SINK;
    const top = Math.max(...heights) + HOUSE.height;
    const mid = (low + top) / 2;
    const tall = top - low;
    const depth = HOUSE.behind + HOUSE.ahead;
    const center = (HOUSE.ahead - HOUSE.behind) / 2;
    // Local frame: the rider at the origin facing -Z, so "ahead" is -z.
    // Open at the back, so the chase camera sees the rider inside.
    kit.at(s.x, 0, s.z, s.heading);
    for (const side of [-1, 1]) kit.box(side * w, mid, -center, 0.16, tall, depth, PALETTE.red);
    kit.box(0, top + 0.1, -center, HOUSE.width + 0.5, 0.2, depth + 0.4, PALETTE.white);
    kit.box(0, top - 0.25, -HOUSE.ahead, HOUSE.width, 0.5, 0.12, PALETTE.redDark);

    // Wand posts by the door, and the wand on a hinge at the left one.
    const wandAt = HOUSE.ahead + HOUSE.wand;
    const postX = w - 0.15;
    const ground = drawnHeightAt(hf, startPoint(s, wandAt, 0).x, startPoint(s, wandAt, 0).z);
    for (const side of [-1, 1]) kit.box(side * postX, ground + 0.3 - SINK / 2, -wandAt, 0.1, 0.6 + SINK, 0.1, PALETTE.dark);
    const hinge = startPoint(s, wandAt, -postX);
    const pivot = new Group();
    pivot.position.set(hinge.x, ground + HOUSE.wandHeight, hinge.z);
    const arm = new Group();
    arm.rotation.y = s.heading;
    const wandKit = new MeshKit();
    wandKit.beam(0, 0, 0, postX * 2, 0, 0, 0.05, PALETTE.white);
    wandKit.beam(postX * 0.6, 0, 0, postX * 1.2, 0, 0, 0.055, PALETTE.red);
    arm.add(wandKit.mesh(material));
    pivot.add(arm);
    this.group.add(pivot);
    this.wands.push(pivot);
  }
}

/** A wand's swing `t` seconds after it was pushed through (Infinity: never): kicked open quickly, then swinging slowly shut. */
function wandAngle(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const open = Math.min(1, t / 0.12);
  const shut = Math.min(1, Math.max(0, (t - 0.5) / 1.4));
  return 1.35 * open * (1 - shut * shut * (3 - 2 * shut));
}

/** Wooden start deck: boards down each side to the snow, and a banner arch over the front. */
function drawDeck(kit: MeshKit, s: StartFrame, hf: Heightfield): void {
  const half = DECK.width / 2;
  rampSides(kit, s, hf, -(DECK.back + DECK.behind), DECK.ahead + DECK.ramp, half, DECK.ahead, Infinity);
  const postV = half + 0.4;
  const posts = [startPoint(s, DECK.ahead, -postV), startPoint(s, DECK.ahead, postV)];
  const base = Math.max(...posts.map((p) => drawnHeightAt(hf, p.x, p.z)));
  const top = base + DECK.archHeight;
  kit.at(s.x, 0, s.z, s.heading);
  for (const side of [-1, 1]) {
    const p = posts[side < 0 ? 0 : 1]!;
    const y0 = drawnHeightAt(hf, p.x, p.z) - SINK;
    kit.box(side * postV, (y0 + top) / 2, -DECK.ahead, 0.24, top - y0, 0.24, PALETTE.post);
  }
  kit.box(0, top + 0.12, -DECK.ahead, postV * 2 + 0.4, 0.24, 0.3, PALETTE.post);
  const a = kit.p(-postV + 0.15, top - 0.95, -DECK.ahead);
  const b = kit.p(postV - 0.15, top - 0.95, -DECK.ahead);
  const c = kit.p(postV - 0.15, top - 0.05, -DECK.ahead);
  const d = kit.p(-postV + 0.15, top - 0.05, -DECK.ahead);
  kit.panel(a, b, c, d, BANNER);
  const stripe = (y0: number, y1: number): void => {
    kit.panel(
      kit.p(-postV + 0.15, y0, -DECK.ahead - 0.02),
      kit.p(postV - 0.15, y0, -DECK.ahead - 0.02),
      kit.p(postV - 0.15, y1, -DECK.ahead - 0.02),
      kit.p(-postV + 0.15, y1, -DECK.ahead - 0.02),
      PALETTE.white,
    );
  };
  stripe(top - 0.85, top - 0.75);
  stripe(top - 0.25, top - 0.15);
}

/**
 * Boards (or snow banks) down the sides of a raised start ramp, from its
 * surface to the snow under it, no deeper than `depth`: wood along the
 * deck (up to `woodTo` ahead of the rider), snow beyond.
 */
function rampSides(
  kit: MeshKit,
  s: StartFrame,
  hf: Heightfield,
  from: number,
  to: number,
  half: number,
  woodTo: number,
  depth: number,
): void {
  const step = 0.5;
  for (const side of [-1, 1]) {
    const out = new Vector3(s.rightX * side, 0, s.rightZ * side);
    for (let u = from; u < to - 1e-6; u += step) {
      const u1 = Math.min(to, u + step);
      const p0 = startPoint(s, u, side * half);
      const p1 = startPoint(s, u1, side * half);
      // Just inside the edge, where the surface is still at full height.
      const in0 = startPoint(s, u, side * (half - 0.02));
      const in1 = startPoint(s, u1, side * (half - 0.02));
      const top0 = drawnHeightAt(hf, in0.x, in0.z);
      const top1 = drawnHeightAt(hf, in1.x, in1.z);
      const g0 = renderedHeightAt(hf, p0.x, p0.z) - SINK;
      const g1 = renderedHeightAt(hf, p1.x, p1.z) - SINK;
      if (top0 - g0 < SINK + 0.03 && top1 - g1 < SINK + 0.03) continue;
      const b0 = Math.max(g0, top0 - depth);
      const b1 = Math.max(g1, top1 - depth);
      const color = u < woodTo ? (Math.floor(u / 0.6) % 2 === 0 ? PALETTE.wood : PALETTE.woodDark) : PALETTE.snow;
      kit.quad(
        new Vector3(p0.x, b0, p0.z),
        new Vector3(p1.x, b1, p1.z),
        new Vector3(p1.x, top1, p1.z),
        new Vector3(p0.x, top0, p0.z),
        color,
        out,
      );
    }
  }
}

/** Scaffold drop-in tower: side boards, a scaffold of poles and braces under the platform and in-run, a railing, flags. */
function drawTower(kit: MeshKit, s: StartFrame, hf: Heightfield, cloth: MeshKit): void {
  const half = TOWER.width / 2;
  const back = -(TOWER.back + TOWER.behind);
  const runEnd = TOWER.ahead + s.height / Math.tan((TOWER.angle * Math.PI) / 180) + TOWER.transition;
  rampSides(kit, s, hf, back, runEnd, half, TOWER.ahead, 0.45);

  // Scaffold: pairs of poles every 1.8 m wherever the deck is well off the snow.
  const surface = (u: number, v: number): number => {
    const p = startPoint(s, u, v);
    return drawnHeightAt(hf, p.x, p.z);
  };
  const ground = (u: number, v: number): number => {
    const p = startPoint(s, u, v);
    return renderedHeightAt(hf, p.x, p.z);
  };
  const poleV = half - 0.15;
  const rows: { u: number; top: [number, number]; bottom: [number, number] }[] = [];
  for (let u = back + TOWER.back + 0.1; u < runEnd; u += 1.8) {
    const tops: [number, number] = [surface(u, -poleV) - 0.45, surface(u, poleV) - 0.45];
    const bottoms: [number, number] = [ground(u, -poleV) - SINK, ground(u, poleV) - SINK];
    if (tops[0] - bottoms[0] < 0.8) break;
    rows.push({ u, top: tops, bottom: bottoms });
  }
  const point = (u: number, v: number, y: number): Vector3 => {
    const p = startPoint(s, u, v);
    return new Vector3(p.x, y, p.z);
  };
  rows.forEach((r, i) => {
    for (let k = 0; k < 2; k++) {
      const v = k === 0 ? -poleV : poleV;
      kit.beamWorld(point(r.u, v, r.bottom[k]!), point(r.u, v, r.top[k]!), 0.1, PALETTE.metal);
      const next = rows[i + 1];
      if (next) {
        // X-braces down each side.
        kit.beamWorld(point(r.u, v, r.bottom[k]! + 0.5), point(next.u, v, next.top[k]! - 0.2), 0.05, PALETTE.metalDark);
        kit.beamWorld(point(r.u, v, r.top[k]! - 0.2), point(next.u, v, Math.max(next.bottom[k]! + 0.5, next.top[k]! - 1.5)), 0.05, PALETTE.metalDark);
      }
    }
    // Ledgers across, low and high.
    for (const t of [0.3, 0.9]) {
      kit.beamWorld(
        point(r.u, -poleV, r.bottom[0]! + (r.top[0]! - r.bottom[0]!) * t),
        point(r.u, poleV, r.bottom[1]! + (r.top[1]! - r.bottom[1]!) * t),
        0.05,
        PALETTE.metalDark,
      );
    }
  });

  // Railing around the back and sides of the platform, with a flag at each front corner.
  const deckY = surface(0, 0);
  const railU = [back + TOWER.back, -TOWER.behind / 2, TOWER.ahead * 0.6];
  for (const side of [-1, 1]) {
    for (const u of railU) kit.beamWorld(point(u, side * half, deckY - 0.05), point(u, side * half, deckY + 1.05), 0.06, PALETTE.metal);
    kit.beamWorld(point(railU[0]!, side * half, deckY + 1.05), point(railU[2]!, side * half, deckY + 1.05), 0.06, PALETTE.metal);
    const flagAt = point(railU[2]!, side * half, deckY);
    kit.beamWorld(flagAt, point(railU[2]!, side * half, deckY + 2.6), 0.05, PALETTE.post);
    const flagColor = FLAG_COLORS[side < 0 ? 0 : 1]!;
    cloth.panel(
      point(railU[2]!, side * half, deckY + 1.9),
      point(railU[2]!, side * (half + 1), deckY + 1.95),
      point(railU[2]!, side * (half + 1), deckY + 2.55),
      point(railU[2]!, side * half, deckY + 2.6),
      flagColor,
      flagColor,
      [0, 1, 1, 0],
    );
  }
  kit.beamWorld(point(railU[0]!, -half, deckY + 1.05), point(railU[0]!, half, deckY + 1.05), 0.06, PALETTE.metal);
}

/** Ridgetop start: a small hut off to the side and a line of flags, with pennants strung over the start. */
function drawRidge(kit: MeshKit, s: StartFrame, hf: Heightfield, cloth: MeshKit): void {
  const hutAt = startPoint(s, RIDGE.hutBack, RIDGE.hutSide);
  const h = RIDGE.hut;
  const base = drawnHeightAt(hf, hutAt.x, hutAt.z);
  kit.at(hutAt.x, 0, hutAt.z, s.heading);
  const low = base - 0.6;
  const wallTop = base + 2.2;
  kit.box(0, (low + wallTop) / 2, 0, h, wallTop - low, h, PALETTE.wood);
  // Door facing the start, window facing down the hill.
  kit.box(h / 2 + 0.01, base + 0.95, 0, 0.04, 1.9, 0.9, PALETTE.woodDark);
  kit.box(0, base + 1.4, -h / 2 - 0.01, 0.8, 0.6, 0.04, PALETTE.dark);
  // Gable roof along the hut's depth.
  const ridge = wallTop + 1.1;
  const eave = h / 2 + 0.3;
  const front = h / 2 + 0.3;
  for (const side of [-1, 1]) {
    kit.panel(
      kit.p(side * eave, wallTop - 0.15, -front),
      kit.p(0, ridge, -front),
      kit.p(0, ridge, front),
      kit.p(side * eave, wallTop - 0.15, front),
      PALETTE.roof,
    );
  }
  for (const z of [-h / 2, h / 2]) {
    kit.panel(kit.p(-h / 2, wallTop, z), kit.p(h / 2, wallTop, z), kit.p(0, ridge - 0.05, z), kit.p(0, ridge - 0.05, z), PALETTE.woodDark);
  }

  // Two lines of flags reaching out from the start, and pennants over it.
  const poleAt = (v: number) => startPoint(s, 0.5, v);
  for (const side of [-1, 1]) {
    for (let i = 0; i < RIDGE.flagCount; i++) {
      const v = side * (3 + (RIDGE.flagSpan * i) / Math.max(1, RIDGE.flagCount - 1));
      const p = poleAt(v);
      const y = drawnHeightAt(hf, p.x, p.z);
      kit.at(p.x, y, p.z, s.heading);
      kit.prism(0, 0, -SINK, RIDGE.flagHeight, 0.04, 0.03, 5, PALETTE.post);
      const flagColor = FLAG_COLORS[(i + (side < 0 ? 0 : 3)) % FLAG_COLORS.length]!;
      cloth.panel(
        kit.p(0, RIDGE.flagHeight - 0.75, 0),
        kit.p(side * 1.1, RIDGE.flagHeight - 0.8, 0),
        kit.p(side * 1.1, RIDGE.flagHeight - 0.05, 0),
        kit.p(0, RIDGE.flagHeight, 0),
        flagColor,
        flagColor,
        [0, 1, 1, 0],
      );
    }
  }
  const a = poleAt(-3);
  const b = poleAt(3);
  pennantString(kit, a, drawnHeightAt(hf, a.x, a.z) + RIDGE.flagHeight - 0.05, b, drawnHeightAt(hf, b.x, b.z) + RIDGE.flagHeight - 0.05, 0.35, cloth);
}
