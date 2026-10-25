import { defineConfig } from 'vite';
import { wavSink } from './tools/vite/wavSink.js';

// Relative asset paths, so one build works wherever it's served from:
// GitHub Pages (https://<user>.github.io/ski-game/) and Firebase Hosting
// (at the site's root).
export default defineConfig({
  base: './',
  // Dev builds can save every sound as a WAV file (src/audio/wav.ts).
  plugins: [wavSink()],
  build: {
    // Three.js alone is ~530 kB minified (~135 kB gzipped); warn only past that.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      // The game, plus the skier pose showcase used for reviewing the model.
      input: { main: 'index.html', poses: 'poses.html' },
    },
  },
});
