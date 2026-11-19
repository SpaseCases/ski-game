import { Quaternion } from 'three';
import { CONFIG } from '../config.ts';
import { FIELD_COUNT, FLAG } from '../online/mpRules.ts';
import type { SkierPose } from '../render/skierView.ts';
import { FIELD as I, type Sample } from './wire.ts';

// One other rider's timeline (milestone 27). Their messages are ordered by
// their own sequence number and timed by when they arrive here: another
// device's clock is never read (Chromebook clocks drift). Each message
// carries two samples a tenth of a second apart; the rider is drawn
// `delay` behind the newest sample, between two samples, never past the
// newest (so nobody is guessed ahead through a wall: past the newest they
// hold still). The delay follows the jitter measured on their messages,
// held between CONFIG.mp.delayMin and delayMax. Nothing here allocates
// once made.

/** Samples kept per rider (16 is 1.6 s at 10 a second, past delayMax). */
const KEEP = 16;
const qa = new Quaternion();
const qb = new Quaternion();
/** The two samples blended, field by field, written once a rider a frame (no number is passed or returned across a call: V8 would box each). */
const mix = new Float64Array(FIELD_COUNT);
/** How far between the two samples the blend is (0..1), beside `mix`. */
let mixT = 0;
/** The clock every rider is drawn at this frame (s) and the frame's length (s): set once a frame (setClock), not passed per rider. */
let clockNow = 0;
let clockDt = 0;

/** Sets the time the riders are drawn at this frame. */
export function setClock(now: number, dt: number): void {
  clockNow = now;
  clockDt = dt;
}

export class RemoteTimeline {
  /** Samples (FIELD_COUNT numbers each) and the local time each is drawn at (s), oldest first in a ring. */
  private readonly samples = new Float64Array(KEEP * FIELD_COUNT);
  private readonly times = new Float64Array(KEEP);
  private head = 0;
  private count = 0;
  /** The last sequence number taken, and when the next message is expected to arrive (s, local). */
  private lastSeq = -1;
  private expected = 0;
  /** The arrival error, smoothed (s), and the delay drawn at (s). */
  jitter = 0;
  delay = CONFIG.mp.delayMin;
  /** The time being drawn (s, local): it runs with the clock and eases toward now − delay, never past the newest sample. */
  private play = 0;
  /** Frames drawn holding at the newest sample (nothing newer had come): a play-test's measure of a delay too short. */
  held = 0;
  /** Set when the drawn rider jumped (a respawn, or back from away): the view snaps instead of blending. */
  jumped = true;

  get empty(): boolean {
    return this.count === 0;
  }

  /** Takes a message's two samples, arrived at `now` (s, performance.now). False if it's older than one already taken. */
  take(seq: number, a: Sample, b: Sample, now: number): boolean {
    const M = CONFIG.mp;
    const span = M.samplesPerMessage / M.sampleRate;
    let steps = 1;
    if (this.lastSeq >= 0) {
      // Sequence numbers wrap at 65536.
      const d = ((seq - this.lastSeq + 32768) & 0xffff) - 32768;
      if (d <= 0) return false;
      steps = d;
    }
    this.lastSeq = seq;
    const due = this.expected + steps * span;
    if (this.count === 0 || now - due > M.resync) {
      // A first message, or one long after it was due (away, a stall): start the timeline over here.
      this.expected = now;
      this.count = 0;
      this.jitter = 0;
      this.play = now - span - M.delayMin;
      this.jumped = true;
    } else {
      const err = now - due;
      // Early pulls the estimate earlier at once; late pushes it only slowly (a sender's clock running a little slow mustn't drag the timeline away).
      this.expected = err < 0 ? now : due + Math.min(err, M.arrivalDrift * span);
      this.jitter += M.jitterFollow * (Math.abs(err) - this.jitter);
    }
    const gap = 1 / M.sampleRate;
    this.push(a, this.expected - gap);
    this.push(b, this.expected);
    return true;
  }

  private push(s: Sample, t: number): void {
    const slot = (this.head + this.count) % KEEP;
    if (this.count === KEEP) this.head = (this.head + 1) % KEEP;
    else this.count++;
    this.samples.set(s, slot * FIELD_COUNT);
    this.times[slot] = t;
  }

  /**
   * Fills `out` with the rider as drawn at the clock (setClock: now, after a
   * frame of dt). False while there's nothing yet.
   */
  pose(out: SkierPose): boolean {
    if (this.count === 0) return false;
    const now = clockNow;
    const dt = clockDt;
    const M = CONFIG.mp;
    const span = M.samplesPerMessage / M.sampleRate;
    this.delay = Math.min(M.delayMax, Math.max(M.delayMin, span + M.jitterMul * this.jitter));
    // Ease the drawn time toward now − delay at up to 10% faster or slower than the clock, so a change of delay never jumps.
    const target = now - this.delay;
    const warp = Math.max(-0.1, Math.min(0.1, (target - this.play) * 0.5));
    this.play += dt * (1 + warp);
    if (Math.abs(target - this.play) > 1) this.play = target;
    const newest = this.times[(this.head + this.count - 1) % KEEP]!;
    const oldest = this.times[this.head]!;
    if (this.play > newest) {
      this.play = newest;
      this.held++;
    }
    const t = Math.max(this.play, oldest);
    // The two samples either side of t (or the newest twice).
    let k = this.count - 1;
    while (k > 0 && this.times[(this.head + k - 1) % KEEP]! > t) k--;
    const i1 = (this.head + k) % KEEP;
    const i0 = (this.head + Math.max(0, k - 1)) % KEEP;
    const t0 = this.times[i0]!;
    const t1 = this.times[i1]!;
    const s = this.samples;
    const a = i0 * FIELD_COUNT;
    const b = i1 * FIELD_COUNT;
    let alpha = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
    // A jump of more than 15 m between two samples is a respawn: show it, don't slide there.
    if (alpha > 0 && Math.abs(s[b + I.px]! - s[a + I.px]!) + Math.abs(s[b + I.pz]! - s[a + I.pz]!) > 15) {
      alpha = 1;
      this.jumped = true;
    }
    for (let f = 0; f < FIELD_COUNT; f++) mix[f] = s[a + f]! + (s[b + f]! - s[a + f]!) * alpha;
    mixT = alpha;
    this.blend(out, a, b, alpha < 0.5);
    return true;
  }

  /** The newest sample's position (for distances before the first pose), into x, y, z of `out`. */
  newestPosition(out: { x: number; y: number; z: number }): void {
    const at = ((this.head + this.count - 1) % KEEP) * FIELD_COUNT;
    out.x = this.samples[at + I.px]!;
    out.y = this.samples[at + I.py]!;
    out.z = this.samples[at + I.pz]!;
  }

  /** Fills `out` from `mix` (the blend) and, for what doesn't blend, sample `a` (`early`: still nearer it) or `b`. */
  private blend(out: SkierPose, a: number, b: number, early: boolean): void {
    const s = this.samples;
    out.position.set(mix[I.px]!, mix[I.py]!, mix[I.pz]!);
    out.velocity.set(mix[I.vx]!, mix[I.vy]!, mix[I.vz]!);
    qa.set(s[a + I.qx]!, s[a + I.qy]!, s[a + I.qz]!, s[a + I.qw]!).normalize();
    qb.set(s[b + I.qx]!, s[b + I.qy]!, s[b + I.qz]!, s[b + I.qw]!).normalize();
    out.orient.slerpQuaternions(qa, qb, mixT);
    const flags = s[early ? a + I.flags : b + I.flags]!;
    const grounded = (flags & FLAG.grounded) !== 0;
    const bothGrounded = (s[a + I.flags]! & FLAG.grounded) !== 0 && grounded;
    // As interpolateSkier: the heading and normal blend only between two samples on the snow.
    const ya = s[a + I.yaw]!;
    const yb = s[b + I.yaw]!;
    let dy = yb - ya;
    dy -= 2 * Math.PI * Math.floor((dy + Math.PI) / (2 * Math.PI));
    out.yaw = bothGrounded ? ya + dy * mixT : yb;
    if (bothGrounded) out.normal.set(mix[I.nx]!, mix[I.ny]!, mix[I.nz]!).normalize();
    else out.normal.set(s[b + I.nx]!, s[b + I.ny]!, s[b + I.nz]!).normalize();
    out.lean = mix[I.lean]!;
    out.crouch = mix[I.crouch]!;
    out.brake = mix[I.brake]!;
    out.brakeSide = s[b + I.brakeSide]!;
    out.polePhase = s[b + I.polePhase]!;
    out.grounded = grounded;
    out.center.set(out.position.x + mix[I.cx]!, out.position.y + mix[I.cy]!, out.position.z + mix[I.cz]!);
    out.spinRate = mix[I.spinRate]!;
    out.grab = s[b + I.grab]!;
    out.butter = s[b + I.butter]! !== 0 ? s[b + I.butter]! : s[a + I.butter]!;
    out.butterAmount = mix[I.butterAmount]!;
    out.landTime = s[b + I.landTime]! >= s[a + I.landTime]! ? mix[I.landTime]! : s[b + I.landTime]!;
    out.landDepth = s[b + I.landDepth]!;
    const bail = s[b + I.bailTime]!;
    out.bailed = bail >= 0;
    out.bailTime = bail >= 0 && s[a + I.bailTime]! >= 0 ? mix[I.bailTime]! : Math.max(0, bail);
    out.onRail = (flags & FLAG.onRail) !== 0;
    out.rail3d = (flags & FLAG.rail3d) !== 0;
    out.sitting = (flags & FLAG.sitting) !== 0;
  }
}
