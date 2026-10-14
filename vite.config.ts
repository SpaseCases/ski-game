import { defineConfig } from 'vite';

// GitHub Pages serves the site from https://<user>.github.io/ski-game/,
// so every asset path needs the repo name as its base.
export default defineConfig({
  base: '/ski-game/',
  build: {
    // Three.js alone is ~530 kB minified (~135 kB gzipped); warn only past that.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      // The game, plus the skier pose showcase used for reviewing the model.
      input: { main: 'index.html', poses: 'poses.html' },
    },
  },
});
