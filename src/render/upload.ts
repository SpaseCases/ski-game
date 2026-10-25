import type { BufferAttribute } from 'three';

/** One update range kept per attribute, so marking a partial upload every frame makes no garbage. */
const ranges = new WeakMap<BufferAttribute, { start: number; count: number }>();

/**
 * Marks the first `count` numbers of `attr` for upload (nothing when none
 * are used). Like clearUpdateRanges then addUpdateRange, but reusing one
 * range object instead of making a new one every time.
 */
export function uploadFirst(attr: BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  if (count <= 0) return;
  let range = ranges.get(attr);
  if (!range) {
    range = { start: 0, count: 0 };
    ranges.set(attr, range);
  }
  range.start = 0;
  range.count = count;
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}
