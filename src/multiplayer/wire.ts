import type { SkierPose } from '../render/skierView.ts';
import { FIELD_COUNT, FLAG, HEADER_BYTES, KIND_STATE, SAMPLE_BYTES, SCALE, STATE_MAX, STATE_MIN, stateLength, WIDTH } from '../online/mpRules.ts';

// A rider's drawn pose as the binary state message (src/online/mpRules.ts):
// the field values are read from a SkierPose into a sample (plain numbers,
// unscaled), two samples go in a message, B as only the fields that changed
// from A once rounded. Encoding writes into one buffer made once and sends
// a view of it made once per length, so sending allocates nothing.
// Decoding reads into the caller's sample arrays.

/** A sample: FIELD_COUNT numbers in mpRules' FIELDS order. */
export type Sample = Float64Array;

export function createSample(): Sample {
  return new Float64Array(FIELD_COUNT);
}

const I = {
  px: 0, py: 1, pz: 2, vx: 3, vy: 4, vz: 5, qx: 6, qy: 7, qz: 8, qw: 9, yaw: 10, nx: 11, ny: 12, nz: 13, lean: 14, crouch: 15, brake: 16,
  brakeSide: 17, polePhase: 18, cx: 19, cy: 20, cz: 21, spinRate: 22, grab: 23, butter: 24, butterAmount: 25, landTime: 26, landDepth: 27,
  bailTime: 28, flags: 29,
} as const;
export const FIELD = I;

/** The longest a time field is sent as (s): past it, nothing on screen changes. */
const TIME_CAP = 300;

/** Reads the pose into a sample. */
export function sampleFromPose(out: Sample, p: SkierPose): void {
  out[I.px] = p.position.x;
  out[I.py] = p.position.y;
  out[I.pz] = p.position.z;
  out[I.vx] = p.velocity.x;
  out[I.vy] = p.velocity.y;
  out[I.vz] = p.velocity.z;
  out[I.qx] = p.orient.x;
  out[I.qy] = p.orient.y;
  out[I.qz] = p.orient.z;
  out[I.qw] = p.orient.w;
  out[I.yaw] = p.yaw - 2 * Math.PI * Math.floor((p.yaw + Math.PI) / (2 * Math.PI));
  out[I.nx] = p.normal.x;
  out[I.ny] = p.normal.y;
  out[I.nz] = p.normal.z;
  out[I.lean] = p.lean;
  out[I.crouch] = p.crouch;
  out[I.brake] = p.brake;
  out[I.brakeSide] = p.brakeSide;
  out[I.polePhase] = Number.isFinite(p.polePhase) ? Math.min(p.polePhase, 30) : 30;
  out[I.cx] = p.center.x - p.position.x;
  out[I.cy] = p.center.y - p.position.y;
  out[I.cz] = p.center.z - p.position.z;
  out[I.spinRate] = p.spinRate;
  out[I.grab] = p.grab;
  out[I.butter] = p.butter;
  out[I.butterAmount] = p.butterAmount;
  out[I.landTime] = Math.min(p.landTime, TIME_CAP);
  out[I.landDepth] = p.landDepth;
  out[I.bailTime] = p.bailed ? Math.min(p.bailTime, TIME_CAP) : -1;
  out[I.flags] = (p.grounded ? FLAG.grounded : 0) | (p.onRail ? FLAG.onRail : 0) | (p.rail3d ? FLAG.rail3d : 0) | (p.sitting ? FLAG.sitting : 0);
}

const buffer = new ArrayBuffer(STATE_MAX);
const view = new DataView(buffer);
/** A view of the buffer for each message length, made once. */
const views: Uint8Array<ArrayBuffer>[] = [];
for (let n = 0; n <= STATE_MAX; n++) views.push(new Uint8Array(buffer, 0, n));
/** Scratch: A's rounded values, to find what changed in B. */
const roundedA = new Int32Array(FIELD_COUNT);

function rounded(v: number, i: number): number {
  const q = Math.round(v * SCALE[i]!);
  if (WIDTH[i] === 4) return Math.max(-2147483648, Math.min(2147483647, q));
  return Math.max(-32768, Math.min(32767, q));
}

function put(at: number, i: number, q: number): number {
  if (WIDTH[i] === 4) view.setInt32(at, q, true);
  else view.setInt16(at, q, true);
  return at + WIDTH[i]!;
}

/** Writes a state message (A whole, B as changes) and returns it, a view valid until the next call. */
export function encodeState(seq: number, a: Sample, b: Sample): Uint8Array<ArrayBuffer> {
  view.setUint8(0, KIND_STATE);
  view.setUint8(1, 0);
  view.setUint16(2, seq & 0xffff, true);
  let at = HEADER_BYTES;
  for (let i = 0; i < FIELD_COUNT; i++) {
    const q = rounded(a[i]!, i);
    roundedA[i] = q;
    at = put(at, i, q);
  }
  const maskAt = at;
  at += 4;
  let mask = 0;
  for (let i = 0; i < FIELD_COUNT; i++) {
    const q = rounded(b[i]!, i);
    if (q === roundedA[i]) continue;
    mask |= 1 << i;
    at = put(at, i, q);
  }
  view.setUint32(maskAt, mask >>> 0, true);
  return views[at]!;
}

/**
 * Reads a relayed state message into `a` and `b`. Returns the sender's id
 * (byte 1) and sequence number as id * 65536 + seq, or -1 if it isn't one.
 */
export function decodeState(data: ArrayBuffer, a: Sample, b: Sample): number {
  if (data.byteLength < STATE_MIN || data.byteLength > STATE_MAX) return -1;
  const dv = new DataView(data);
  if (dv.getUint8(0) !== KIND_STATE) return -1;
  const mask = dv.getUint32(HEADER_BYTES + SAMPLE_BYTES, true);
  if (stateLength(mask) !== data.byteLength) return -1;
  // Read straight into the samples (a helper returning each number would box it: V8 allocates a decimal passed out of a call).
  let at = HEADER_BYTES;
  for (let i = 0; i < FIELD_COUNT; i++) {
    a[i] = (WIDTH[i] === 4 ? dv.getInt32(at, true) : dv.getInt16(at, true)) / SCALE[i]!;
    at += WIDTH[i]!;
  }
  at += 4;
  for (let i = 0; i < FIELD_COUNT; i++) {
    if (mask & (1 << i)) {
      b[i] = (WIDTH[i] === 4 ? dv.getInt32(at, true) : dv.getInt16(at, true)) / SCALE[i]!;
      at += WIDTH[i]!;
    } else b[i] = a[i]!;
  }
  return dv.getUint8(1) * 65536 + dv.getUint16(2, true);
}
