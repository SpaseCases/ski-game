// The scope's ring (milestone 25, the developer's powers): HTML and CSS
// only, no textures. Black outside a circle, a thin dark rim, crosshairs
// with a gap and stadia marks, and a small readout of the last shot's
// distance. Shown and hidden from the frame, so it is in the obfuscation's
// EXCLUDE list; it touches the DOM only when something changes. Its styles
// are inline: nobody else's page carries them.

const RING = 'min(88vmin, 92vw)';
/** What a shot hit, by sim/shot.ts's HIT kind (none, snow, hard, tree, rail). */
const KINDS = ['', 'snow', 'rock or wall', 'tree', 'rail'];

export class DevScope {
  private readonly el: HTMLElement;
  private readonly readout: HTMLElement;
  private shown = false;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'ride-only';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity 90ms linear;' +
      `background:radial-gradient(circle at 50% 50%, transparent 0, transparent calc(${RING} / 2 - 10px), rgba(0,0,0,0.55) calc(${RING} / 2 - 2px), #000 calc(${RING} / 2));`;
    const ring = document.createElement('div');
    ring.style.cssText =
      `position:absolute;left:50%;top:50%;width:${RING};height:${RING};transform:translate(-50%,-50%);border-radius:50%;` +
      'box-shadow:inset 0 0 0 2px rgba(10,12,14,0.9), inset 0 0 40px 6px rgba(0,0,0,0.35);';
    // Crosshairs: four thick outer bars and a thin line through the middle, with a gap at the center.
    const line = (css: string): void => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;background:rgba(8,10,12,0.92);${css}`;
      ring.appendChild(d);
    };
    line('left:0;top:50%;width:34%;height:4px;transform:translateY(-50%);');
    line('right:0;top:50%;width:34%;height:4px;transform:translateY(-50%);');
    line('top:0;left:50%;height:34%;width:4px;transform:translateX(-50%);');
    line('bottom:0;left:50%;height:34%;width:4px;transform:translateX(-50%);');
    line('left:16%;top:50%;width:31%;height:1px;');
    line('right:16%;top:50%;width:31%;height:1px;');
    line('top:16%;left:50%;height:31%;width:1px;');
    line('bottom:16%;left:50%;height:31%;width:1px;');
    // Stadia marks below the center, for holding over at range.
    for (const at of [56, 61, 66]) line(`top:${at}%;left:50%;width:${at === 61 ? 18 : 12}px;height:1px;transform:translateX(-50%);`);
    el.appendChild(ring);
    this.readout = document.createElement('div');
    this.readout.style.cssText =
      'position:absolute;left:50%;top:80%;transform:translateX(-50%);font:700 13px/1 system-ui,sans-serif;' +
      'color:#f2f5f8;background:rgba(8,10,12,0.62);padding:4px 8px 3px;border-radius:3px;letter-spacing:0.04em;white-space:nowrap;';
    this.readout.hidden = true;
    ring.appendChild(this.readout);
    parent.appendChild(el);
    this.el = el;
  }

  /** Shows the ring (looking through it) or hides it. */
  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.el.style.opacity = on ? '1' : '0';
  }

  /** The last shot's distance in meters and what it hit, or none (a miss: nothing within reach). */
  setDistance(meters: number | null, kind: number): void {
    this.readout.textContent = meters === null ? '—' : `${Math.round(meters)} m · ${KINDS[kind] ?? ''}`;
    this.readout.hidden = false;
  }
}
