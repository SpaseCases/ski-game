# Park Laps: Game Design

A small, physics-driven 3D freeski game that runs in Chrome on school Chromebooks. The feel is modeled on Shredsauce: momentum, crouch-to-pop, and rotations built from separate spin and flip axes, so corks come from combining them. **There is no scoring in v1.** The point is riding and landing clean.

## Core feel
- Speed comes from the slope and from pole pushes. Crouching lowers drag.
- Landing angle matters. Skis must roughly match the slope and the body must be upright. Land clean and you ride away; land badly and you bail.
- Simple but not arcade: no auto-rotation and no auto-landing. A small landing tolerance (set in config) keeps it learnable.
- Skis only. Riding switch (backwards) is supported, and the camera follows the direction of travel.
- Spin speed at takeoff inherits from how hard you're carving into the lip, plus any held spin input.

## Controls (default keys, all rebindable in Settings)
The right hand works the arrow keys. The left hand handles grabs, pole push, and checkpoints.

| Key | On the ground | In the air | On a rail |
|---|---|---|---|
| ← / → | Turn | Spin left / right | Rotate skis (free, any angle) |
| ↑ hold, then release | Crouch (less drag), then pop | Front flip | Crouch, then pop off |
| ↓ | Brake | Back flip | — |
| Shift | Pole push | — | — |
| Q / E | — | Lincoln loop left / right | — |
| Tab | Set personal checkpoint | — | — |
| R | Respawn at last checkpoint (hold 1s: back to top) | same | same |
| M | Trail map (the game waits; M or Esc closes it) | same | same |
| Esc | Pause menu | same | same |

Grabs (hold in the air, release to let go):

| Key | Grab | Key | Grab |
|---|---|---|---|
| A | Left mute | Z | Right mute |
| S | Left safety | X | Right safety |
| D | Left japan | C | Right japan |
| F | Left tail | V | Right tail |

- Holding a spin key and a flip key together tilts the rotation axis. That produces corks and misty flips.
- Rotation continues while a key is held and slows after release. Letting go early is how you time the landing.
- Grabs are poses: the hand reaches for that part of the ski. A grab can be held through rotations.
- Test multi-key combos (two arrows + grab + Shift) on a real Chromebook keyboard. If a combo drops keys, change the default binding.

## Crashes
- **Bail triggers:** landing with the skis too far off the slope angle, landing on your back or head, or hitting an obstacle hard.
- **On a bail:** the skier tumbles and slides to a stop. This is a cheap procedural tumble driven by the sim, not a full ragdoll. After about 1.5s the screen fades and you respawn at your most recent checkpoint. Pressing R skips the wait.
- A full ragdoll using Rapier is a possible later upgrade.

## Rails and boxes
- **Physics feel with a light magnet.** If the skis come down onto a rail or box within a small snap distance (set in config), the skier locks onto the rail's line and slides along it, with friction slowing them.
- There is no grind button. You get on by landing on the rail.
- You land on with the skis roughly straight (parallel) or sideways (perpendicular), and that angle carries over. On the rail ←/→ rotate the skis freely; they stay at whatever angle you leave them.
- You leave by riding off the end or by popping off with ↑. Spinning off is allowed.
- Too far off-angle or off-center and you slip off. That's not a bail unless you then land badly.
- v1 features: flat box, flat rail, down rail, flat-down rail. Rails are defined as polylines in the map JSON.

## Checkpoints and runs
- Each map has flags. Riding past a flag saves it.
- **Tab** sets a personal checkpoint at your current position, heading, and speed, so you can re-hit a jump with the same approach. It works only while on the ground.
- Respawning (R, or after a bail) goes to whichever checkpoint was set most recently, personal or flag.
- Holding R for 1s sends you back to the top.
- Every map has a finish zone at the bottom. Entering it shows an on-screen **Back to top** button (Enter also works). Back to top is also in the pause menu.

## Maps (v1: four maps plus the Test slope, all unlocked from the start)
Every map has a start gate themed to its kind of skiing, checkpoint flags, a finish zone, and enough decoration to feel like a real place. Decoration stays inside the performance budget: instanced and merged meshes, and the Low preset thins it out. No real brand names or logos anywhere. Every map is picked from the map-select menu.

1. **Park:** a big, dense terrain park, about 2 to 3 minutes top to bottom, with several lines side by side so you can pick a route, features packed close together, and flatter stretches between sections so speed stays under control. Steep enough everywhere that speed comes easily.
   - Jumps in every size, from small tables to a pro line of huge jumps. The biggest jumps clear a clean 720 (see Jump sizing).
   - Every jump has a rounded knuckle, and landing on it is rideable rather than an instant crash. Include step-ups, step-downs, and hips.
   - Rails and boxes of every kind: flat, down, flat-down, down-flat-down, kinked, and rainbow. Plenty are ride-on at snow level, and plenty are reached off a kicker (jumps onto rails and onto boxes).
   - A rail that runs the whole way from the top of the map to the bottom.
   - At least two halfpipes, a smaller one and a big one, each with a drop-in deck at the top.
   - Decoration: orange safety fencing along the lines, plain banners, a chairlift in the distance, light poles, a groomer parked to the side.
   - Start gate: a wooden start deck under a banner arch.
   - Flags: one at the start of each section.
2. **Freeride:** a grand mountain adventure. You start on the summit and can ride down in any direction, not along one line: about 2 to 3 minutes from the peak to the bottom whichever way you go, with far more variety than the Park.
   - Every face has its own character, for example steep chutes and cliff bands with drops of several heights; open bowls and pillow fields; tree runs; rolling terrain with natural side hits. Ridges between the faces carry wind lips and cornices, and a gully makes a natural halfpipe.
   - Natural features to ride: fallen trees as rails (slides that look like logs), rock and stump jibs, and booters (snow kickers with landings) dug into ridges, gully walls and banks. Some built jumps and rails too, but mostly natural ones.
   - A ski town at the base of one face, fully rideable: chalet roofs as drops and kickers, handrails down stairs, ledges and benches as rails and boxes, a main street, lamp posts and banners. Building walls are solid.
   - Runs end in the town or at a run-out at the base of each other face; each has a finish zone with Back to top, which returns to the summit (no lift ride: chairlifts climb the faces as scenery).
   - Scenery: rock outcrops and boulders, stands of trees (solid in the tree runs) thinning to a treeline, dead snags, wind-scoured ridges, trail signs at forks, and distant peaks around the map. Detailed enough to look good on a fast computer in clear weather (milestone 6b), while Low thins it out.
   - Start gate: a ridgetop start on the summit with a line of flags and a small start hut, like a freeride contest.
   - Flags: on ledges and shoulders across the mountain, at the top of each face's main lines, so a respawn puts you back on the line you were riding.
   - Built by a script like the Park (`tools/maps/`): the mountain's overall shape around the peak, terrain features placed on it (ridges, bowls, gullies, cliffs, chutes, pillows), then fine rocky detail.
3. **Slalom:** two timed courses side by side on a groomed run: a slalom with tight gates and a giant slalom with wider, faster turns. Each course has its own race start house and timing wand, its own gates, run timer, missed-gate count and finish line, and respawn returns you to that course's start house. This map alone has timed runs.
   - Slalom gates bend when you clip them. Giant slalom gates have a plain panel between their two poles.
   - Start gates: a race start house with a timing wand at the top of each course.
   - Decoration: blue course lines dyed in the snow, safety netting along both sides, a finish banner for each course.
4. **Big air:** several big jumps of different sizes and takeoff steepness, from long and mellow to steep and poppy, side by side at the bottom of the hill. Each has its own lane from a shared start. At least two of them clear a 720 (see Jump sizing).
   - Start gate: a scaffold drop-in tower, like a big air contest.
   - Decoration: spectator fencing beside the landings, flags, floodlights.
   - Flags: one at the top of each lane.
5. **Test slope:** the development map, kept as a playable map: every feature side by side in four lanes (halfpipe, jumps, rails and boxes, slalom) under all four start gates, for trying things out.

### Jump sizing
- Size the 720 jumps from the config: measure the airtime a clean 720 takes at the current spin rate, including winding up and slowing down, then give those jumps at least 20% more airtime than that at the speed the in-run naturally reaches.
- Every landing is long enough that riding in at full speed with a full pop still lands on the slope, not past it onto flat.
- Casing a knuckle at low speed is a rough landing, not a crash.

### Mechanics the maps need
- Done in 5a: the halfpipe (wall riding follows the surface normal; airs launch straight up and land back in the transition), ride-on rails and boxes at snow level, slalom gates with flex, the missed-gate check and the run timer.
- Done in 5b: terrain with varied pitch (the fall line as pitch sections, plus lanes: bands with their own fall line that start and end level with the slope beside them), rails that follow the snow, and the map-select menu.
- Done in 5c-1: terrain built around a peak that can be ridden down in any direction (spokes for each face and ridge, then ridges, gullies, cliff bands, wind lips and cornices, bowls, pillows and pillow lines, bumps, run-out dips and flat pads, with a rim of hills past the edge), a play area shaped as a polygon, several finish zones on one map, named runs, decoration placed by height and steepness, and the trail map. The snow is built in chunks around the camera, coarser in the distance, and decoration is culled in 2D tiles, with simple stand-in trees far away. Each quality preset sees its own distance: Low 240 m, Medium and Auto 450 m, High 800 m.
- Done in 5c-2: buildings and terraces as map features (roofs you ride, drifts up to them and landing drifts below, solid walls, stairs and handrails), rail and box looks (fallen logs, handrails, ledges, benches, rocks, stumps), booters with no dyed lip, finish arches on wide run-outs, trail signs, crags, moving chairlifts, swaying cloth, chimney smoke, town props, and a backdrop of sky and distant ranges past the far plane.
- Still to build: more than one timed course on a map, and giant slalom gates with panels.

Each map defines: name, heightfield (generated from parameters or loaded from a small grayscale PNG), features, spawn, start gate type, flags, finish zone, decoration sets, and sky and fog colors. Large maps split their terrain into chunks with frustum culling, so only what's inside the fog distance gets drawn.

## Look
- Low-poly and flat-shaded, close to Shredsauce's style but entirely original.
- Snow uses white and blue-gray vertex-colored faces. Features use wood and metal colors. Trees are instanced low-poly cones.
- The skier is a low-poly segmented body (helmet, torso, arms, legs) on a simple skeleton. Poses are procedural: stance, crouch, tuck, the 8 grabs, and the bail tumble. Skis and poles are separate meshes.
- **Outfit colors:** jacket, pants, and helmet, chosen from a palette in the menu and saved locally.
- Sky is a gradient, with matching fog per map.

## Camera
- Third-person chase from behind and above, smoothed. It pulls back as speed rises and swings around when you ride switch.
- It doesn't clip into terrain.
- In the air it keeps the horizon stable and does not spin with the skier.
- Click-and-drag with the mouse (or a finger) orbits the camera around the skier. Standing still, the view stays where you leave it; once riding, it eases back behind the skier a moment after you let go.

## Audio (sound effects only)
- Built with Web Audio, either procedurally (filtered noise) or from CC0 sound files.
- Snow carve hiss scaled by speed and edge angle; wind in the air scaled by speed.
- Pop, soft and hard landing thuds, rail scrape (separate sounds for metal rails and wood boxes), bail tumble, and UI clicks.
- Master and SFX volume sliders plus a mute toggle in Settings.

## Menus (HTML/CSS overlay, usable with keyboard or mouse)
- **Title:** Play, Outfit, Settings, Controls
- **Map select:** a card per map: Park, Freeride, Slalom, Big air, and the Test slope
- **Outfit:** color pickers with a live preview of the skier
- **Settings:** quality (Auto / Low / Medium / High), volume, key rebinding, reset to defaults
- **Controls:** the tables above
- **Pause (Esc):** Resume, Respawn, Back to top, Map select, Settings, Controls
- **HUD:** minimal and with no score. A brief "Checkpoint set" toast, the Back to top button at the finish, and "Open in new tab" when the game is embedded.
- **Trail map (M, or its HUD button):** a drawn map of the whole map, oriented like a piste map (the start's way down points down the page): shaded ground with rock, steep slopes and forests, the faces' names, every named run, flags (green once passed), finishes, the start, and you with your heading.

## Not in v1 (later ideas)
Scoring or trick names, butters and nose/tail presses, rail grabs, snowboard, ragdoll crashes, the full grab set, replays and photo mode, a level editor, gamepad support, music, multiplayer, riding a chairlift back up.

## Milestones
0. **Scaffold and deploy.** Vite + TypeScript + Three.js app showing a slope and a box, deployed to GitHub Pages by GitHub Actions, with `embed-test.html` working. Test on a school Chromebook at this point.
1. **Skiing.** Carving, braking, pole push, crouch and pop, terrain sampling, and the chase camera on a test slope. Include the dev tuning panel.
2. **Air.** Spins, flips, corks, Lincoln loops, the 8 grab poses, the landing check, bail, and respawn.
3. **Rails and boxes.**
4. **Checkpoints.** Flags, the personal checkpoint, respawn, hold-R to top, and the finish zone with its Back to top button.
5a. **Map features.** The halfpipe, knuckled jump shapes, ride-on rails and boxes, kicker-to-rail setups, slalom gates and the run timer, the four start gate types, and the decoration system with its density tied to the quality preset. Test each one on the test slope.
5b. **Map select and the Park.** A simple map-select menu (a card per map, keyboard or mouse; milestone 6 finishes the menus) with the Test slope as a card. Terrain with varied pitch. Then the Park map from the Maps section. Verify its 720 jumps by measuring airtime, and check its frame rate on the Low preset, fully decorated.
5c-1. **Freeride, part 1: the mountain.** Terrain built around a peak and ridable in every direction, each face with its own character (ridges, bowls, gullies, cliff bands, chutes, pillows, wind lips), the summit start, flags, a finish zone at the base of each face, trees and rocks placed by height and steepness, and headless checks that ride down every face. Check its frame rate on the Low preset, fully decorated.
5c-2. **Freeride, part 2: the town and natural features.** The rideable ski town, fallen-log rails, rock and stump jibs, booters, some built jumps and rails, trail signs, chairlifts and distant peaks as scenery. Check its frame rate on the Low preset, fully decorated, and that it looks good on High.
5d. **Slalom map.** Its two timed courses (more than one timed course on a map) and giant slalom gates.
5e. **Big air map.** Verify its 720 jumps by measuring airtime.
6. **Menus.** Outfit colors, settings, key rebinding, and pause.
6b. **Weather.** Clear (bluebird) or overcast and blizzard, changing the fog distance, sky and light, with falling snow in a blizzard. Low keeps its fog inside the Chromebook budget; clear weather on a fast computer shows the far scenery.
7. **Sound effects.**
8. **Performance and polish pass** on the Low preset, then a final embed and deploy check. Polish includes a sun in the sky with a soft glow and warmer golden-hour light, and snow spray when carving hard, braking or landing, with ski tracks left behind that fade out.

## Status (2026-10-18)

**Done:** 0 scaffold and deploy, 1 skiing, 2 air, 3 rails and boxes, 4 checkpoints, 5a map features, 5b map select and the Park, 5c-1 the Freeride mountain, 5c-2 the town and natural features. Freeride's Glades end in a ski town of about 40 buildings: a main street with benches, ledges, rails and a booter, a plaza across it with a stair set and kinked handrails, a row of shops whose roofs step down (with a gap over an alley), chalets whose rounded ridges throw riders onto landing drifts, the lodge, and taller houses behind. Every face has logs, stumps, flat rocks with snow kickers, booters, and a few built jumps and rails; the ridges have booters too. Trail signs stand at the summit, at forks and at the top of town. Four chairlifts run (chairs and riders moving), and distant ranges ring the map. Bots capped at 20 m/s take 2.2 to 3 minutes from the summit; the town runs take under a minute from the bottom of the Glades. **Next:** 5d, the Slalom map.

**Changes in 5c-2 that later work builds on**
- Map format: features `building` (roof `gable` | `shed` | `flat`, `drift`, `apron`, `lip`, `front`, `sign`, `chimney`) and `terrace` (`stairs`, `stairAngle`, `handrails`), built for the sim by `src/maps/town.ts` (roof and drift ramps, wall obstacles with their own heights `y0`/`y1`, handrails as rails) and drawn by `src/render/town.ts`. Rails have a `style` (`metal`, `handrail`, `log`) and `radius`; boxes a `style` (`wood`, `ledge`, `bench`, `rock`, `stump`); logs, benches and stumps use box friction. Jumps, kickers and landings can be `natural` (no dyed lip). Finishes can have an `arch` (the zone stays wide, the banner spans only the arch). Decor: `sign` (header and lines with a run level and arrow), props `streetLamp`, `hut`, `snowmobile`, `skier`, `skiRack`, scatter kind `crag`; chairlifts get stations at both ends. Maps can have `peaks` (the distant ranges).
- Shapes are sorted into 32 m cells (`setShapes`, `topShape`); ramps are merged into one mesh per 64 m tile, with coarser grids on straight and long gentle stretches. `SURFACE.hidden` leaves a stretch to its structure (the stairs' steps).
- Decoration keeps clear of every feature's run-up and landing (a strip from 18 m before to 55 m past a kicker or jump, 10 m before and 18 m past a rail, the run-up and landing of a ridden building).
- Rendering: a backdrop pass (`src/render/backdrop.ts`) draws first with its own camera: a sky gradient, the distant ranges (lit and hazed once), and a stand-in of the map's own ground. Where the preset's haze reaches past the far plane (`CONFIG.quality.hazeEnd`: Medium and Auto 3.2 km, High 6 km), the stand-in is lit snow, rock and forest, with a valley plain out to the ranges, and fades by the same fog as the world; on Low (and on maps without peaks) the fog still ends at the far plane. Cloth (banners, bunting, flags) sways on the GPU (`src/render/cloth.ts`, a `sway` weight per vertex from `MeshKit.panel`). Chairs, riders and bullwheels (`src/render/chairlifts.ts`) and chimney smoke (`src/render/smoke.ts`) are instanced and placed each frame near the camera only.
- Chase camera: lifted by the snow rising behind the skier (`camera.slopeLift`, `slopeLiftMax`), so it looks down the steeps rather than up at the skier.
- Trail map: buildings, chairlifts, jumps and booters, rails and logs, finish arches, the town's name.

**Known issues**
- Not yet tested on a real school Chromebook. On a PC with the CPU slowed 4×, a frame takes about 1.6 ms of CPU on Low in Freeride's forests and 2.1 ms in town (town: about 115 draw calls, 140k triangles; forests 55 to 65 calls). The GPU side is unmeasured. Freeride loads in about 0.6 s on a fast PC.
- Auto sees as far as Medium (450 m) until milestone 8's frame-rate scaling can pull it in. Until the Settings menu (milestone 6), other presets are picked with `?quality=low|medium|high`.
- Esc opens the map menu as a stand-in pause until milestone 6.
- Park: the huge jumps are sized for tucking the in-run from their flag (tucking straight through the 21° steeps overshoots); the long rail has no brake; kicker-fed rails catch at about 6 to 22 m/s.
- The Test slope ends in an invisible wall at the top of the side berms and at the bottom. Riding off a rail sideways crashes unless you turn the skis back first. In the japan grab the ski hangs low.
- Freeride: straight-lining a couloir reaches ~36 m/s; over a convex rollover the camera can't see the slope below; the Northwest ridge ends on gentle ground; the pillow line is rounded steps, not domes; gully walls throw wall airs only when ridden up fairly square; far stand-in trees are plain cones and stop at the far plane, where the far ground's forests are flat dark facets; trail map labels crowd on the North face and in town.
- Town: the rooftop gap needs about 7 m/s off the cafe's lip (slower hits the next wall); a full pop off a chalet ridge or the Market at 18 m/s overshoots its landing drift; rock jibs are flown over above about 14 m/s. Walls stand at the roof's edge, a little outside the drawn walls under the eaves. The camera rises over a roof when riding beside a building.
- Headless bots don't steer around everything: `face.ts --fall` riders sometimes pin against a tree, and bots only brake on the snow.

**Tips for a new chat**
- Maps are written by scripts: edit `tools/maps/park.ts` or `tools/maps/freeride.ts` and rerun it; never hand-edit the map JSON. In `freeride.ts`, positions are `P(spoke, r, across)` with `r` stretched by `K = 1.5`, and in town `T(u, v)` (u m down the town from its top edge, v m to the right facing down). Features that follow the ground (booters down the fall line, logs) are placed from the terrain alone, built once in the script (`fall()`, `gy()`).
- After any Freeride change run: `node tools/maps/freeride.ts` (it warns about logs dipping into the snow and features outside the play area), `node tools/maps/sinks.ts src/maps/freeride.json 0.5`, `node tools/sim/face.ts src/maps/freeride.json` (every run finishes), `node tools/sim/face.ts src/maps/freeride.json --fall 48`, and `node tools/sim/features.ts src/maps/freeride.json [jump kicker log building terrace]` (rides every feature along its own heading at several speeds, with and without a pop; reports crashes and missed slides). `tools/maps/overview.ts` draws a map from above. For the Park, `tools/sim/line.ts` and `tools/sim/kickers.ts`.
- Freeride lessons: drops over ~9 m land at the 15 m/s impact limit; a flat pad on a slope is a kicker; dome pillows leave flat landings; a `dip` round each finish draws riders in. 5c-2: a sharp gable ridge throws slow riders into a nose-high landing on the far side (round it); a gap jump's landing back catches casers nose first (make booters with landings tables); a rail or box starting on a kicker's back side sits higher than its lip (start it past the back); trees and rocks grow right up to features unless the decor keeps them out.
- Play-testing: use the `dev-alt` launch config (port 5181). Load `?map=freeride&quality=low`. In dev builds `window.parkLaps` has `loadMap(id)`, `teleport(x, z, headingRad, speed)`, `lookFrom(x, y, z, tx, ty, tz)` (no arguments: back to the chase camera; take `y` from `heightAt`), `heightAt`, `setQuality`, `scene`, `camera`, `renderer`, `backdrop`, `map`, `skier`. Wait for `parkLaps.map` before using `heightAt` (it's 0 until the map is built).
- Measuring: Playwright and Chrome DevTools MCP are often held by another session; when Chrome DevTools is free, `emulate` with `cpuThrottlingRate` and a `navigate_page` `initScript` that wraps `requestAnimationFrame` to time callbacks named `frame` (the game loop) gives CPU per frame. The in-app Browser pane goes stale while hidden.
- Leave the uncommitted `dev-alt` entry in `.claude/launch.json` alone. Bash heredocs containing backticks fail; write longer patch scripts with the Write tool and run them.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.035, `dragStand` 0.0055 → 0.0066 → 0.0055 (lowered after play-testing for easier speed), `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73.
- Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85. New: `slopeLift` 0.9, `slopeLiftMax` 7.
- Slalom poles: `kick` 0.25 → 0.6, `clipReach` 0.45 → 0.55. Halfpipe: `wallPop` 0.4, `wallLaunchMax` 9 m/s. Walls: `wallAngle` 50 → 44. New: `quality.viewDistance` (240 / 450 / 800 m), `quality.fogStart`, `quality.treeDetail` (220 m), `quality.hazeEnd` (240 / 3200 / 6000 m).
- Landing tolerances loosened so edge landings stick. Still untuned: rail values, checkpoint timings, curve load, rough landings, decoration density.
