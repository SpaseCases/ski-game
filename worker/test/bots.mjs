// Bot riders for play-testing and frame-time checks (milestone 27): each
// joins a lobby and rides a slow circle near a point, sending real state
// messages (the binary layout in src/online/mpRules.ts) 5 times a second
// with two samples each, as the game does. No browser, so they cost the
// game being measured nothing but drawing them.
//   node test/bots.mjs <lobby code> <how many> [x z] [seconds]     (default the Park's start, 120 s)
// API=http://localhost:8787 by default.

const API = process.env.API ?? 'http://localhost:8787';
const [code, countArg, xArg, zArg, secondsArg] = process.argv.slice(2);
if (!code) {
  console.log('usage: node test/bots.mjs <code> <count> [x z] [seconds]');
  process.exit(1);
}
const count = Number(countArg ?? 4);
const cx = Number(xArg ?? -70);
const cz = Number(zArg ?? -45);
const seconds = Number(secondsArg ?? 120);

// The layout: 30 fields; positions 4 bytes (×100), the rest 2 (scales as in mpRules.ts SCALE).
const SCALES = [100, 100, 100, 100, 100, 100, 32767, 32767, 32767, 32767, 10000, 32767, 32767, 32767, 10000, 10000, 10000, 1, 1000, 1000, 1000, 1000, 100, 1, 1, 10000, 100, 10000, 100, 1];
const WIDTHS = SCALES.map((_, i) => (i < 3 ? 4 : 2));
const SAMPLE = WIDTHS.reduce((a, b) => a + b, 0);

function sample(t, k, out) {
  const r = 6 + k * 2;
  const a = t * 0.5 + k;
  const yaw = -a - Math.PI / 2;
  const v = [
    cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r,
    -Math.sin(a) * r * 0.5, 0, Math.cos(a) * r * 0.5,
    0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2),
    yaw, 0, 1, 0,
    0.3, 0.2, 0, 0, 1, 0, 0.9, 0, 0, -1, 0, 0, 5, 0, -1, 1,
  ];
  for (let i = 0; i < 30; i++) out[i] = v[i];
}

function encode(seq, a, b) {
  const buf = new ArrayBuffer(4 + SAMPLE + 4 + SAMPLE);
  const dv = new DataView(buf);
  dv.setUint8(0, 1);
  dv.setUint16(2, seq & 0xffff, true);
  let at = 4;
  const qa = [];
  for (let i = 0; i < 30; i++) {
    const q = Math.round(a[i] * SCALES[i]);
    qa.push(q);
    if (WIDTHS[i] === 4) dv.setInt32(at, q, true);
    else dv.setInt16(at, Math.max(-32768, Math.min(32767, q)), true);
    at += WIDTHS[i];
  }
  const maskAt = at;
  at += 4;
  let mask = 0;
  for (let i = 0; i < 30; i++) {
    const q = Math.round(b[i] * SCALES[i]);
    if (q === qa[i]) continue;
    mask |= 1 << i;
    if (WIDTHS[i] === 4) dv.setInt32(at, q, true);
    else dv.setInt16(at, Math.max(-32768, Math.min(32767, q)), true);
    at += WIDTHS[i];
  }
  dv.setUint32(maskAt, mask >>> 0, true);
  return buf.slice(0, at);
}

for (let k = 0; k < count; k++) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/mp/join?code=${code}`);
  ws.binaryType = 'arraybuffer';
  let seq = 0;
  const a = new Array(30);
  const b = new Array(30);
  const t0 = performance.now();
  ws.onopen = () => {
    const colors = ['#d23b3b', '#2f7fd6', '#2fa65a', '#e0a020', '#8a46c8', '#e05a9a'];
    ws.send(JSON.stringify({ t: 'hi', name: `Bot ${k + 1}`, outfit: JSON.stringify({ jacket: colors[k % colors.length] }), token: `bot${k}x${Date.now().toString(36)}`.slice(0, 16) }));
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      if (t > seconds) {
        clearInterval(timer);
        ws.close();
        return;
      }
      sample(t - 0.1, k, a);
      sample(t, k, b);
      ws.send(encode(seq++, a, b));
    }, 200);
  };
  ws.onclose = (e) => console.log(`bot ${k + 1} closed ${e.code} ${e.reason}`);
  ws.onmessage = (e) => {
    if (typeof e.data === 'string' && e.data.startsWith('{"t":"welcome"')) console.log(`bot ${k + 1} joined`);
  };
}
