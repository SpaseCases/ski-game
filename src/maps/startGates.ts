import { makeRamp, ProfileBuilder, SURFACE } from './shapes.ts';
import type { Feature, ObstacleDef, RampShape, StartFeature, StartStyle } from './types.ts';

// The four start gates. Each stands around the spot the rider starts from;
// this file lays out the parts that matter to the simulation (raised decks
// as ramps, walls and posts as obstacles, the race start's timing wand) and
// the dimensions the renderer builds the rest from.

/** Wooden start deck: back face, deck and snow ramp lengths (m), and the deck's width. */
export const DECK = { back: 0.35, behind: 2.5, ahead: 2, ramp: 3.5, width: 5, archHeight: 3.6 };
/** Scaffold drop-in tower: back wall, platform behind and ahead of the rider, in-run angle and rounding. */
export const TOWER = { back: 0.4, behind: 1.5, ahead: 1.5, width: 4, angle: 32, knuckle: 3, transition: 7 };
/** Race start house (open at the back): inside from its back to the door (m), width, height, and the wand's distance out the door. */
export const HOUSE = { behind: 2, ahead: 1, width: 2.6, height: 2.7, wand: 0.35, wandHeight: 0.45 };
/** Ridgetop start: the hut's size and where it stands (to the rider's left), and the line of flags. */
export const RIDGE = { hut: 2.6, hutSide: -6, hutBack: -1, flagSpan: 9, flagCount: 5, flagHeight: 3 };

/** A start gate's frame: where the rider stands, facing (dirX, dirZ), with right (rightX, rightZ). */
export interface StartFrame {
  style: StartStyle;
  x: number;
  z: number;
  /** Heading in radians. */
  heading: number;
  dirX: number;
  dirZ: number;
  rightX: number;
  rightZ: number;
  height: number;
}

export function startFrame(f: StartFeature): StartFrame {
  const h = (f.heading * Math.PI) / 180;
  return {
    style: f.style,
    x: f.x,
    z: f.z,
    heading: h,
    dirX: -Math.sin(h),
    dirZ: -Math.cos(h),
    rightX: Math.cos(h),
    rightZ: -Math.sin(h),
    height: f.height,
  };
}

/** World XZ of a point `along` ahead of the rider and `across` to their right. */
export function startPoint(s: StartFrame, along: number, across: number): { x: number; z: number } {
  return { x: s.x + s.dirX * along + s.rightX * across, z: s.z + s.dirZ * along + s.rightZ * across };
}

export function startFrames(features: readonly Feature[]): StartFrame[] {
  return features.filter((f): f is StartFeature => f.type === 'start').map(startFrame);
}

/** Raised decks and towers, as ramps the rider stands and rolls on. */
export function startShapes(starts: readonly StartFrame[]): RampShape[] {
  const shapes: RampShape[] = [];
  for (const s of starts) {
    if (s.style === 'deck') {
      const p = new ProfileBuilder()
        .ease(DECK.back, s.height, SURFACE.wood)
        .flat(DECK.behind + DECK.ahead, SURFACE.wood)
        .ease(DECK.ramp, 0);
      shapes.push(ramp(s, DECK.back + DECK.behind, DECK.width, p));
    } else if (s.style === 'tower') {
      const p = new ProfileBuilder()
        .ease(TOWER.back, s.height, SURFACE.wood)
        .flat(TOWER.behind + TOWER.ahead, SURFACE.wood)
        .landing(TOWER.angle, TOWER.knuckle, TOWER.transition);
      shapes.push(ramp(s, TOWER.back + TOWER.behind, TOWER.width, p));
    }
  }
  return shapes;
}

/** A ramp whose profile puts the rider `behind` meters in from its start. */
function ramp(s: StartFrame, behind: number, width: number, p: ProfileBuilder): RampShape {
  const o = startPoint(s, -behind, 0);
  return makeRamp(o.x, o.z, (s.heading * 180) / Math.PI, width, 0.25, p, false);
}

/** Walls, huts and posts a rider can run into. */
export function startObstacles(starts: readonly StartFrame[]): ObstacleDef[] {
  const out: ObstacleDef[] = [];
  const wall = (s: StartFrame, a0: number, v0: number, a1: number, v1: number, height: number, radius = 0.08): void => {
    const a = startPoint(s, a0, v0);
    const b = startPoint(s, a1, v1);
    out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, radius, height });
  };
  for (const s of starts) {
    if (s.style === 'race') {
      const w = HOUSE.width / 2;
      wall(s, -HOUSE.behind, -w, HOUSE.ahead, -w, HOUSE.height);
      wall(s, -HOUSE.behind, w, HOUSE.ahead, w, HOUSE.height);
    } else if (s.style === 'ridge') {
      const half = RIDGE.hut / 2;
      wall(s, RIDGE.hutBack, RIDGE.hutSide, RIDGE.hutBack, RIDGE.hutSide, 2.5, half);
      for (const side of [-1, 1]) {
        for (let i = 0; i < RIDGE.flagCount; i++) {
          const v = side * (3 + (RIDGE.flagSpan * i) / Math.max(1, RIDGE.flagCount - 1));
          wall(s, 0.5, v, 0.5, v, RIDGE.flagHeight, 0.05);
        }
      }
    } else if (s.style === 'deck') {
      for (const side of [-1, 1]) wall(s, DECK.ahead, side * (DECK.width / 2 + 0.4), DECK.ahead, side * (DECK.width / 2 + 0.4), DECK.archHeight, 0.15);
    }
  }
  return out;
}

/** The race start's timing wand: the middle of the line across its door, as a start frame for gate checks. */
export function raceWand(s: StartFrame): { x: number; z: number; heading: number; width: number } {
  const p = startPoint(s, HOUSE.ahead + HOUSE.wand, 0);
  return { x: p.x, z: p.z, heading: s.heading, width: HOUSE.width };
}
