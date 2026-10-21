// The title screen's painted mountain, behind the menus while no map is
// loaded: flat shapes in the game's palette (sky, far ranges, a snowy peak,
// a chairlift, pines, and a rider in the air off a kicker). One static SVG,
// so it costs nothing per frame.

const PINE = '#2f5b46';
const PINE_DARK = '#244a39';

function pine(x: number, y: number, s: number): string {
  return (
    `<path d="M${x} ${y - 70 * s} L${x + 24 * s} ${y - 22 * s} L${x + 14 * s} ${y - 22 * s} L${x + 30 * s} ${y} L${x - 30 * s} ${y} L${x - 14 * s} ${y - 22 * s} L${x - 24 * s} ${y - 22 * s}Z" fill="${PINE}"/>` +
    `<path d="M${x} ${y - 70 * s} L${x + 24 * s} ${y - 22 * s} L${x + 14 * s} ${y - 22 * s} L${x + 30 * s} ${y} L${x} ${y}Z" fill="${PINE_DARK}"/>`
  );
}

function tower(x: number, y: number, h: number): string {
  return `<path d="M${x} ${y} L${x} ${y - h} M${x - 14} ${y - h} L${x + 14} ${y - h}" stroke="#56606b" stroke-width="4"/>`;
}

export function titleArt(): string {
  let trees = '';
  const spots: readonly [number, number, number][] = [
    [1090, 760, 1.1], [1150, 790, 1.4], [1215, 770, 1.0], [1280, 800, 1.5], [1350, 780, 1.2], [1420, 810, 1.6],
    [1490, 790, 1.1], [1560, 820, 1.5], [60, 840, 1.3], [130, 860, 1.6], [1010, 800, 0.9],
  ];
  for (const [x, y, s] of spots) trees += pine(x, y, s);
  return (
    `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` +
    `<defs><linearGradient id="title-sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#4f86c6"/><stop offset="0.7" stop-color="#bcd5ee"/><stop offset="1" stop-color="#dce8f3"/></linearGradient></defs>` +
    `<rect width="1600" height="900" fill="url(#title-sky)"/>` +
    // Far ranges, hazier with distance.
    `<path d="M0 520 L120 450 L210 490 L330 400 L430 470 L560 380 L700 460 L820 410 L960 470 L1080 360 L1200 440 L1320 390 L1460 460 L1600 410 L1600 900 L0 900Z" fill="#c5d7ea"/>` +
    `<path d="M0 600 L160 520 L280 560 L420 470 L520 530 L640 500 L760 560 L1600 560 L1600 900 L0 900Z" fill="#dfe9f4"/>` +
    // The peak: snow with a shaded face and rock bands.
    `<path d="M700 640 L980 300 L1060 360 L1120 330 L1400 600 L1600 640 L1600 900 L700 900Z" fill="#f4f8fc"/>` +
    `<path d="M980 300 L1010 420 L960 520 L900 640 L760 660Z" fill="#d3e0ee"/>` +
    `<path d="M980 300 L1004 352 L986 372 L992 410 L970 380 L972 340Z M1120 330 L1136 372 L1118 392 L1112 360Z M1050 420 L1080 440 L1062 470 L1040 452Z" fill="#5d6773"/>` +
    // The chairlift up the shoulder.
    `<path d="M1180 760 L1340 470" stroke="#1b2430" stroke-width="2"/>` +
    tower(1222, 690, 46) + tower(1270, 600, 46) + tower(1318, 512, 46) +
    `<rect x="1244" y="640" width="12" height="9" fill="#c8331f"/><rect x="1296" y="548" width="12" height="9" fill="#2f62d0"/>` +
    // The run: a groomed slope down to a kicker.
    `<path d="M0 760 Q520 640 900 700 Q1240 760 1600 740 L1600 900 L0 900Z" fill="#ffffff"/>` +
    `<path d="M560 742 Q640 736 676 696 L700 696 L700 752Z" fill="#eef3f9" stroke="#c9d6e8" stroke-width="2"/>` +
    `<path d="M676 696 L700 696" stroke="#3f7fe0" stroke-width="7"/>` +
    // A rider in the air, mid-spin, with a faint arc of their flight.
    `<path d="M700 690 Q770 560 860 600" fill="none" stroke="#9cc0ee" stroke-width="3" stroke-dasharray="10 9"/>` +
    `<g transform="translate(830 560) rotate(-28) scale(3.2)">` +
    `<rect x="-9" y="5.2" width="17" height="1.5" rx="0.75" fill="#3a4654"/>` +
    `<rect x="-8" y="6.8" width="17" height="1.5" rx="0.75" fill="#1d2630"/>` +
    `<path d="M-2.4 6 L-1.2 0 M2.4 6 L1.2 0" stroke="#5f6b3a" stroke-width="2.6" stroke-linecap="round"/>` +
    `<rect x="-3" y="-7" width="6" height="7.5" rx="1.6" fill="#d8572a"/>` +
    `<circle cx="0" cy="-9.6" r="2.6" fill="#1d2630"/></g>` +
    trees +
    // Orange boundary rope along the bottom of the run.
    `<path d="M0 846 L1600 830" stroke="#ff7a1a" stroke-width="3" stroke-dasharray="26 14"/>` +
    `</svg>`
  );
}
