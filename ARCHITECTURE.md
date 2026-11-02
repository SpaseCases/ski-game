# Architecture

A map of the code for finding things fast. `GAME_DESIGN.md` says what to build; `CLAUDE.md` gives the rules. This file says where things live and what breaks easily. Written 2026-10-29 at `4bbd1c9` (after milestone 8); updated for milestones 9 to 13. Line numbers rot, so prefer the function names.

## The big picture

```
maps/*.json ──registry (lazy import)──► parseMap ──► buildMap ──► BuiltMap { hf, course{rails,obstacles}, race, decor, starts, gaps }
                                                                   │                     │
                         sim (120 Hz, no Three.js scene) ◄─────────┘                     └──► WorldView (render)
                         SkierState ──(prev, cur, alpha)──► interpolateSkier ──► SkierView / ChaseCamera / SnowFx / audio
```

- **No event bus.** Scoring, snow effects and audio each diff `skierPrev` against `skier` themselves to find takeoffs, landings (`landTime` reset), crashes (`bailed` rising), pole plants or skating pushes (`poleTime` reset; snow effects watch it cross `polePlantTime`) and rail entry (`rail` going ≥ 0). Score events sit in a 16-slot ring that readers follow with their own cursor.
- **`TUNING`** (`sim/tuning.ts`) is what the sim reads: CONFIG × the ski's multipliers (`setSkiScale`) × cheats, rebuilt only on change. It covers the `sim`, `skier`, `air`, `landing`, `rails`, `bail`, `slalom` and `giantSlalom` blocks. `score` and `checkpoints` read CONFIG directly, so cheats and skis don't touch them.
- **Invariant used at every milestone:** with every cheat off and the park ski, every `tools/sim` output stays byte-identical unless a change means to alter physics. A/B with `git stash push -- src tools`.

### One frame (`main.ts`, `startLoop` callbacks)
- **Loop** (`core/loop.ts`): rAF re-arms first. Frame time is clamped to `sim.maxFrameTime` (0.25 s, so up to 30 catch-up steps), times `TUNING.sim.timeScale` (Slow motion). Nothing accumulates while `gameWaits()` (no level, a menu or trail map open, or graphics lost). Input edges latch until `sample`.
- **Step:** `keyboard.sample` → trail-map key → R (tap respawns; holding freezes the sim, then `backToTop` after `checkpoints.holdToTop`) → confirm at finish → checkpoint key → `copySkierState(prev, skier)` → `stepSkier` → `sound.step` → `updateRun` → `stepScore` (if scoring) → `stepRace` (it can knock the skier's velocity *after* score and sound saw the step) → toasts → crash fade (unless `crashWait`).
- **Render:** `interpolateSkier` → `skierView.update` → orbit drag → `chase.update` → `world.view` (terrain streaming, culling) → `world.update` → `snow.update` (gets `skierView.skateSide`) → `lights.update` → `sound.frame` → `renderFrame` (backdrop pass, clear depth, world pass), or `drawLocker` while the Locker is open → HUD → `auto.frame` → `tuningPanel.update`.

## Sim (`src/sim/`)
| File | Owns |
|---|---|
| `skier.ts` | `SkierState` and `stepSkier`. Phases are flags, not an enum: `bailed`, then `rail >= 0` (where `grounded` is also true), then `grounded` (snow), else air. Calls `stepBail`, `slideRail`, `rideSnow` / `fly` (forces), then `moveOnSnow` / `moveInAir` (move, collide, transition), `takeOff`, `land` (landing and bail check), `crash`, `catchRail` (from the air) / `mountRail` (from the snow), plus pops, butters and grabs |
| `terrain.ts` | `sampleSurface` / `groundAt`: bicubic Catmull-Rom on the grid **plus** `topShape` (exact analytic ramps, pipes and decks from `maps/shapes.ts`) |
| `rails.ts` | `buildRailShapes` (polylines into typed arrays), `railUnder` (snap), `railFrame`, `collideRails` |
| `obstacles.ts` | Capsules (trees, rocks, fences, walls) in an 8 m grid; `collideObstacles` and `insideObstacle`. Fences stand only as high as they look (`follow`, `rise`) |
| `bounds.ts` | `keepInside`: map rectangle plus the optional polygon |
| `powder.ts` | `inPowder`: off a map's runs and groomed patches (Freeride). `Course.powder` carries it; `land` uses it for `landing.powderImpact`, and `snowFx` for spray and the carve sound |
| `checkpoints.ts` | `RunState`: flags, personal checkpoint, `respawnSkier`, finish zones |
| `race.ts` | Slalom courses: wand start, gate pass or miss, the finish, and spring-damper bending gates that `knock` the skier |
| `score.ts` | A pure observer: rotation from the `trick` quaternion delta in body axes, kept per axis as `Runs` each way (a reversal past `reverseMin` closes a run; each run counts its own whole steps, grace only on the last), combos and multipliers. `endGaps` scores gaps after `endAir`. `sketchyLanding` is shared with audio |
| `gaps.ts` | `buildGaps` (per map, in `BuiltMap.gaps`): each open gap jump's takeoff and landing areas ("Gap"), the map's named `gaps`, and fence segments from `fence` decor. Scoring reads it only at takeoff and landing (`clearsZone`, `crossesFence`) |

**Config:** `skier`, `air`, `landing` (`caseTrickMax`, `casePitchMax`, `powderImpact` since M9), `rails`, `bail`, `slalom`, `giantSlalom`, `score`, `checkpoints`, `sim`, `cheats`, `skis`.

**Fragile**
- Adding a `SkierState` field means editing `createSkierState`, `copySkierState` and `interpolateSkier` (`render/skierView.ts`) together. Nothing catches a miss. (`interpolateSkier` copies only what rendering reads; `landPowder` and `trickTurn` are sim-only.)
- **Pop vs ↑ (M9):** the sim crouches and pops on `input.pop` and front-flips on `input.up`, except while a pop is still possible with `pop` held. "Pop with: ↑" is `mirrorPop` (`core/input.ts`) copying `up` into `pop` after each sample, in `Keyboard.sample` and in the harness (`Rider.popWithUp`, default true), which is what keeps every tool byte-identical. Anything new that reads ↑ on the snow must read `pop` instead.
- **Case landings (M9):** `land` allows `casePitchMax` while `trickTurn` (rotation summed over the air, reset in `takeOff`) is under `caseTrickMax`. Not the `trick` quaternion's angle: a full flip returns it to identity. `sketchyLanding` uses the powder impact limit when `landPowder`.
- `yaw` is frozen at its takeoff value in the air; `land` re-derives it from the body. `interpolateSkier` special-cases this (the switch-landing snap was fixed there), and `race.ts placeBody`, the headlamp and the camera all see the stale yaw mid-air.
- Module-level scratch vectors are shared between functions: `land` / `crash` read the `contactNormal` that `moveInAir` just set, and `railSpot` writes `head` and `railDir`. Reordering calls breaks things silently.
- `air.wallAngle` (44°) decides what counts as a wall. That covers pops, air leveling and how every pipe, gully and lip is authored. Takeoff faces are exempt, and a pop off a lip steeper than 44° goes straight up.
- Landing limits (`landing.*`, scaled per ski) also set "sketchy" in scoring and whether the crowd cheers. Changing a limit changes scores and audio too.
- **Scoring reads rotation in runs (M10).** `spinRuns` and the flip loop in `endAir` iterate closed runs then the one going, and leave the degrees counted in the module-level `counted` (read right after the call; `butterName` relies on it too). A closed run gets no `spinShort`/`flipShort` grace, so a reversal only counts when the first run turned a full step. Which axis names a trick is decided by `runPath` (every run's size summed), not the net angle.
- **Gaps (M10)** are built from map data in `sim/gaps.ts`: open gaps from `JumpFeature` geometry duplicated from `maps/shapes.ts` (`lip`, `knuckle`, the landing's end, +60 m `LANDING_PAST`), fences only from `fence` line decor (not netting or barriers), and the takeoff point is `prev.position` at `beginAir`. Jam Park's Cat gap polygons come from `tools/maps/jampark.ts OVER`, so moving that jump means rerunning the generator. Numbers outside config: `TAKEOFF_BEFORE`, `TAKEOFF_PAST`, `LANDING_PAST`, `MAX_RUNS`.
- `race.ts` reads `CONFIG.render`'s lean numbers and hard-codes body heights to place the gate-hit body. Render tuning changes gameplay here, and it can drift from what `skierView` draws.
- `slideRail` skips `keepInside`, `bump` and obstacles. `CHEATS.noCrashes` is checked in four places in `skier.ts`. The obstacle grid bakes `rails.bodyRadius` at build time, so a tuning-panel change to it doesn't apply.
- Linear scans every step: all rails (with a bounding-box cull), all gates in `bendSides`, and `pipeAt` / `quarterInward` over all shapes (long on Freeride's town).
- Numbers outside config: `CREASE_COS`/`CREASE_LEAVE`, the bail stick of 0.25, `LOG_RADIUS`/`TUBE_RADIUS`, the obstacle `CELL`/`SINK`, bounds margins, and score `SIDEWAYS`.
- The sim imports Three.js `Vector3` and `Quaternion` (math only, which is allowed).

## Maps (`src/maps/`, generators in `tools/maps/`)
- **Pipeline:** `registry.ts` (`MapId` union + `MAPS`, one lazy chunk per JSON) → `loader.ts parseMap` (hand-written validation and defaults; **unknown keys are dropped silently**, and nothing is fetched here) → `build.ts buildMap`: `generateTerrain` → `startFrames` → `setShapes` (ramps, pipes, starts, town) → `buildRailShapes` (after the shapes, so rails sit on them) → `layoutDecor` → `buildObstacles` → `buildRace`.
- **Terrain is a recipe, never stored heights.** `generated` (`terrain.ts`: a pitch profile, lanes solved to end level, berms, hills) or `peak` (`peak.ts`: spokes from a summit, Hermite-blended, then ordered `elements` such as ridge, gully, cliffs, lip, bowl, pillows, bumps, dip and flat, plus a rim at the bounds). A `heightfield` type is planned for M19 (Brundage, on hold).
- **Shapes** (`shapes.ts`) are exact Hermite profiles on top of the grid in 32 m cells. The highest one wins. Cliffs are terrain elements; booters are `kicker`/`jump` with `natural: true`.
- `types.ts` holds the whole format (`MapDef`, `Feature` union, `TerrainDef`, `GapDef` for named scoring gaps). `decor.ts` does scatter and thinning (`thinDecor` per preset). `town.ts` builds buildings and terraces; `startGates.ts` builds the deck, tower, ridge and race house.

| Map | Generator | Notes |
|---|---|---|
| park | `park.ts` | 280×2150, 121 features, 2 pipes, the 1,948 m rail |
| jampark | `jampark.ts` (began as a copy of park.ts) | 300×2030, 203 features, quarters and wallrides, the Cat gap (`gaps`); on trial beside the Park |
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
- `skierRig.ts`: `SkierRig`, a group of per-segment merged meshes (one Lambert vertex-color material, 16 draw calls; 17 with the Santa hat, the beanie's pom or the pumpkin's face; 14 with the poles off, which just hides them). `apply(PoseDef)` places the core, then runs two-bone IK. A grabbed ski is pulled to the hand. `setOutfit` rebuilds only the parts that changed; `setGlow` lights the pumpkin face. `JacketLower` is rebuilt every frame and is the rig's main CPU cost.
  - **Headwear (M11):** `buildHead` switches on it. Beanie, cap, bucket hat and Santa hat replace the helmet: each a `hatDome` lifted onto an edge line that rests on the goggles (`helmetEdge`, `capEdge`, `bucketEdge`, `santaEdge`). The beanie and the Santa hat share `buildCuff` (a folded band round the dome, every other column standing out); the beanie's crown is ribbed the same way and slouches back. `buildStrap` goes over the beanie and the full-face, and under (a smaller radius, so it shows only below the edge) the cap, bucket hat and Santa hat. The full-face (`buildFullFace`) is built from parts: a lathe shell over the jaw cut to `fullFaceEdge`, all in the helmet color (shell, port trim, chin guard and visor), a lining turned inside out (`flipWinding`), a separate `curvedPanel` chin guard drawn out to a point, and a tilted visor. The hood goes over a vent-less, strap-less helmet: `buildFaceShell` rings that run from one side of an oval face opening round the back to the other (`HOOD_SHELL`), a lining and a rolled hem (`buildFaceRim`); it drops the rolled hood from `buildTorso`. The Santa hat's cone and the beanie's pom are the `hat` child mesh on `clothMaterial` (a `sway` attribute). The hats take the `helmet` color; the hood takes the jacket's.
  - **Patterns (M11):** `wear()` gives a garment's `Wear`; each part builder asks `cloth(wear, panel)` for a color or a per-face function (the `Panel` says where that part has stripes or blocks, and its `Grid` of faces). Plaid colors whole faces by their column and row in that grid (`plaidCell`), so both triangles of a face match and every band is one face wide; it needs an even number of sides (`sidesFor` turns the 9-sided sleeves into 10) and rows of faces (`rows()`, about `PLAID_ROW` 0.095 m). The round joints (shoulders, elbows, knees) get the check by distance instead. Pants stripes turn the 12-sided legs by `SIDE_FACE` so a face looks straight out, and give each shin its own geometry (`setShins`). `JacketLower.build` colors its quads by column (its 18 segments line up with the upper jacket's 18 sides) and by rest height in the upper jacket's rows carried on down, so plaid runs on across the waist seam. Camo was tried and dropped at the user's request; a saved `camo` loads as plain.
  - **Budget:** `tools/model/budget.ts` counts draw calls and triangles for every headwear, pattern and ski. Default 6,642 triangles; worst (hood, plaid, big-mountain ski) 9,280, up from 9,016 before M11.
- `skierPoses.ts`: pose data. `GRABS` order must match `GRAB_ACTIONS` in `core/input.ts`; the sim's `grab` is that index. `poseBlend.ts`: STANCE + Σ w·(target − STANCE), with Euler blending.
- `skierView.ts`: `interpolateSkier` (the sim → render bridge) and `SkierView.update` (sim fields to pose weights, turn lean, pole stroke or, with the poles off, `skateStroke` and `skateArms` (the hands drop from the pole grip to hang loose, `skateArms` easing in and out across pushes, and swing a little against the pushing leg), landing squash, blob shadow, `sitOnDrawnSnow`). The skating push is keyed (`SKATE`, `SKATE_TIMES`) to the pole push's timing, so the sim is the same either way; the leg alternates each time `polePhase` drops, tracked here (`skateLeg`) and exposed as `skateSide` for the snow effects.
- `skiModel.ts` + `core/skis.ts` (ski data and the layer painter, shared with the Locker thumbnails through `ui/skiThumb.ts paintSkis`); `core/outfit.ts` (palette, `HEADWEAR`, `PATTERNS`, `GARMENTS` (each garment's pattern and second-color keys), `contrastColor`, `outfit.v1` with `poles`).
- **Custom skis (M12):** `core/customSkis.ts` owns `EDIT_PALETTE` (the 20 outfit colors plus 12 stock shades, 32 in all), the slots (`CUSTOM_SLOTS` = 3 per ski in `skis.ts CUSTOM`, null until first opened in the editor), `copyStock` (a stock graphic snapped to the palette, both skis' tops and bases; a pair unlinks the slot), and load/save of `customSkis.v1`. A slot's graphic is an ordinary pair `SkiGraphic` (id `custom-<ski>-<n>`, one sidewall color) with a `{ pixels: PixelArt }` layer for the top sheets and another in `baseLayers`; each `PixelArt` has `pair: true`, so a row holds the left ski's columns then the right's and `layerColor` maps v from -2 to 2. The slot's `linked` flag only tells the editor to paint both skis; the data always has both. The 3D ski, the rack and the editor's true-shape strip all go through the same painter. `skiGraphic()` finds custom ids after the stock ones, so `outfit.v1` stores them like any graphic. The editor mutates the slot's cells in place (same id), so `SkierRig.setOutfit` sees no change: it calls `repaintSkis()` (via main's `skisDirty`, at most once a frame, and once more when the editor closes). Budget: a custom ski paints one face per run of one color across a row, top and base, so a checkerboard top and base on the big-mountain ski is 6,244 triangles per ski (stock worst 1,640); park and carving 2,308 (stock worst 1,078). Same draw calls.
- `chaseCamera.ts`: heading blends from ski yaw to travel direction, distance and height scale with speed, plus `slopeLift` and the pipe heading. Drag-orbit comes from `core/pointerOrbit.ts` and eases back after `orbitReturnDelay`. The camera ignores obstacles.
- `lockerStage.ts`: the preview is drawn in a scissored rectangle of the one renderer (a turntable stage from the title, the paused world from pause, with an obstacle-aware arc).
- `poses.html` / `src/poses.ts`: a separate Vite page, the pose gallery (`?set=poling|skating|looks`, `?yaw=`, `?pitch=`, `?zoom=`, colors, `?headwear=`, `?jacketPattern=`/`?jacketAccent=` and the pants', `?poles=0`). `tools/model/clearance.ts` measures poles through the body and the jacket, then repeats every state with the poles off (plus skating pushes: how close the skis come) and in each headwear (head and hat points inside the body, against the helmet's count).
- **Config:** `camera`, `render` (lean, tuck, brake, blend times), `locker`. Pose numbers and body proportions are in code.
- **Fragile:** `air.comHeight` / `headHeight` assume the rig's proportions. `snowFx.ts` duplicates the brake-swing formula. The skating leg lives only in `SkierView` (the sim has no push count), so a second view of the same skier (the Locker stage) would pick legs on its own; the spray reads `skierView.skateSide` for that reason. Hats sit on the goggles through `helmetEdge`/`capEdge`/`bucketEdge`/`santaEdge`/`fullFaceEdge` and `GOGGLE_Y`/`goggleHalf`: moving the goggles moves every hat's edge. The hood's bottom sinks into the collar and shoulders when the head looks up (expected; clearance counts it). A new garment part must go through `cloth()` or it stays plain. A `LatheGeometry` profile must run bottom to top, or its faces look inward and only a lining behind them shows. Painting a face by its centroid splits quads into two colors wherever a boundary crosses them: put color boundaries on the mesh's own rows and columns. `SKI_POINTS` is ±0.7 m for every ski. The skier isn't lit by night pools. The title stage rig never gets `setGlow`. `ChaseCamera.spot()` allocates twice a frame. Up to three rigs exist (game, Locker stage, gallery).
- **User decision:** the tuck's poles go in the crook of the arm or under the arm; the user reverted an attempt to change it.

## UI and core (`src/ui/`, `src/core/`)
- `ui/menus.ts`: the screen stack and **all** menu key routing (a capture-phase `keydown` on `window`). Order: rebind trap → tuning-panel keys ignored → no menu open goes to `onGameKey` (in main.ts) → the screen's `onKey` → Esc / Tab / Enter / arrows. It also has `prewarm`, `setHole` (Locker window) and the helpers `board` and `plank`.
- Screens: `mainMenus.ts` (title with the board-name box, pause with the Weather plank; both have Leaderboards), `mapSelect.ts` + `weatherPicker.ts`, `settingsMenu.ts` (quality, volume, score switch, crash setting, Pop with, two key slots per action), `controlsMenu.ts` (tables follow Pop with; a plank opens the tester), `keyTester.ts` (a Chromebook-style keyboard drawing that lights held keys; its `onKey` swallows every key but Esc, and it listens for keyup on `window` only while shown), `cheatsMenu.ts`, `lockerMenu.ts` (Outfit: eight headwear tiles, a `paintRow` per color part, and under the jacket and pants five pattern tiles whose SVG swatches are redrawn in the garment's colors on every `sync`, then a second-color row hidden while plain; leaving plain sets the second color to `contrastColor`. Skis: under the rack, a row of three custom slots per ski (an empty one opens the editor; Edit beside each), then the Poles On/Off switch under the stats), `skiEditor.ts` (M12: pushed over the Locker by `LockerHooks.edit`; switches over the grid pick Left / Right ski (choosing one unlinks), Same on both (linking copies the shown ski onto the other) and Top / Base; the grid is a canvas of one ski's face with its rows along x, tail left, and its columns down, the left edge on top (the base seen through the ski, as in the rack); cursor, hover, brush (1 to 4 cells square) and mirror marks are drawn on it; `onKey` handles arrows, Space/Enter (held, it paints as the cursor moves; released on a `window` keyup), `[` `]`, 1 to 4, P, F, E, S, I, B (top or base), L, R, K, W (sidewalls), Z/Ctrl+Z; the mouse paints with pointer capture and a Bresenham line between cells; every stroke ends in `saveCustomSkis`; undo keeps 60 snapshots), `trailMap.ts` (its own overlay, not on the stack).
- HUD: `scoreHud.ts` (also submits bests and fires combo sounds through callbacks; keeps the combo's chain from the events it reads and lays it out in `fitChain`, which measures `scrollHeight` against the CSS three-line `max-height` once per trick, never per frame), `scoreText.ts` (`chainText`), `runHud.ts` (with `boardSlot` for the finish board), `raceHud.ts`, `hints.ts`, `toast.ts`, `fade.ts`, `fps.ts` (always shown), `embed.ts` (Open in new tab, and Fullscreen only if `fullscreenEnabled`).
- `tuningPanel.ts`: lil-gui, a dynamic import (its own chunk), opened from Cheats in every build and folded open in dev. It edits CONFIG in place.
- `core/input.ts`: `ACTIONS`, `GRAB_ACTIONS`, `DEFAULT_BINDINGS` (by `KeyboardEvent.code`; `pop` is Space; `board`, L, hides the finish board), `mirrorPop`, and `Keyboard` (a bubble-phase listener, disabled while any menu is open; `setPopWithUp`). `core/settings.ts`: load and save, `assignKey`, the quality helpers. `core/storage.ts`: try/catch wrappers.
- **Storage keys** (`parkLaps.` prefix): `settings.v1` (also the board `name`), `outfit.v1`, `bests.v1` (`<map>` and `<map>#cheats` entries; `submitCombo` re-reads it and keeps the higher of each before writing), `weather.v1`, `customSkis.v1` (per ski, three slots, each null or a string: the sidewalls' letter, `=` linked or `~`, the top sheets' run-length cells (`12A` = twelve of color 0), `/`, the bases'; an older form, the base letter then one ski's top, still loads; letters index `EDIT_PALETTE`, so **never reorder it**, only append), `map`, and the legacy `quality` (read once). The HUD's "Best with cheats" follows the "Cheats on" tag (`cheatsTag.hidden`), so it doesn't deep-compare CONFIG every frame. **URL overrides:** `?map=`, `?quality=`, `?weather=`, `?boards=test`.
- **Fragile**
  - `Keyboard` ignores modifiers, so Ctrl+R is swallowed and respawns while riding.
  - `onGameKey` must `stopPropagation` on trail-map close, or the bubble-phase `Keyboard` reopens it.
  - `Keyboard` ignores Enter and Space on a focused button or link, so every HUD button must `blur()` on click (`hudButton`, `embed.ts` and `runHud.ts` do), or Space pops nothing.
  - `loadMap` has no in-flight guard. A failed load after `level = null` leaves no level.
  - A saved bindings set with a conflict resets every key to its default.
  - The trail map has no focus trap. The window-button row may overflow a narrow embed.
  - The tuning panel's quality dropdown is captured at mount, and it saves.
  - Esc is hard-wired and never bindable.
  - The Locker preview draws for whichever screen called `showStage` (Locker or ski editor) through `stageScreen.viewRect()`. A new screen with a 3D window must go through `showStage` too, or the hole and the scenery go wrong.
  - Custom slot thumbnails are repainted only in `LockerScreen.enter` (`paintCustoms`), which runs again when the editor closes.

## Online leaderboards (`src/online/`, milestone 13)
The game's one online service: Firestore in project `parklaps-3b60f` (database `(default)`, nam5, Spark plan: 50k reads and 20k writes a day), reached with `fetch` over REST with no SDK and no auth, so `firestore.rules` is the only guard.
- **Lazy chunk:** `main.ts loadOnline()` imports `online/index.ts` (`createOnline`) the first time a board opens, a score posts or a finish shows a board. It brings `ui/leaderboardScreen.ts`, `ui/finishBoard.ts`, `ui/boardRows.ts` and `ui/leaderboards.css` (its own CSS chunk). A failed import shows a plain "Leaderboard offline" screen built in main (`offlineBoards`).
- `firestore.ts`: `runQuery`, `count` (runAggregationQuery), `getDoc` (batchGet, so a missing entry isn't a 404), `setDoc` (PATCH: a create or an update to the rules), an 8 s timeout. `boards.ts`: `BOARDS` (combo boards park, jampark, freeride, bigair and test; time boards slalom-sl and slalom-gs by course index), each with a `-cheats` twin. Entries live at `boards/<board>/names/<name in lower case>` with `name`, `look`, and `combo` or `ms`. `topEntries` (cached 20 s), `rankOf` (a count of the better entries, up to `RANK_LIMIT` 1000), `entryOf`, `searchNames` (a `__name__` range: names starting with the text), `post` (reads the entry first and writes only when better, so a refused write never logs a 403; skips scores the rules would refuse). `look.ts`: the 13-character look (palette letters, list digits) and the tiny SVG skier. `index.ts`: the posts made this visit, so the finish board can say what this run's post did.
- **Names:** `core/playerName.ts` is in the main chunk, so the title's box fetches nothing: `tidyName`, `nameProblem` (3 to 16 letters, digits, spaces, - and _; the word filter: ROT13 lists, SAFE exceptions, short words only at a word's start), `nameKey`. Saved as `settings.name`. The title's box (`mainMenus.ts`) saves while typing whenever the name passes; left with a problem, it goes back to the saved one.
- **Posting** (never per frame): a banked combo that `submitCombo` calls a best or a cheats best (the `ScoreHud` callback), and `stepRace`'s `finish` with no missed gates (`raceCheats`: cheats on at any moment of the timed run). Nothing posts without a name.
- **Looks** (`looks.ts`, `ui/lookPrompt.ts`): `looks/<name in lower case>` (`testLooks` with `?boards=test`) holds `name`, `outfit` (outfit.v1's JSON) and `skis` (customSkis.v1's JSON, from `customSkisText`). Anyone can read or replace one; no list or delete; the rules cap outfit at 2,000 and skis at 50,000 characters (nine checkerboard slots are about 30,000). In main: `nameChosen` (the title's `nameDone`, on Enter or leaving the box) fetches the new name's look and pushes the prompt (only while the title is on top), or saves this computer's look if none is there; `lookName` (the name already set at startup counts) stops it asking twice. *Load it* runs `setCustomSkisText` (skis first, so the outfit can wear a custom graphic), `setOutfit(outfitFrom(...))`, then a repaint; both save on this computer as they apply. `saveLookOnline` runs when the Locker area closes (`showStage(null)`, then a microtask so the ski editor opening over the Locker doesn't count) and only when `lookText()` differs from `lookSaved`; a failed save clears `lookSaved` so the next close retries.
- **Where:** the Leaderboards screen from the title, pause (the current map; on the Slalom the last course) and map select (a button by Back: the card focused last). The finish board sits in `RunHud.boardSlot`, opened by the frame when `run.finished` turns true (`finishSeen`), hidden by the `board` action (L) or its ✕ (`boardHidden`, reset at each finish). `?boards=test` uses `testBoards`; the dev hook `parkLaps.postScore(map, course, cheats, value)` posts as the game would.
- **Fragile**
  - **Chunk splitting:** nothing in `src/online/` (or the UI it imports) may import a module the pose gallery also uses (`core/outfit.ts`, `core/skis.ts`, `config.ts`, `core/storage.ts`...). The bundler then moves those into a new shared chunk that the first load fetches. That's why main passes `lookTables` and the outfit through `OnlineHooks`. Check a build's chunk list and the first-load requests.
  - The rules repeat what the code checks: the name format (`playerName.ts`), the board ids (`BOARDS`), the ranges (`COMBO_MAX`, `MS_MIN`, `MS_MAX`), the look's characters, and the list limit (`RANK_LIMIT`; a query with no limit or over 1000 is refused). A new map with a board, or a new Slalom course, means editing both and redeploying the rules by hand.
  - Slalom boards go by course **index** (0 the slalom, 1 the giant slalom): reordering `slalom.json`'s courses swaps the boards.
  - The look is positional: append parts only, and never reorder `PALETTE`, `HEADWEAR`, `PATTERNS` or `SKI_TYPES` (old entries would draw wrong, not break).
  - The word filter runs only in the game: a hand-made request can post any name that fits the format. Remove one in the Firebase console.
  - The personal best that triggers a post is this computer's (`bests.v1`), not the name's: a new name posts only scores that beat this computer's best.
  - Entries can't be deleted through the rules (test ones included); use the console.
  - A look stores the game's own local formats as text: a change to `outfit.v1` or `customSkis.v1` (or `EDIT_PALETTE`'s order) changes what old online looks load as. `outfitFrom` and `setCustomSkisText` ignore what they can't read; a custom slot that can't be read goes back to never opened.
  - Looks are open: anyone who types a name can replace its look, custom skis included.

## Audio (`src/audio/`)
- `engine.ts`: one AudioContext, made on the first key, click or touch (a capture listener registered before `Menus`). Buses: game and ui into sfx into master. The game bus fades while the game waits. `visibilitychange` suspends. One-shots are capped (`maxOneShots`); continuous `Voice`s update only past an epsilon.
- `synth.ts`: every sound is a recipe rendered once by `OfflineAudioContext` with a seeded RNG: 17 one-shots and 5 loops, done sequentially on the main thread at the first gesture. `skate` (M11) is the poles-off push. `bail` (M11) is a bone-crack click, a breathy "sh—" cut off at 0.2 s by a 1 kHz censor bleep to 0.6 s, and the slide fading; `BLEEP` holds its timing and levels against the crack, which `renderShot` normalizes, so the crack sets the loudness (shot gain 0.55: about -6 dBFS, like a soft landing) and the bleep's sine renders at -22 dBFS.
- `riding.ts`: diffs sim steps (pop, landing, rail, pole or skate (`poles`, set through `GameAudio.setPoles` from the outfit), bail) and sets the carve, brake, slide, wind and rail voices each frame. `ambience.ts`: weather bed and howl (following `SnowFx.gust()`), crowd, town and lift places, cheers and jeers. `index.ts` (`GameAudio`) wires these and the menu click and tick. `wav.ts` is dev-only WAV export (`parkLaps.audio.renderWavs()`, written through `tools/vite/wavSink.js`).
- **Config:** `audio.*`. Many filter, Q and glide numbers and every recipe constant are hard-coded in the audio files.
- **Fragile:** the first gesture renders 22 recipes on the main thread (a likely hitch on a Celeron). Changing any part of the `bail` recipe louder than the crack changes what normalization scales to, and so the bleep's level: re-measure the WAV (the bleep's 1 kHz component, not the window's peak, since the slide sits under it). Audio reads render state (`snow.gust()`, `inPowder`). Pan uses the previous frame's camera. Sounds during steps before the context runs are dropped. Levels were set from WAV measurements, not by ear.

## App glue (`src/main.ts`, 889 lines)
- The composition root. Startup order: settings → outfit and ski scale → quality and weather (URL first) → `createView` (fatal message on failure) → context-loss handler → HUD, `GameAudio`, `ScoreHud`, `Keyboard` → `Menus` and every screen → dev hooks → `openTitle` → `?map=` → `startLoop`.
- `loadMap`: dispose the old world → `buildMap` → `WorldView` → run and race → `sound.setMap` → re-point `SkierView` and `ChaseCamera` (made once) at the new `hf` → weather → `warm` and shader compile behind "Loading" → close the menus.
- **Dev hooks** (`import.meta.env.DEV` only): `window.parkLaps` has `skier`, `teleport(x, z, heading, speed)`, `lookFrom`, `heightAt`, `loadMap`, `setQuality`, `setWeather`, `setCheat`, `snowFx`, `audio`, and more.
- **Fragile:** top-level `let`/`const` read by later closures (`level`, `tuningPanel`, `NO_RAILS`). Moving code upward causes temporal-dead-zone errors. `loadMap` mixes sim, render, audio, storage and UI.

## Tools (`tools/`; run from the repo root with `node tools/<dir>/<file>.ts`, needs Node ≥ 22.18 for type stripping)
- **Not type-checked:** `tsconfig` includes only `src` and `vite.config.ts`, so `npm run build` never checks `tools/`. Drift shows up only at runtime.
- `sim/harness.ts`: `loadMap(file)` runs the real `parseMap` + `buildMap`. `Rider` steps the real `stepSkier`, `updateRun` and `stepRace` with scripted keys. `--ski park|big|carving` works on every tool. `jumpLayout` duplicates `maps/shapes.ts` geometry by hand.
- Checkers (stdout only):
  - `flips.ts [map] [jump] [speed] [--tricks back,front,spin]`: the landing windows for letting go of a trick key (default the Park's jump 48 at 16 m/s); its front flip rides "Pop with: Space".
  - `line.ts <map> <x> <fromD> <toD> [stand|tuck] [pop|nopop] [720] [steer] …`: rides Park-style lines.
  - `face.ts <map> [runs] | --fall N`: Freeride runs and fall lines.
  - `course.ts`: slalom courses.
  - `features.ts <map> [kinds]`: every jump, kicker, quarter or jib, ending with a problem count.
  - `jumps.ts`, `kickers.ts`, `butter.ts`, `spin720.ts`.
  - `score.ts`: the scoring check; its rail and butter parts assume Park coordinates. On the Park it also rides milestone 10's rotation cases off jump 75 (turning cheats on and off with `setCheat`) and loads Jam Park for the gap cases (feature indices found by geometry: the open gaps on x = -20, the jump inside the Cat gap's polygon, the tube at x = -64, the fence at x = -42).
- Map tools: the five generators (write `src/maps/<id>.json`), `sinks.ts <map>` (holes a rider can't leave; expect 0), `overview.ts <map> <png> [m/px] [box]` (top-down PNG).
- Model: `model/clearance.ts` (poses vs body; poles off and skating; each headwear), `model/budget.ts` (the skier's draw calls and triangles for every headwear, pattern and ski, and the worst combination), `model/skis.ts [png]` (triangle counts, graphics sheet).

## Build and deploy
- `npm run build` = `tsc && vite build`. Vite 8 (rolldown), Three 0.186.1 (not r160, which the skills are written against), TypeScript 6. Entries: `index.html` and `poses.html`. `base: './'`. Lazy chunks: each map, the tuning panel, the online leaderboards (`online`, JS and CSS), and dev-only `wav.ts`. The first load fetches exactly the page, `main` and `skierView` (JS and CSS).
- `.github/workflows/deploy.yml` builds twice on push to `main`: GitHub Pages, and Firebase (`parklaps-3b60f`, secret `FIREBASE_SERVICE_ACCOUNT_PARKLAPS_3B60F`). **Pushing deploys.** Players use https://parklaps.web.app. The workflow deploys hosting only; `firestore.rules` (named in `firebase.json`) goes up by hand with `firebase deploy --only firestore:rules`. On this PC the CLI runs from the npx cache: `node %LOCALAPPDATA%/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib/bin/firebase.js`.
- `public/embed-test.html`: sandboxed iframe by default, `?mode=plain` allows fullscreen. `.claude/launch.json`: `dev` 5173, `dev-alt` 5181, `preview` 4173.
- README's local URLs still say `/ski-game/`, which is stale since `base: './'`. `docs/` (milestone prompts) is untracked.

## Where to change X
| To change… | Look in |
|---|---|
| Riding, air or landing feel | `config.ts` (`skier`, `air`, `landing`), then `sim/skier.ts` |
| Rails | `config.rails`, `sim/rails.ts`, `sim/skier.ts` (`slideRail`, `catchRail`, `mountRail`) |
| Trick points and the combo HUD | `config.score`, `sim/score.ts`, `ui/scoreHud.ts`, `ui/scoreText.ts` |
| A pose or grab look | `render/skierPoses.ts`; check with `poses.html` and `tools/model/clearance.ts` |
| Custom ski graphics and the pixel editor | `core/customSkis.ts` (palette, slots, storage), `ui/skiEditor.ts`, the `pixels` case in `core/skis.ts layerColor` |
| Headwear, patterns, the skating push | `render/skierRig.ts` (`buildHead`, `cloth`), `render/skierView.ts` (`skateStroke`, `SKATE`), `core/outfit.ts`; check with `poses.html?set=looks` / `?set=skating`, `clearance.ts`, `budget.ts` |
| Keys and default bindings | `core/input.ts` (`DEFAULT_BINDINGS`) |
| Camera | `config.camera`, `render/chaseCamera.ts` |
| A map's layout | `tools/maps/<map>.ts`, then rerun it and `sinks.ts` / `line.ts` / `features.ts` |
| Quality and performance | `config.quality`, `render/autoQuality.ts`, `main.ts applyQuality`, `render/world.ts setQuality` |
| Weather or night look | `config.weather` / `lights` / `sun`, `render/weather.ts`, `render/lightPools.ts` |
| Snow spray and tracks | `config.snowFx`, `render/snowFx.ts` |
| Sounds | `config.audio`, `audio/synth.ts` (recipes), `audio/riding.ts`, `audio/ambience.ts` |
| Menus and HUD | `ui/menus.ts` + the screen's file, `src/style.css` |
| Cheats | `config.cheats`, `sim/tuning.ts`, `ui/cheatsMenu.ts` |
| Online leaderboards | `src/online/`, `ui/leaderboardScreen.ts`, `ui/finishBoard.ts`, `ui/leaderboards.css`, `firestore.rules` (redeploy by hand), the name in `core/playerName.ts` |
