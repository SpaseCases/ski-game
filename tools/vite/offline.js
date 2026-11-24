// Production builds only: writes dist/sw.js, the service worker that lets
// the game run with no connection once it's been opened online (2026-11-24,
// the user's ask: an app on his phone he can play offline). src/core/offline.ts
// registers it, only on a phone or the installed app, never in an embed.
//
// The worker's file list is every file in dist/ once the build is written
// (the game's chunks, the maps, the public files), less the pages that
// aren't the game. Its cache name carries a hash of that list's contents,
// so each deploy gets a fresh cache and the old one is dropped.
//
// What it does (in the worker's own words below): the page itself comes from
// the network when there is one, else from the cache; everything else of
// this site comes from the cache when it's there. The leaderboards and
// multiplayer are another origin and pass straight through (offline they
// say so, as they always have).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Not part of the game: the pose showcase, the test pages, source maps, and the worker itself. */
const SKIP = /^(sw\.js|poses\.html|embed-test\.html|net-test\.html)$|^assets\/poses[-.]|\.map$/;

/** @param {string} dir @returns {string[]} */
function files(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.push(relative(dir, path).split(sep).join('/'));
  }
  return out.sort();
}

/** @returns {import('vite').Plugin} */
export function offline() {
  /** @type {string} */
  let outDir = 'dist';
  return {
    name: 'park-laps-offline',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    writeBundle: {
      // After every other plugin's output is on disk.
      order: 'post',
      sequential: true,
      handler() {
        const list = files(outDir).filter((f) => !SKIP.test(f));
        const hash = createHash('sha256');
        for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
        const version = hash.digest('hex').slice(0, 12);
        // './' is the page itself (index.html as the site serves it).
        const urls = ['./', ...list.filter((f) => f !== 'index.html')];
        writeFileSync(join(outDir, 'sw.js'), worker(version, urls));
      },
    },
  };
}

/** @param {string} version @param {string[]} urls */
function worker(version, urls) {
  return `// Park Laps offline worker, written by tools/vite/offline.js. Build ${version}.
const CACHE = 'park-laps-${version}';
const FILES = ${JSON.stringify(urls)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('park-laps-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // The newest page when online; this build's page when not.
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match('./').then((r) => r || c.match(req, { ignoreSearch: true })))));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((r) => r || fetch(req))));
});
`;
}
