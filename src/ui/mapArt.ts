import type { MapId } from '../maps/registry.ts';

// Small flat illustrations for the map cards, in the game's own palette:
// a sky gradient, far hills, snow, and a hint of what each map is about.

const SNOW = '#f4f8fc';
const SHADE = '#c9d6e8';
const LIP = '#3f7fe0';
const METAL = '#8b96a3';
const POST = '#56606b';
const PINE = '#2f5b46';
const ROCK = '#5d6773';
const WOOD = '#a87443';

function sky(id: string, top: string, bottom: string): string {
  return (
    `<defs><linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<rect width="160" height="90" fill="url(#sky-${id})"/>`
  );
}

function pine(x: number, y: number, s: number): string {
  return `<path d="M${x} ${y - 14 * s} L${x + 5 * s} ${y} L${x - 5 * s} ${y} Z" fill="${PINE}"/>`;
}

/** A tiny rider in the air, leaning into a spin. */
function rider(x: number, y: number, tilt: number): string {
  return (
    `<g transform="translate(${x} ${y}) rotate(${tilt})">` +
    `<rect x="-7" y="5" width="14" height="1.6" rx="0.8" fill="#1d2630"/>` +
    `<path d="M-2 5 L-1 0 M2 5 L1 0" stroke="#5f6b3a" stroke-width="2.2" stroke-linecap="round"/>` +
    `<rect x="-2.6" y="-6" width="5.2" height="6.5" rx="1.5" fill="#d8572a"/>` +
    `<circle cx="0" cy="-8.2" r="2.3" fill="#1d2630"/></g>`
  );
}

const ART: Record<MapId, string> = {
  park:
    sky('park', '#76aee6', '#d7e8f7') +
    `<path d="M0 50 L26 30 L44 41 L70 18 L98 42 L120 27 L160 47 L160 90 L0 90Z" fill="#bfd2e6"/>` +
    `<path d="M0 58 Q80 44 160 62 L160 90 L0 90Z" fill="${SNOW}"/>` +
    `<path d="M22 78 Q44 76 54 63 L60 63 L60 80 L22 80Z" fill="#fff" stroke="${SHADE}"/>` +
    `<path d="M54 63 L60 63" stroke="${LIP}" stroke-width="2.6"/>` +
    rider(76, 38, -24) +
    `<path d="M96 68 L136 75" stroke="${METAL}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M102 69 v6 M115 71.3 v6 M128 73.6 v6" stroke="${POST}" stroke-width="1.4"/>` +
    `<path d="M8 66 h12 M142 64 h12" stroke="#ff7a1a" stroke-width="2"/>`,
  jampark:
    sky('jampark', '#6aa6e4', '#d4e6f7') +
    `<path d="M0 46 L30 28 L52 38 L78 20 L104 36 L128 24 L160 40 L160 90 L0 90Z" fill="#bfd2e6"/>` +
    `<path d="M0 54 Q80 42 160 56 L160 90 L0 90Z" fill="${SNOW}"/>` +
    `<path d="M4 70 L34 76" stroke="${METAL}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M10 71.2 v6 M22 73.6 v6" stroke="${POST}" stroke-width="1.4"/>` +
    `<path d="M40 84 Q60 82 70 66 L76 66 L76 86 L40 86Z" fill="#fff" stroke="${SHADE}"/>` +
    `<path d="M70 66 L76 66" stroke="${LIP}" stroke-width="2.6"/>` +
    rider(94, 34, 20) +
    `<path d="M112 80 Q132 79 138 62 L160 62 L160 90 L112 90Z" fill="#fff" stroke="${SHADE}"/>` +
    `<path d="M138 62 L144 62" stroke="${LIP}" stroke-width="2.6"/>` +
    `<path d="M36 62 h10 M100 60 h10" stroke="#ff7a1a" stroke-width="2"/>`,
  freeride:
    sky('freeride', '#5d93d1', '#cfe1f3') +
    `<path d="M0 46 L22 22 L34 32 L56 6 L72 26 L84 16 L104 38 L124 14 L144 34 L160 26 L160 90 L0 90Z" fill="${SNOW}"/>` +
    `<path d="M56 6 L62 20 L52 30 L58 16Z M124 14 L128 28 L118 36 L122 24Z M84 16 L88 30 L80 34Z" fill="${ROCK}"/>` +
    `<path d="M30 58 L58 52 L60 60 L32 66Z" fill="${ROCK}"/>` +
    `<path d="M0 70 Q60 58 160 74 L160 90 L0 90Z" fill="#e8eff7"/>` +
    pine(104, 74, 1) + pine(114, 77, 1.2) + pine(124, 74, 0.9) + pine(134, 78, 1.1) + pine(146, 76, 1) +
    pine(12, 80, 0.9) + pine(20, 82, 1.1),
  city:
    sky('city', '#3d4f86', '#f0b27a') +
    `<path d="M0 62 L0 40 h10 v-6 h8 v8 h6 v18Z" fill="#7d86a6"/>` +
    `<path d="M40 64 V20 h14 V64Z M58 64 V8 h12 V64Z M74 64 V28 h16 V64Z M96 64 V14 h11 V64Z M112 64 V32 h18 V64Z M134 64 V22 h12 V64Z" fill="#5a6488"/>` +
    `<path d="M61 6 v-6" stroke="#5a6488" stroke-width="1.2"/>` +
    `<path d="M43 26 h8 M43 34 h8 M43 42 h8 M61 14 h6 M61 22 h6 M61 30 h6 M61 38 h6 M99 20 h5 M99 30 h5 M99 40 h5 M137 28 h6 M137 38 h6" stroke="#ffd98a" stroke-width="1.6"/>` +
    `<path d="M0 54 h44 v36 H0Z" fill="#9a6a4a"/><path d="M0 52 h46 l-2 3 H0Z" fill="${SNOW}"/>` +
    `<path d="M6 62 h5 v5 h-5Z M18 62 h5 v5 h-5Z M30 62 h5 v5 h-5Z M6 74 h5 v5 h-5Z M30 74 h5 v5 h-5Z" fill="#ffd98a"/>` +
    `<path d="M112 66 h48 v24 h-48Z" fill="#c8553d"/><path d="M110 64 h50 v3 h-50Z" fill="${SNOW}"/>` +
    `<path d="M118 72 h6 v5 h-6Z M132 72 h6 v5 h-6Z M146 72 h6 v5 h-6Z" fill="#2a3c52"/>` +
    rider(80, 40, -18) +
    `<path d="M46 90 L60 80 h10 L84 90Z" fill="#e8eff7"/><path d="M60 80 L82 90 M56 83 L74 91" stroke="#c9d6e8" stroke-width="1"/>` +
    `<path d="M58 76 L78 87" stroke="#2f4a3c" stroke-width="1.8" stroke-linecap="round"/><path d="M62 78 v6 M72 84 v5" stroke="#26372e" stroke-width="1.2"/>` +
    `<path d="M92 90 v-22 M90 68 h4" stroke="#3a3f45" stroke-width="1.2"/><circle cx="92" cy="67" r="1.6" fill="#ffe8a8"/>`,
  slalom:
    sky('slalom', '#82b6ea', '#dceaf7') +
    `<path d="M0 44 L36 26 L60 36 L92 16 L124 34 L160 24 L160 90 L0 90Z" fill="#bfd2e6"/>` +
    `<path d="M0 50 Q80 40 160 52 L160 90 L0 90Z" fill="${SNOW}"/>` +
    `<path d="M70 52 Q60 62 76 70 Q92 78 80 90" fill="none" stroke="#9cc0ee" stroke-width="2" stroke-dasharray="4 3"/>` +
    `<path d="M64 52 v10 M74 52 v10" stroke="#d8342c" stroke-width="2"/>` +
    `<path d="M80 63 v12 M92 63 v12" stroke="#2f62d0" stroke-width="2.2"/>` +
    `<path d="M66 76 v13 M80 76 v13" stroke="#d8342c" stroke-width="2.4"/>` +
    `<path d="M24 50 v40 M136 52 v38" stroke="#ff7a1a" stroke-width="1.5" stroke-dasharray="2 2"/>`,
  bigair:
    sky('bigair', '#253f6b', '#6f8fbf') +
    `<path d="M0 60 L40 44 L80 52 L120 38 L160 50 L160 90 L0 90Z" fill="#8ea6c4"/>` +
    `<path d="M16 26 h18 v6 h-18Z" fill="${WOOD}"/>` +
    `<path d="M18 32 v48 M32 32 v48 M18 40 L32 52 M32 40 L18 52 M18 56 L32 68 M32 56 L18 68" stroke="${POST}" stroke-width="1.4"/>` +
    `<path d="M34 30 Q52 66 84 70 L92 62 L96 80 L34 80Z" fill="${SNOW}"/>` +
    `<path d="M88 64 L92 62" stroke="${LIP}" stroke-width="2.6"/>` +
    `<path d="M104 80 Q124 52 160 60 L160 90 L100 90Z" fill="${SNOW}"/>` +
    rider(108, 26, 30) +
    `<path d="M150 20 v70" stroke="${POST}" stroke-width="1.6"/><rect x="143" y="14" width="14" height="6" rx="1" fill="#fff6c8"/>`,
  test:
    sky('test', '#8fbde9', '#dfecf8') +
    `<path d="M0 34 L160 34 L160 90 L0 90Z" fill="${SNOW}"/>` +
    `<path d="M40 34 v56 M80 34 v56 M120 34 v56" stroke="${SHADE}" stroke-width="1"/>` +
    `<path d="M6 44 Q6 60 20 60 Q34 60 34 44" fill="none" stroke="#a9bcd4" stroke-width="3"/>` +
    `<path d="M48 76 Q62 74 68 62 L72 62 L72 78Z" fill="#fff" stroke="${SHADE}"/><path d="M68 62 L72 62" stroke="${LIP}" stroke-width="2.4"/>` +
    `<path d="M88 56 L112 64" stroke="${METAL}" stroke-width="2.4" stroke-linecap="round"/><path d="M94 58 v6 M106 62 v6" stroke="${POST}" stroke-width="1.4"/>` +
    `<path d="M128 46 v10 M136 46 v10" stroke="#d8342c" stroke-width="2"/><path d="M142 62 v10 M150 62 v10" stroke="#2f62d0" stroke-width="2"/>`,
};

export function mapArt(id: MapId): string {
  return `<svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${ART[id]}</svg>`;
}
