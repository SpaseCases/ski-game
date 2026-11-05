import { defineConfig } from 'vite';
import { obfuscate } from './tools/vite/obfuscate.js';
import { wavSink } from './tools/vite/wavSink.js';

// Relative asset paths, so one build works wherever it's served from:
// GitHub Pages (https://<user>.github.io/ski-game/) and Firebase Hosting
// (at the site's root).
export default defineConfig({
  base: './',
  // Dev builds can save every sound as a WAV file (src/audio/wav.ts);
  // production builds obfuscate the menu, online and core code and the
  // page's words (tools/vite/obfuscate.js).
  plugins: [wavSink(), obfuscate()],
  build: {
    // Three.js alone is ~530 kB minified (~135 kB gzipped), plus the shared
    // modules obfuscated by tools/vite/obfuscate.js; warn only past that.
    chunkSizeWarningLimit: 750,
    rolldownOptions: {
      // The game, plus the skier pose showcase used for reviewing the model.
      input: { main: 'index.html', poses: 'poses.html' },
    },
  },
});
