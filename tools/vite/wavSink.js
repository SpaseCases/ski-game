// Dev server only: takes the WAV files the game renders in dev builds
// (parkLaps.audio.renderWavs(), src/audio/wav.ts) and writes them into
// .playwright-mcp/audio/, which is gitignored, so the sounds can be
// listened to outside the game.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** @returns {import('vite').Plugin} */
export function wavSink() {
  return {
    name: 'park-laps-wav-sink',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(server.config.root, '.playwright-mcp', 'audio');
      server.middlewares.use('/__audio-wav', (req, res) => {
        const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? '';
        if (req.method !== 'POST' || !/^[\w.-]+\.wav$/.test(name)) {
          res.statusCode = 400;
          res.end('POST a .wav with ?name=');
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}
