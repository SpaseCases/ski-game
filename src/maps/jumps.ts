import type { Feature, JumpFeature, JumpShape } from './types.ts';

// Jumps are exact shapes added on top of the heightfield rather than baked
// into its 2 m grid, which would round a lip off into a hump.
//
// Profile along the jump (u, meters from the start of the takeoff):
//   takeoff  0..lipAt          rises as a parabola to lipHeight, ending at lipAngle
//   deck     lipAt..deckEnd    level with the lip (parallel to the slope)
//   landing  deckEnd..end      eases back down to the slope (smoothstep, so the
//                              knuckle and the bottom transition are both rounded)
// Across the jump the full height spans `width`, then the sides ease down.

const DEG = Math.PI / 180;

export function buildJumpShapes(features: readonly Feature[]): JumpShape[] {
  return features.filter((f): f is JumpFeature => f.type === 'jump').map(jumpShape);
}

function jumpShape(j: JumpFeature): JumpShape {
  const yaw = j.yaw * DEG;
  // A parabola reaching height H over length L ends with slope 2H / L.
  const lipAt = (2 * j.lipHeight) / Math.tan(j.lipAngle * DEG);
  const deckEnd = lipAt + j.deckLength;
  return {
    x: j.x,
    z: j.z,
    dirX: -Math.sin(yaw),
    dirZ: -Math.cos(yaw),
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
    halfWidth: j.width / 2,
    sideWidth: j.sideWidth,
    lipHeight: j.lipHeight,
    lipAt,
    deckEnd,
    landingEnd: deckEnd + j.landingLength,
  };
}

/** Height a jump adds at a point, and its gradient in world X and Z. */
export interface JumpSample {
  height: number;
  dhdx: number;
  dhdz: number;
  /** Distance along the jump (for coloring the lip). */
  along: number;
}

/** Samples one jump at world (x, z). Returns false (and leaves `out` alone) outside it. */
export function sampleJump(j: JumpShape, x: number, z: number, out: JumpSample): boolean {
  const dx = x - j.x;
  const dz = z - j.z;
  const u = dx * j.dirX + dz * j.dirZ;
  const v = dx * j.rightX + dz * j.rightZ;
  const edge = j.halfWidth + j.sideWidth;
  if (u <= 0 || u >= j.landingEnd || v <= -edge || v >= edge) return false;

  // Along the jump: height p and slope dp/du.
  const H = j.lipHeight;
  let p: number;
  let dp: number;
  if (u < j.lipAt) {
    const t = u / j.lipAt;
    p = H * t * t;
    dp = (2 * H * t) / j.lipAt;
  } else if (u < j.deckEnd) {
    p = H;
    dp = 0;
  } else {
    const len = j.landingEnd - j.deckEnd;
    const t = (u - j.deckEnd) / len;
    p = H * (1 - t * t * (3 - 2 * t));
    dp = (-H * 6 * t * (1 - t)) / len;
  }

  // Across: full height in the middle, easing to nothing at the sides.
  const av = Math.abs(v);
  let w = 1;
  let dw = 0;
  if (av > j.halfWidth) {
    const t = (av - j.halfWidth) / j.sideWidth;
    w = 1 - t * t * (3 - 2 * t);
    dw = ((-6 * t * (1 - t)) / j.sideWidth) * Math.sign(v);
  }

  const dhdu = dp * w;
  const dhdv = p * dw;
  out.height = p * w;
  out.dhdx = dhdu * j.dirX + dhdv * j.rightX;
  out.dhdz = dhdu * j.dirZ + dhdv * j.rightZ;
  out.along = u;
  return true;
}
