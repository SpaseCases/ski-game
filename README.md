# Park Laps

A small, physics-driven, low-poly 3D freeski game that runs in the browser on school Chromebooks. Keyboard only, no accounts, no backend.

- **Play:** https://spasecases.github.io/ski-game/
- **Embed test:** https://spasecases.github.io/ski-game/embed-test.html (loads the game in an iframe like a Google Sites page)
- **Skier poses:** https://spasecases.github.io/ski-game/poses.html (the low-poly skier in every pose, side by side; ← → rotates)

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

See the Status section at the bottom of `GAME_DESIGN.md`: milestones done, known issues, and tuned config values. A frame-rate readout sits in the bottom-left corner for checking performance on real hardware.

`npm run dev` also shows a lil-gui panel for live-tuning the physics and camera numbers in `src/config.ts` ("Copy config as JSON" copies the tuned values), a quality switch, and "Test spots" that put the skier in front of each feature. The panel is left out of production builds; `?quality=low` in the URL picks a quality preset.

## Headless sim checks

`tools/sim/` runs the real simulation in Node with scripted keys, no browser, for sizing features:

```bash
node tools/sim/spin720.ts                              # airtime a clean 720 needs
node tools/sim/jumps.ts src/maps/test-slope.json 14,18 # every jump, no pop and full pop
```

`tools/sim/harness.ts` (`loadMap`, `Rider`) is the base for new checks.
