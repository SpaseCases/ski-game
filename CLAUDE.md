# CLAUDE.md

Browser-based 3D freeski game for Chromebooks. Read `GAME_DESIGN.md` before starting any feature. It is the source of truth for what to build.

## Stack (don't add dependencies without asking)
- Three.js (pin the exact version), `WebGLRenderer` only (no WebGPU)
- TypeScript (strict), Vite
- No backend, no accounts. Static build output in `/dist`
- Dev only: lil-gui panel for live-tuning physics values (excluded from production builds)
- No physics engine in v1. Rapier comes in only if ragdoll crashes are added later

## Hard constraints
- **Target hardware:** low-end Chromebooks: ~4GB RAM, Celeron/MediaTek-class CPU, integrated GPU, 1366×768 screen. Must hold 60fps on the Low preset there and never drop below 30.
- **Keyboard only.** No mouse-look, no pointer lock, no right-click. The mouse is only for clicking menus.
- **Runs inside an iframe:** a Google Sites page embeds the GitHub Pages URL. Detect `window.self !== window.top`; when embedded, show an "Open in new tab" button. Only show a Fullscreen button when `document.fullscreenEnabled` is true.
- **No sound before the first user input** (browser autoplay rules).
- **localStorage can throw or get wiped.** Wrap every read and write in try/catch; the game must work without it.
- **Original work only.** The game is inspired by Shredsauce but has its own name, art, sounds, and code. Never copy Shredsauce assets, level files, logos, or text.

## Performance rules
- Low-poly, flat-shaded (`flatShading: true`, vertex colors instead of textures)
- Instanced meshes for trees and flags; merge static map geometry
- Fog caps draw distance; tie the camera far plane to the fog distance
- Lighting: one directional light plus one hemisphere light. No shadow maps on Low; use a blob-shadow decal under the skier instead
- Quality presets Low / Medium / High plus Auto, which lowers the pixel ratio when frame time stays over budget. Low = pixelRatio 1, antialias off
- No allocations in the per-frame loop (reuse vectors and quaternions)

## Architecture
- Fixed-timestep simulation (120 Hz with an accumulator), separate from rendering; the renderer interpolates
- Simulation code never touches Three.js scene objects. The render layer reads sim state
- Every tunable number (gravity, drag, friction, pop strength, spin and flip rates, landing tolerance, rail snap distance, camera offsets) lives in `src/config.ts`
- Maps are data: a heightfield plus a JSON list of features (jumps, rails, boxes, flags, trees, spawn, finish zone). No map is hard-coded into game logic

```
src/
  main.ts
  config.ts
  core/      game loop, input (rebindable keys), settings, storage
  sim/       skier physics, terrain sampling, rails, landing and bail checks
  render/    scene, skier model and poses, camera, quality auto-scaling
  maps/      map loader, terrain generation, maps/*.json
  ui/        HTML/CSS menus and HUD overlays
  audio/     Web Audio sound effects
```

## Tools
- **Three.js skills** in `.claude/skills/` are API reference, written against r160. They don't override this file: no OrbitControls or pointer lock, no post-processing, no PBR materials or textures on the Low preset. If a skill's example disagrees with the installed Three.js version, the current docs win.
- **Context7 MCP:** look up current Three.js and Vite docs before using an API you're unsure of, especially anything that changed after r160.
- **Playwright MCP:** play-test every milestone (see Workflow).
- **Chrome DevTools MCP:** record a performance trace whenever frame time is over budget, and in milestone 8. Fix what the trace shows rather than guessing.
- **frontend-design plugin:** use it for the menus and HUD in milestone 6.

## Workflow
- Build in the milestone order in `GAME_DESIGN.md`. Finish and verify each milestone before starting the next.
- Greybox first: boxes and simple shapes until the feel is right. Polish comes after.
- After each milestone, run `npm run build` with zero errors. Then use the Playwright MCP to open the game, drive it with key presses, take screenshots, and check the console. A milestone isn't done until that passes.
- Also test through `embed-test.html` (a page that loads the game in an iframe) to catch embed problems.
- Commit at every working milestone with a clear message.
- When a mechanic feels wrong, adjust numbers in `config.ts` before rewriting logic.

## Deploy
- A GitHub Actions workflow builds on every push to `main` and deploys `/dist` to GitHub Pages
- Set Vite's `base` to the repo name so asset paths resolve on Pages
