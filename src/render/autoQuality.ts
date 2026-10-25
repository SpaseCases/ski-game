import { CONFIG } from '../config.ts';
import { sameLevel } from '../core/settings.ts';

/**
 * Auto quality: watches real frame times while riding and steps down a
 * rung of CONFIG.quality.auto.rungs when they stay over budget. Frames are
 * judged a window at a time (`window` s of riding): if at least `missShare`
 * of them took longer than `budgetMs`, it steps down one rung. Nothing is
 * judged while the game waits (menus, the trail map, loading), and for
 * `settle` s after a step, a map load, a respawn or any wait, so a jump's
 * one long frame never counts. It never steps up mid-visit, and never
 * below the last rung (Low). Rungs that draw the same as the one above on
 * this screen (a lower pixel ratio at ratio 1) are skipped.
 */
export class AutoQuality {
  /** The rung in use (0 = the best). */
  rung: number;
  private elapsed = 0;
  private frames = 0;
  private misses = 0;
  private settling: number;

  constructor(rung: number) {
    this.rung = this.skipSame(rung);
    this.settling = CONFIG.quality.auto.settle;
  }

  /** Something just changed what a frame costs (a map, a respawn, a menu): don't judge for a while. */
  hold(): void {
    this.settling = CONFIG.quality.auto.settle;
    this.elapsed = 0;
    this.frames = 0;
    this.misses = 0;
  }

  /**
   * One drawn frame, `frameTime` real seconds after the one before.
   * `riding`: the game is running (not waiting). Returns 'down' when this
   * frame ended a window and stepped down a rung (the caller applies it),
   * 'kept' when it ended a window and the rung holds, else null.
   */
  frame(frameTime: number, riding: boolean): 'down' | 'kept' | null {
    const a = CONFIG.quality.auto;
    // A frame as long as the loop's cap is a stall (a hidden tab, a load), not the frame rate.
    if (!riding || frameTime >= CONFIG.sim.maxFrameTime) {
      if (!riding) this.hold();
      return null;
    }
    if (this.settling > 0) {
      this.settling -= frameTime;
      return null;
    }
    this.elapsed += frameTime;
    this.frames++;
    if (frameTime * 1000 > a.budgetMs) this.misses++;
    if (this.elapsed < a.window) return null;
    const over = this.misses >= this.frames * a.missShare;
    this.elapsed = 0;
    this.frames = 0;
    this.misses = 0;
    if (!over || this.rung >= a.rungs.length - 1) return 'kept';
    this.rung = this.skipSame(this.rung + 1);
    this.settling = a.settle;
    return 'down';
  }

  /** `rung`, or the first rung below it that draws something different from the one above it here. */
  private skipSame(rung: number): number {
    const rungs = CONFIG.quality.auto.rungs;
    let r = Math.min(rungs.length - 1, Math.max(0, rung));
    while (r > 0 && r < rungs.length - 1 && sameLevel(rungs[r]!, rungs[r - 1]!)) r++;
    return r;
  }
}
