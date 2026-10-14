# Ski Game

A small, physics-driven, low-poly 3D freeski game that runs in the browser on school Chromebooks. Keyboard only, no accounts, no backend.

- **Play:** https://spasecases.github.io/ski-game/
- **Embed test:** https://spasecases.github.io/ski-game/embed-test.html (loads the game in an iframe like a Google Sites page)

`GAME_DESIGN.md` describes what is being built and the milestone order. `CLAUDE.md` holds the technical rules.

## Develop

Requires Node.js 20.19+ (22 or 24 recommended).

```bash
npm install
npm run dev       # dev server at http://localhost:5173/ski-game/
npm run build     # type-check and build to dist/
npm run preview   # serve the built dist/ at http://localhost:4173/ski-game/
```

Every push to `main` builds the game and deploys `dist/` to GitHub Pages through GitHub Actions.

## Status

Milestone 0 (scaffold and deploy): a greybox slope with one box, an orbiting camera, and a frame-rate readout in the bottom-left corner for checking performance on real hardware.
