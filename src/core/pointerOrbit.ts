/**
 * Click-and-drag on the game view to swing the camera around the skier.
 * There is no pointer lock: the cursor stays free for menus, and a plain
 * click without a drag changes nothing. Pointer events cover mouse, touch
 * and pen the same way.
 */
export class PointerOrbit {
  private dx = 0;
  private dy = 0;
  private pointer: number | null = null;
  private lastX = 0;
  private lastY = 0;

  attach(el: HTMLElement): void {
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.pointer !== null) return;
      this.pointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointer) return;
      this.dx += e.clientX - this.lastX;
      this.dy += e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      el.style.cursor = 'grab';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** True while a drag is in progress. */
  get dragging(): boolean {
    return this.pointer !== null;
  }

  /** Writes the pixels dragged since the last call into `out` and resets them. */
  take(out: { x: number; y: number }): void {
    out.x = this.dx;
    out.y = this.dy;
    this.dx = 0;
    this.dy = 0;
  }
}
