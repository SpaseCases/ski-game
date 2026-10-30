# Architecture

A map of the code for finding things fast. `GAME_DESIGN.md` says what to build; `CLAUDE.md` gives the rules. This file says where things live and what breaks easily. Written 2026-10-29 at `4bbd1c9` (after milestone 8). Line numbers rot, so prefer the function names.

## The big picture

```
maps/*.json ──registry (lazy import)──► parseMap ──► buildMap ──► BuiltMap { hf, course{rails,obstacles}, race, decor, starts }
                                                                   │                     │
                         sim (120 Hz, no Three.js scene) ◄─────────┘                     └──► WorldView (render)
                         SkierState ──(prev, cur, alpha)──► interpolateSkier ──► SkierView / ChaseCamera / SnowFx / audio
```

- **No event bus.** Scoring, snow effects and audio each diff `skierPrev` against `skier` themselves to find takeoffs, landings (`landTime` reset), crashes (`bailed` rising), pole plants (`poleTime` reset) and rail entry (`rail` going ≥ 0). Score events sit in a 16-slot ring that readers follow with their own cursor.
- **`TUNING`** (`sim/tuning.ts`) is what the sim reads: CONFIG × the ski's multipliers (`setSkiScale`) × cheats, rebuilt only on change. It covers the `sim`, `skier`, `air`, `landing`, `rails`, `bail`, `slalom` and `giantSlalom` blocks. `score` and `checkpoints` read CONFIG directly, so cheats and skis don't touch them.
- **Invariant used at every milestone:** with every cheat off and the park ski, every `tools/sim` output stays byte-identical unless a change means to alter physics. A/B with `git stash push -- src tools`.

### One frame (`main.ts`, `startLoop` callbacks)
- **Loop** (`core/loop.ts`): rAF re-arms first. Frame time is clamped to `sim.maxFrameTime` (0.25 s, so up to 30 catch-up steps), times `TUNING.sim.timeScale` (Slow motion). Nothing accumulates while `gameWaits()` (no level, a menu or trail map open, or graphics lost). Input edges latch until `sample`.
- **Step:** `keyboard.sample` → trail-map key → R (tap respawns; holding freezes the sim, then `backToTop` after `checkpoints.holdToTop`) → confirm at finish → checkpoint key → `copySkierState(prev, skier)` → `stepSkier` → `sound.step` → `updateRun` → `stepScore` (if scoring) → `stepRace` (it can knock the skier's velocity *after* score and sound saw the step) → toasts → crash fade (unless `crashWait`).
- **Render:** `interpolateSkier` → `skierView.update` → orbit drag → `chase.update` → `world.view` (terrain streaming, culling) → `world.update` → `snow.update` → `lights.update` → `sound.frame` → `renderFrame` (backdrop pass, clear depth, world pass), or `drawLocker` while the Locker is open → HUD → `auto.frame` → `tuningPanel.update`.

## Sim (`src/sim/`)
| File | Owns |
|---|---|
| `skier.ts` | `SkierState` and `stepSkier`. Phases are flags, not an enum: `bailed`, then `rail >= 0` (where `grounded` is also true), then `grounded` (snow), else air. Calls `stepBail`, `slideRail`, `rideSnow` / `fly` (forces), then `moveOnSnow` / `moveInAir` (move, collide, transition), `takeOff`, `land` (landing and bail check), `crash`, `catchRail` (from the air) / `mountRail` (from the snow), plus pops, butters and grabs |
| `terrain.ts` | `sampleSurface` / `groundAt`: bicubic Catmull-Rom on the grid **plus** `topShape` (exact analytic ramps, pipes and decks from `maps/shapes.ts`) |
| `rails.ts` | `buildRailShapes` (polylines into typed arrays), `railUnder` (snap), `railFrame`, `collideRails` |
| `obstacles.ts` | Capsules (trees, rocks, fences, walls) in an 8 m grid; `collideObstacles` and `insideObstacle`. Fences stand only as high as they look (`follow`, `rise`) |
| `bounds.ts` | `keepInside`: map rectangle plus the optional polygon |
| `checkpoints.ts` | `RunState`: flags, personal checkpoint, `respawnSkier`, finish zones |
| `race.ts` | Slalom courses: wand start, gate pass or miss, the finish, and spring-damper bending gates that `knock` the skier |
| `score.ts` | A pure observer: rotation from the `trick` quaternion delta in body axes, combos and multipliers. `sketchyLanding` is shared with audio |

**Config:** `skier`, `air`, `landing`, `rails`, `bail`, `slalom`, `giantSlalom`, `score`, `checkpoints`, `sim`, `cheats`, `skis`.

**Fragile**
- Adding a `SkierState` field means editing `createSkierState`, `copySkierState` and `interpolateSkier` (`render/skierView.ts`) together. Nothing catches a miss.
- `yaw` is frozen at its takeoff value in the air; `land` re-derives it from the body. `interpolateSkier` special-cases this (the switch-landing snap was fixed there), and `race.ts placeBody`, the headlamp and the camera all see the stale yaw mid-air.
- Module-level scratch vectors are shared between functions: `land` / `crash` read the `contactNormal` that `moveInAir` just set, and `railSpot` writes `head` and `railDir`. Reordering calls breaks things silently.
- `air.wallAngle` (44°) decides what counts as a wall. That covers pops, air leveling and how every pipe, gully and lip is authored. Takeoff faces are exempt, and a pop off a lip steeper than 44° goes straight up.
- Landing limits (`landing.*`, scaled per ski) also set "sketchy" in scoring and whether the crowd cheers. Changing a limit changes scores and audio too.
- `race.ts` reads `CONFIG.render`'s lean numbers and hard-codes body heights to place the gate-hit body. Render tuning changes gameplay here, and it can drift from what `skierView` draws.
- `slideRail` skips `keepInside`, `bump` and obstacles. `CHEATS.noCrashes` is checked in four places in `skier.ts`. The obstacle grid bakes `rails.bodyRadius` at build time, so a tuning-panel change to it doesn't apply.
- Linear scans every step: all rails (with a bounding-box cull), all gates in `bendSides`, and `pipeAt` / `quarterInward` over all shapes (long on Freeride's town).
- Numbers outside config: `CREASE_COS`/`CREASE_LEAVE`, the bail stick of 0.25, `LOG_RADIUS`/`TUBE_RADIUS`, the obstacle `CELL`/`SINK`, bounds margins, and score `SIDEWAYS`.
- The sim imports Three.js `Vector3` and `Quaternion` (math only, which is allowed).

## Maps (`src/maps/`, generators in `tools/maps/`)
- **Pipeline:** `registry.ts` (`MapId` union + `MAPS`, one lazy chunk per JSON) → `loader.ts parseMap` (hand-written validation and defaults; **unknown keys are dropped silently**, and nothing is fetched here) → `build.ts buildMap`: `generateTerrain` → `startFrames` → `setShapes` (ramps, pipes, starts, town) → `buildRailShapes` (after the shapes, so rails sit on them) → `layoutDecor` → `buildObstacles` → `buildRace`.
- **Terrain is a recipe, never stored heights.** `generated` (`terrain.ts`: a pitch profile, lanes solved to end level, berms, hills) or `peak` (`peak.ts`: spokes from a summit, Hermite-blended, then ordered `elements` such as ridge, gully, cliffs, lip, bowl, pillows, bumps, dip and flat, plus a rim at the bounds). A `heightfield` type is planned for M19 (Brundage, on hold).
- **Shapes** (`shapes.ts`) are exact Hermite profiles on top of the grid in 32 m cells. The highest one wins. Cliffs are terrain elements; booters are `kicker`/`jump` with `natural: true`.
- `types.ts` holds the whole format (`MapDef`, `Feature` union, `TerrainDef`). `decor.ts` does scatter and thinning (`thinDecor` per preset). `town.ts` builds buildings and terraces; `startGates.ts` builds the deck, tower, ridge and race house.

| Map | Generator | Notes |
|---|---|---|
| park | `park.ts` | 280×2150, 121 features, 2 pipes, the 1,948 m rail |
| jampark | `jampark.ts` (began as a copy of park.ts) | 300×2030, 203 features, quarters and wallrides; on trial beside the Park |
| freeride | `freeride.ts` | Peak, 6.2 km square, 3 m cells (~4.3M samples), town, 4 finishes, 16 runs, powder |
| slalom | `slalom.ts` | Two race courses, `scoring: false`, no flags |
| bigair | `bigair.ts` | 6 lanes (the ski jump and landings are terrain lanes) and a tower |
| test | none: `test-slope.json` is hand-written | Every feature in 4 lanes |

**Adding a map** means touching `registry.ts` (`MapId` and `MAPS`), `ui/mapArt.ts` (`ART`), and a generator.

**Fragile**
- Never hand-edit generated JSON: edit the script and rerun (`node tools/maps/x.ts`). Generators bake in terrain-derived numbers (Freeride's booter yaws and log heights, finish widths), so a change to `peak.ts` or `terrain.ts` means rerunning them. Nothing checks for drift.
- Tree seeds count the decor before them (`seed: 100 + decor.length` in slalom and bigair): add new decor **after** the trees. Big air's shared `rand()` is consumed by spectators first. Changing a scatter's `count` or `area` re-places the whole set.
- `peak.ts` element order matters: a `flat` pad samples the elements before it. Bounds must be star-shaped from the summit.
- Authoring errors throw at build time (gap ≤ 1.5 m, pipe sections too long, a lane that can't get back level).
- Freeride's build is the heaviest (~38 MB of typed arrays, ~2M decor candidates). That matters on 4 GB machines.
- Numbers outside config: `HILLSIDE_RISE`, `RIM_HOLD`, `SHAPE_CELL`, `PIPE_WALL_START`, start-gate sizes, `CHUNK`.

## Rendering: world and quality (`src/render/`)
| File | Owns |
|---|---|
| `scene.ts` | Renderer, scene, one hemisphere and one sun light, fog, camera; `setViewRange` and `applyWeather` tie `camera.far` to the view |
| `world.ts` | `WorldView` per map: builds and owns the rest, `setQuality`, `setWeather`, `warm`, `dispose` |
| `terrainMesh.ts` | Chunk streaming (24-cell chunks; far ones coarser with skirts past 330 m); `render.terrain.chunksPerFrame` / `snapRange` |
| `decor.ts`, `culling.ts` | Instanced trees and rocks per 160 m tile, other props merged per 64 m tile. The culler **detaches** tiles by distance and swaps far trees to stand-ins past `treeDetail` |
| `backdrop.ts` | A separate scene drawn first: sky dome, sun, moon, stars, far peaks, foothills, the far stand-in for the map |
| `features.ts`, `railMesh.ts`, `startGates.ts`, `checkpointMeshes.ts`, `slalomView.ts`, `chairlifts.ts`, `town.ts`, `signs.ts`, `font.ts`, `models.ts`, `smoke.ts`, `cloth.ts` | Feature and scenery meshes (`meshKit.ts` / `triBuilder.ts` merge geometry; `font.ts` is stroke geometry, no textures) |
| `snowFx.ts` | One pooled ring buffer: instanced snow and sparks, point-sprite wisps, a ribbon track per ski, flakes, ridge emitters |
| `weather.ts` | Turns `CONFIG.weather` into a look (`core/weather.ts` stores the pick) |
| `lightPools.ts` | Night: `litByPools` shader patch for the headlamp and the nearest `lights.max` lamps, summed per vertex |
| `autoQuality.ts` | The Auto ladder (Medium → Medium at 1× → Low view → Low; only steps down, `autoRung` saved) |
| `upload.ts` | Partial buffer uploads that don't allocate |

**Presets** (`config.quality`): Low has density 0.35, 240 m view, fog wall, pixel ratio 1, no AA, 320 particles. Medium has 0.7, 450 m, haze to 3200, up to 1.5×, 700. High has 1.0, 800 m, haze to 6000, up to 2×, AA (from the next start), 1200. `setQuality` rebuilds decor and SnowFx; `setWeather` rebuilds nothing.

**Fragile**
- `matrixAutoUpdate = false` on the scene, the world group, terrain and decor (`still()`). Anything built there must have identity-relative transforms or call `updateMatrix()` itself. Wand pivots and the checkpoint marker auto-update on purpose.
- Two `onBeforeCompile` patches (`lightPools.ts`, `cloth.ts`) depend on Three.js `#include` chunk names. Recheck them on any Three.js upgrade. `POOL_MAX` is baked in at import, and the pool's fragment code runs by day too.
- `disposeTree` handles `Mesh` only and also disposes module-level shared materials. Wisp `Points` slip through. A suspected hitch: an Auto step-down's `setQuality` frees the decor material and recompiles it mid-ride without `warm` (unmeasured).
- A fresh `SnowFx` after `setQuality` may fire one spurious landing puff (its `lastLandTime` starts at Infinity).
- On Medium and High `camera.far` stops at the view (450/800 m) while haze runs to 3200/6000 m. The backdrop stand-in covers the gap.
- Low's view (240) exceeds `treeDetail` (220), so Low builds far-tree stand-ins for a 20 m band that is mostly fog.
- Features, rails, gates, lifts and checkpoints are never culled. `SlalomView` re-uploads every instance matrix every frame. Context loss shows a Reload message; there is no restore path.

## Rendering: skier and camera
- `skierRig.ts`: `SkierRig`, a group of per-segment merged meshes (one Lambert vertex-color material, 16 draw calls). `apply(PoseDef)` places the core, then runs two-bone IK. A grabbed ski is pulled to the hand. `setOutfit` rebuilds only the parts that changed; `setGlow` lights the pumpkin face. `JacketLower` is rebuilt every frame and is the rig's main CPU cost.
- `skierPoses.ts`: pose data. `GRABS` order must match `GRAB_ACTIONS` in `core/input.ts`; the sim's `grab` is that index. `poseBlend.ts`: STANCE + Σ w·(target − STANCE), with Euler blending.
- `skierView.ts`: `interpolateSkier` (the sim → render bridge) and `SkierView.update` (sim fields to pose weights, turn lean, pole stroke, landing squash, blob shadow, `sitOnDrawnSnow`).
- `skiModel.ts` + `core/skis.ts` (ski data and the layer painter, shared with the Locker thumbnails); `core/outfit.ts` (palette, `outfit.v1`).
- `chaseCamera.ts`: heading blends from ski yaw to travel direction, distance and height scale with speed, plus `slopeLift` and the pipe heading. Drag-orbit comes from `core/pointerOrbit.ts` and eases back after `orbitReturnDelay`. The camera ignores obstacles.
- `lockerStage.ts`: the preview is drawn in a scissored rectangle of the one renderer (a turntable stage from the title, the paused world from pause, with an obstacle-aware arc).
- `poses.html` / `src/poses.ts`: a separate Vite page, the pose gallery (`?set=`, `?yaw=`, colors). `tools/model/clearance.ts` measures poles through the body and the jacket.
- **Config:** `camera`, `render` (lean, tuck, brake, blend times), `locker`. Pose numbers and body proportions are in code.
- **Fragile:** `air.comHeight` / `headHeight` assume the rig's proportions. `snowFx.ts` duplicates the brake-swing formula. `SKI_POINTS` is ±0.7 m for every ski. The skier isn't lit by night pools. The title stage rig never gets `setGlow`. `ChaseCamera.spot()` allocates twice a frame. Up to three rigs exist (game, Locker stage, gallery).
- **User decision:** the tuck's poles go in the crook of the arm or under the arm; the user reverted an attempt to change it.

## UI and core (`src/ui/`, `src/core/`)
- `ui/menus.ts`: the screen stack and **all** menu key routing (a capture-phase `keydown` on `window`). Order: rebind trap → tuning-panel keys ignored → no menu open goes to `onGameKey` (in main.ts) → the screen's `onKey` → Esc / Tab / Enter / arrows. It also has `prewarm`, `setHole` (Locker window) and the helpers `board` and `plank`.
- Screens: `mainMenus.ts` (title, pause with the Weather plank), `mapSelect.ts` + `weatherPicker.ts`, `settingsMenu.ts` (quality, volume, score switch, crash setting, two key slots per action), `controlsMenu.ts`, `cheatsMenu.ts`, `lockerMenu.ts`, `trailMap.ts` (its own overlay, not on the stack).
- HUD: `scoreHud.ts` (also submits bests and fires combo sounds through callbacks), `scoreText.ts`, `runHud.ts`, `raceHud.ts`, `hints.ts`, `toast.ts`, `fade.ts`, `fps.ts` (always shown), `embed.ts` (Open in new tab, and Fullscreen only if `fullscreenEnabled`).
- `tuningPanel.ts`: lil-gui, a dynamic import (its own chunk), opened from Cheats in every build and folded open in dev. It edits CONFIG in place.
- `core/input.ts`: `ACTIONS`, `GRAB_ACTIONS`, `DEFAULT_BINDINGS` (by `KeyboardEvent.code`), and `Keyboard` (a bubble-phase listener, disabled while any menu is open). `core/settings.ts`: load and save, `assignKey`, the quality helpers. `core/storage.ts`: try/catch wrappers.
- **Storage keys** (`parkLaps.` prefix): `settings.v1`, `outfit.v1`, `bests.v1`, `weather.v1`, `map`, and the legacy `quality` (read once). **URL overrides:** `?map=`, `?quality=`, `?weather=`.
- **Fragile**
  - `Keyboard` ignores modifiers, so Ctrl+R is swallowed and respawns while riding.
  - `onGameKey` must `stopPropagation` on trail-map close, or the bubble-phase `Keyboard` reopens it.
  - `embed.ts` buttons keep focus after a click, so Enter toggles fullscreen instead of Back to top.
  - `loadMap` has no in-flight guard. A failed load after `level = null` leaves no level.
  - A saved bindings set with a conflict resets every key to its default.
  - The trail map has no focus trap. The window-button row may overflow a narrow embed.
  - The tuning panel's quality dropdown is captured at mount, and it saves.
  - Esc is hard-wired and never bindable.

## Audio (`src/audio/`)
- `engine.ts`: one AudioContext, made on the first key, click or touch (a capture listener registered before `Menus`). Buses: game and ui into sfx into master. The game bus fades while the game waits. `visibilitychange` suspends. One-shots are capped (`maxOneShots`); continuous `Voice`s update only past an epsilon.
- `synth.ts`: every sound is a recipe rendered once by `OfflineAudioContext` with a seeded RNG: 16 one-shots and 5 loops, done sequentially on the main thread at the first gesture.
- `riding.ts`: diffs sim steps (pop, landing, rail, pole, bail) and sets the carve, brake, slide, wind and rail voices each frame. `ambience.ts`: weather bed and howl (following `SnowFx.gust()`), crowd, town and lift places, cheers and jeers. `index.ts` (`GameAudio`) wires these and the menu click and tick. `wav.ts` is dev-only WAV export (`parkLaps.audio.renderWavs()`, written through `tools/vite/wavSink.js`).
- **Config:** `audio.*`. Many filter, Q and glide numbers and every recipe constant are hard-coded in the audio files.
- **Fragile:** the first gesture renders 21 recipes on the main thread (a likely hitch on a Celeron). Audio reads render state (`snow.gust()`, `inPowder`). Pan uses the previous frame's camera. Sounds during steps before the context runs are dropped. Levels were set from WAV measurements, not by ear.

## App glue (`src/main.ts`, 889 lines)
- The composition root. Startup order: settings → outfit and ski scale → quality and weather (URL first) → `createView` (fatal message on failure) → context-loss handler → HUD, `GameAudio`, `ScoreHud`, `Keyboard` → `Menus` and every screen → dev hooks → `openTitle` → `?map=` → `startLoop`.
- `loadMap`: dispose the old world → `buildMap` → `WorldView` → run and race → `sound.setMap` → re-point `SkierView` and `ChaseCamera` (made once) at the new `hf` → weather → `warm` and shader compile behind "Loading" → close the menus.
- **Dev hooks** (`import.meta.env.DEV` only): `window.parkLaps` has `skier`, `teleport(x, z, heading, speed)`, `lookFrom`, `heightAt`, `loadMap`, `setQuality`, `setWeather`, `setCheat`, `snowFx`, `audio`, and more.
- **Fragile:** top-level `let`/`const` read by later closures (`level`, `tuningPanel`, `NO_RAILS`). Moving code upward causes temporal-dead-zone errors. `loadMap` mixes sim, render, audio, storage and UI.

## Tools (`tools/`; run from the repo root with `node tools/<dir>/<file>.ts`, needs Node ≥ 22.18 for type stripping)
- **Not type-checked:** `tsconfig` includes only `src` and `vite.config.ts`, so `npm run build` never checks `tools/`. Drift shows up only at runtime.
- `sim/harness.ts`: `loadMap(file)` runs the real `parseMap` + `buildMap`. `Rider` steps the real `stepSkier`, `updateRun` and `stepRace` with scripted keys. `--ski park|big|carving` works on every tool. `jumpLayout` duplicates `maps/shapes.ts` geometry by hand.
- Checkers (stdout only):
  - `line.ts <map> <x> <fromD> <toD> [stand|tuck] [pop|nopop] [720] [steer] …`: rides Park-style lines.
  - `face.ts <map> [runs] | --fall N`: Freeride runs and fall lines.
  - `course.ts`: slalom courses.
  - `features.ts <map> [kinds]`: every jump, kicker, quarter or jib, ending with a problem count.
  - `jumps.ts`, `kickers.ts`, `butter.ts`, `spin720.ts`.
  - `score.ts`: the scoring check; its rail and butter parts assume Park coordinates.
- Map tools: the five generators (write `src/maps/<id>.json`), `sinks.ts <map>` (holes a rider can't leave; expect 0), `overview.ts <map> <png> [m/px] [box]` (top-down PNG).
- Model: `model/clearance.ts` (poses vs body), `model/skis.ts [png]` (triangle counts, graphics sheet).

## Build and deploy
- `npm run build` = `tsc && vite build`. Vite 8 (rolldown), Three 0.186.1 (not r160, which the skills are written against), TypeScript 6. Entries: `index.html` and `poses.html`. `base: './'`. Lazy chunks: each map, the tuning panel, and dev-only `wav.ts`.
- `.github/workflows/deploy.yml` builds twice on push to `main`: GitHub Pages, and Firebase (`parklaps-3b60f`, secret `FIREBASE_SERVICE_ACCOUNT_PARKLAPS_3B60F`). **Pushing deploys.** Players use https://parklaps.web.app.
- `public/embed-test.html`: sandboxed iframe by default, `?mode=plain` allows fullscreen. `.claude/launch.json`: `dev` 5173, `dev-alt` 5181, `preview` 4173.
- README's local URLs still say `/ski-game/`, which is stale since `base: './'`. `docs/` (milestone prompts) is untracked.

## Where to change X
| To change… | Look in |
|---|---|
| Riding, air or landing feel | `config.ts` (`skier`, `air`, `landing`), then `sim/skier.ts` |
| Rails | `config.rails`, `sim/rails.ts`, `sim/skier.ts` (`slideRail`, `catchRail`, `mountRail`) |
| Trick points and the combo HUD | `config.score`, `sim/score.ts`, `ui/scoreHud.ts`, `ui/scoreText.ts` |
| A pose or grab look | `render/skierPoses.ts`; check with `poses.html` and `tools/model/clearance.ts` |
| Keys and default bindings | `core/input.ts` (`DEFAULT_BINDINGS`) |
| Camera | `config.camera`, `render/chaseCamera.ts` |
| A map's layout | `tools/maps/<map>.ts`, then rerun it and `sinks.ts` / `line.ts` / `features.ts` |
| Quality and performance | `config.quality`, `render/autoQuality.ts`, `main.ts applyQuality`, `render/world.ts setQuality` |
| Weather or night look | `config.weather` / `lights` / `sun`, `render/weather.ts`, `render/lightPools.ts` |
| Snow spray and tracks | `config.snowFx`, `render/snowFx.ts` |
| Sounds | `config.audio`, `audio/synth.ts` (recipes), `audio/riding.ts`, `audio/ambience.ts` |
| Menus and HUD | `ui/menus.ts` + the screen's file, `src/style.css` |
| Cheats | `config.cheats`, `sim/tuning.ts`, `ui/cheatsMenu.ts` |
