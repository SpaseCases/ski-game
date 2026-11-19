// The multiplayer Worker's checks (milestone 27), against the local Worker:
//   cd worker && npm run dev        (in one terminal)
//   node test/mp.test.mjs           (in another; about 40 s)
// Lobbies, joins and leaves, the relay, chat, scores, the developer's hits,
// a full lobby, bad messages, 40 connections from one address (a class),
// flooding, rejoining from the same game, and a rider going silent and
// coming back. Prints each check and a count of failures.
import { readFileSync } from 'node:fs';

const API = process.env.API ?? 'http://localhost:8787';
const WS = API.replace(/^http/, 'ws');
const SET = 'set=test';
let failures = 0;
const ok = (cond, what) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const devCode = (() => {
  try {
    return /DEV_CODE=(.*)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
})();

// The binary state layout (src/online/mpRules.ts): 30 fields, positions 4 bytes, the rest 2.
const WIDTHS = Array.from({ length: 30 }, (_, i) => (i < 3 ? 4 : 2));
const SAMPLE = WIDTHS.reduce((a, b) => a + b, 0);
function state(seq, mask = 0) {
  const extra = WIDTHS.reduce((n, w, i) => n + (mask & (1 << i) ? w : 0), 0);
  const buf = new ArrayBuffer(4 + SAMPLE + 4 + extra);
  const dv = new DataView(buf);
  dv.setUint8(0, 1);
  dv.setUint16(2, seq, true);
  dv.setInt32(4, 12345, true);
  dv.setUint32(4 + SAMPLE, mask, true);
  return buf;
}

async function post(path, body) {
  const res = await fetch(`${API}${path}?${SET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function get(path, q) {
  const res = await fetch(`${API}${path}?${SET}&${q}`);
  return { status: res.status, body: await res.json() };
}

/** A rider: a socket with every message kept, and helpers to wait for one. */
function rider(code, name = 'Tester', opts = {}) {
  const ws = new WebSocket(`${WS}/v1/mp/join?code=${code}${opts.force ? `&force=${opts.force}` : ''}`);
  ws.binaryType = 'arraybuffer';
  const r = { ws, got: [], bins: [], closed: null, welcome: null, token: opts.token ?? Math.random().toString(36).slice(2, 12).padEnd(10, 'x') };
  const waiters = [];
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const m = e.data[0] === '{' ? JSON.parse(e.data) : { t: 'raw', text: e.data };
      if (m.t === 'welcome') r.welcome = m;
      r.got.push(m);
    } else r.bins.push(new Uint8Array(e.data));
    for (const w of [...waiters]) if (w.test()) { waiters.splice(waiters.indexOf(w), 1); w.done(true); }
  };
  ws.onclose = (e) => {
    r.closed = { code: e.code, reason: e.reason };
    for (const w of [...waiters]) if (w.test()) { waiters.splice(waiters.indexOf(w), 1); w.done(true); }
  };
  r.until = (test, ms = 3000) =>
    test() ? Promise.resolve(true) : new Promise((done) => {
      const w = { test, done };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); done(false); } }, ms);
    });
  r.open = new Promise((res) => { ws.onopen = () => res(true); setTimeout(() => res(false), 3000); });
  r.hello = async (extra = {}) => {
    await r.open;
    ws.send(JSON.stringify({ t: 'hi', name, outfit: '{"jacket":"#d23"}', token: r.token, ...extra }));
    return r.until(() => r.welcome !== null || r.closed !== null);
  };
  r.json = (m) => ws.send(JSON.stringify(m));
  r.has = (t, f = () => true) => r.got.some((m) => m.t === t && f(m));
  return r;
}

async function main() {
  // Lobbies.
  const bad = await post('/v1/mp/create', { map: 'park', title: 'x', open: true });
  ok(bad.status === 400, `a 1-letter title is refused (${bad.status})`);
  const badMap = await post('/v1/mp/create', { map: 'moon', title: 'Moon run', open: true });
  ok(badMap.status === 400, 'an unknown map is refused');
  const lob = await post('/v1/mp/create', { map: 'park', title: 'Park laps 1', open: true });
  ok(lob.status === 200 && /^[A-Z]{4}$/.test(lob.body.code), `a lobby is created (${lob.body.code})`);
  const code = lob.body.code;
  const priv = await post('/v1/mp/create', { map: 'park', title: 'Secret', open: false });
  const info = await get('/v1/mp/lobby', `code=${code}`);
  ok(info.body.lobby?.map === 'park' && info.body.lobby.riders === 0, 'its details read back');
  const none = await get('/v1/mp/lobby', 'code=ZZZZ');
  ok(none.status === 404, 'an unused code has no lobby');

  // Joining and the relay.
  const a = rider(code, 'Alpha');
  ok(await a.hello(), 'A joins');
  ok(a.welcome?.riders.length === 0 && a.welcome.you >= 1 && a.welcome.title === 'Park laps 1', 'A is welcomed alone, with an id and the title');
  let list = await get('/v1/mp/lobbies', 'map=park');
  ok(list.body.lobbies.some((l) => l.code === code && l.riders === 1), 'the open lobby is listed with 1 rider');
  const b = rider(code, 'Beta');
  ok(await b.hello(), 'B joins');
  ok(b.welcome.riders.length === 1 && b.welcome.riders[0].name === 'Alpha' && b.welcome.riders[0].outfit.includes('jacket'), 'B sees A with A\'s outfit');
  ok(await a.until(() => a.has('join', (m) => m.r.name === 'Beta')), 'A hears B join');
  a.ws.send(state(1));
  ok(await b.until(() => b.bins.length > 0), 'B gets A\'s state');
  ok(b.bins[0]?.[1] === a.welcome.you, 'stamped with A\'s id');
  await sleep(200);
  ok(a.bins.length === 0, 'A doesn\'t get its own state back');
  a.ws.send(state(2, 0b101));
  ok(await b.until(() => b.bins.length > 1), 'a state with changes in B (a mask) is relayed');
  a.ws.send('k');
  ok(await b.until(() => b.has('raw', (m) => m.text === `k${a.welcome.you}`)), 'a keep-alive is relayed as k<id>');

  // Chat, scores, hits.
  a.json({ t: 'c', text: '  that   was  sick!! ' });
  ok(await b.until(() => b.has('c', (m) => m.text === 'that was sick!!')), 'chat is relayed, tidied');
  ok(await a.until(() => a.has('c')), 'the sender sees its own line');
  a.json({ t: 'c', text: 'again' });
  ok(await a.until(() => a.has('c-slow')), 'a second line within 2 s is refused');
  await sleep(2100);
  a.json({ t: 'c', text: 'you f4ggot' });
  ok(await a.until(() => a.has('c-no')), 'a slur is refused');
  await sleep(2100);
  a.json({ t: 'c', text: 'well shit' });
  ok(await b.until(() => b.has('c', (m) => m.text === 'well shit')), 'swearing gets through (only slurs are filtered)');
  a.json({ t: 's', best: 12500, trick: 'Switch 720 Japan' });
  ok(await b.until(() => b.has('s', (m) => m.best === 12500)), 'a banked score is relayed');
  a.json({ t: 'h', to: b.welcome.you, x: 1, z: 0 });
  await sleep(300);
  ok(!b.has('hit'), 'a hit from a rider without the developer\'s code does nothing');
  if (devCode) {
    const d = rider(code, 'Devvy');
    await d.hello({ dev: devCode });
    d.json({ t: 'h', to: b.welcome.you, x: 0.5, z: -0.5 });
    ok(await b.until(() => b.has('hit', (m) => m.by === 'Devvy')), 'the developer\'s hit reaches the rider');
    d.ws.close();
    const w = rider(code, 'Wrongo');
    await w.hello({ dev: 'not the code' });
    w.json({ t: 'h', to: b.welcome.you, x: 0, z: 1 });
    await sleep(300);
    ok(b.got.filter((m) => m.t === 'hit').length === 1, 'a wrong code\'s hit does nothing');
    w.ws.close();
  } else console.log('skip the developer\'s hit (no worker/.dev.vars)');

  // Leaving, and a rider going silent and coming back.
  b.ws.close();
  ok(await a.until(() => a.has('leave', (m) => m.id === b.welcome.you)), 'A hears B leave');
  const c = rider(code, 'Sleepy');
  await c.hello();
  await sleep(8000);
  a.ws.send(state(3));
  await sleep(200);
  ok(c.closed === null && c.bins.length > 0, 'a rider silent for 8 s is still connected and still gets states');
  c.ws.send(state(9));
  ok(await a.until(() => a.bins.length > 0), 'and its state reaches the others when it speaks again');

  // Rejoining from the same game replaces the old connection.
  const c2 = rider(code, 'Sleepy', { token: c.token });
  await c2.hello();
  ok(await c.until(() => c.closed !== null) && c.closed.code === 4410, `the old connection is closed as replaced (${c.closed?.code})`);
  ok(await a.until(() => a.has('leave', (m) => m.id === c.welcome.you)), 'the others see the old one leave');
  c2.ws.close();

  // Bad messages.
  const x = rider(code, 'Badbin');
  await x.hello();
  x.ws.send(new ArrayBuffer(10));
  ok(await x.until(() => x.closed !== null) && x.closed.code === 4400, `a short state closes the connection (${x.closed?.code})`);
  const y = rider(code, 'Badjson');
  await y.hello();
  y.ws.send('{not json');
  ok(await y.until(() => y.closed !== null) && y.closed.code === 4400, 'bad JSON closes the connection');
  const z = rider(code, 'Bad name with a far too long name');
  await z.hello();
  ok(z.closed?.code === 4400, 'a name that breaks the rules is refused');
  const n = rider(code, 'faggot');
  await n.hello();
  ok(n.closed?.code === 4400, 'a filtered name is refused');
  const s = rider(code, 'Rider 4821');
  ok((await s.hello()) && s.welcome !== null, 'a stand-in name (Rider 1234) is taken');
  s.ws.close();

  // Flooding.
  const f = rider(code, 'Flooder');
  await f.hello();
  const flood = setInterval(() => { for (let i = 0; i < 6; i++) if (f.ws.readyState === 1) f.ws.send('k'); }, 100);
  ok(await f.until(() => f.closed !== null, 6000) && f.closed.code === 4413, `60 messages a second closes the connection (${f.closed?.code})`);
  clearInterval(flood);

  // A full lobby.
  const full = await post('/v1/mp/create', { map: 'city', title: 'Full house', open: true });
  const riders = [];
  for (let i = 0; i < 16; i++) riders.push(rider(full.body.code, `Full ${i}`));
  const joined = await Promise.all(riders.map((r) => r.hello()));
  ok(joined.every(Boolean) && riders.every((r) => r.welcome), '16 riders fit in a lobby');
  const extra = rider(full.body.code, 'Seventeen');
  await extra.until(() => extra.closed !== null);
  ok(extra.closed?.code === 4409, `the 17th is refused as full (${extra.closed?.code})`);
  list = await get('/v1/mp/lobbies', 'map=city');
  ok(list.body.lobbies.some((l) => l.code === full.body.code && l.riders === 16), 'the list shows it full');
  riders.forEach((r) => r.ws.close());

  // A class from one address: 40 connections across three lobbies.
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await post('/v1/mp/create', { map: 'jampark', title: `Class ${i + 1}`, open: true })).body.code);
  const klass = Array.from({ length: 40 }, (_, i) => rider(codes[i % 3], `Student ${i}`));
  const all = await Promise.all(klass.map((r) => r.hello()));
  ok(all.every(Boolean) && klass.every((r) => r.welcome), '40 riders from one address all get in');
  klass.forEach((r) => r.ws.close());

  // No host: the lobby stays while anyone is in it, whoever made it (the user's ask).
  const kept = await post('/v1/mp/create', { map: 'freeride', title: 'Stays open', open: true });
  const maker = rider(kept.body.code, 'Maker');
  await maker.hello();
  const stayer = rider(kept.body.code, 'Stayer');
  await stayer.hello();
  maker.ws.close();
  ok(await stayer.until(() => stayer.has('leave')), 'the one who made the lobby leaves');
  list = await get('/v1/mp/lobbies', 'map=freeride');
  ok(list.body.lobbies.some((l) => l.code === kept.body.code && l.riders === 1), 'the lobby is still listed with the rider left in it');
  const later = rider(kept.body.code, 'Later');
  ok((await later.hello()) && later.welcome?.riders.some((r) => r.name === 'Stayer'), 'a new rider still joins it and meets the one there');
  stayer.ws.close();
  later.ws.close();
  await sleep(300);
  list = await get('/v1/mp/lobbies', 'map=freeride');
  ok(!list.body.lobbies.some((l) => l.code === kept.body.code), 'once everyone has left it drops off the list');
  const back = rider(kept.body.code, 'Comeback');
  ok((await back.hello()) && back.welcome !== null, 'and its code still lets someone back in');
  back.ws.close();

  // Private lobbies, unknown codes, the day running out.
  list = await get('/v1/mp/lobbies', 'map=park');
  const p = rider(priv.body.code, 'Hidden');
  await p.hello();
  list = await get('/v1/mp/lobbies', 'map=park');
  ok(!list.body.lobbies.some((l) => l.code === priv.body.code) && p.welcome?.open === false, 'a private lobby is joinable by code and never listed');
  p.ws.close();
  const gone = rider('ZZZZ', 'Lost');
  await gone.until(() => gone.closed !== null);
  ok(gone.closed?.code === 4404, `an unused code is refused (${gone.closed?.code})`);
  const today = rider(code, 'Late', { force: 'full' });
  await today.until(() => today.closed !== null);
  ok(today.closed?.code === 4429, `the day running out reads "full today" (${today.closed?.code})`);

  a.ws.close();
  await sleep(300);
  console.log(`\n${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
