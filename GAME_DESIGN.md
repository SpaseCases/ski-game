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
- Done in 5d: several timed courses on one map (each its own start house and wand, gates, clock, missed-gate count and finish), giant slalom gates with a panel each side, and hillsides folded into spurs and hollows on a slope map.

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

**Done:** 0 scaffold and deploy, 1 skiing, 2 air, 3 rails and boxes, 4 checkpoints, 5a map features, 5b map select and the Park, 5c-1 the Freeride mountain, 5c-2 the town and natural features, 5d the Slalom map. The Slalom is one wide groomed run (970 m long, 160 m wide, 15° to 16° with two 12° rolls) with two courses side by side between safety netting: a slalom on the left (56 bending pole gates, 11.5 to 15 m apart) and a giant slalom on the right (26 panel gates, 27 to 32 m apart). Both start from race houses on a plateau at the top, where a sign at the spawn points to each, and finish side by side at the bottom under their own arch. A headless bot riding a line 0.7 to 1.3 m inside the inner poles misses no gates: slalom 55 to 62 s (about 14 m/s), giant slalom 47 to 49 s (about 16.5 m/s, top 19). Scenery: two chairlifts, stands of pines on folded hillsides, distant ranges, timing huts, spectators, banners. **Next:** 5e, the Big air map.

**Changes in 5c-2 and 5d that later work builds on**
- Map format (5c-2): features `building` and `terrace` (built by `src/maps/town.ts`, drawn by `src/render/town.ts`); rail `style` (`metal`, `handrail`, `log`) and `radius`; box `style` (`wood`, `ledge`, `bench`, `rock`, `stump`); `natural` jumps, kickers and landings; finish `arch`; decor `sign`, props `streetLamp`, `hut`, `snowmobile`, `skier`, `skiRack`, scatter `crag`; map `peaks`.
- Map format (5d): a `slalom` feature has a `name` (its course) and a `kind` (`slalom`: a pole each side; `giant`: a panel between two poles each side, `width` being the opening between the panels' inner poles). A race `start` names its `course`, and a finish can name the `course` whose clock it stops. A course with no finish of its own stops at any finish; unnamed gates and an unnamed race start make one course called after its gate kind (the Test slope's). A generated slope can have `hills` (spurs and hollows past the play area).
- Timed runs (`src/sim/race.ts`): `RaceDef.courses` (each with its start, wand, gate range `first`/`count`, finishes, and `house`, its index among the race starts, for drawing its wand); `RaceState.course` is the course being timed, and `wandTime` is per course. `stepRace` starts whichever wand is pushed through, checks only that course's gates, and stops the clock at its finish (event `finish`). Bends are per side: a pole bends any way; a panel only tips along the gate's direction, as one, with its own spring and a bigger knock (`CONFIG.giantSlalom`). In `main.ts`, `timedCourse()` gives the course of a timed run; respawn goes back to its house; the race HUD and the finish panel name the course.
- Rendering: `SlalomView` draws poles and panels as two instanced meshes, red and blue alternating along each course; the trail map draws gates as dots. The backdrop's valley plain is centered on the heightfield's middle (it assumed a square map round the origin).
- From 5c-2: shapes in 32 m cells (`setShapes`, `topShape`), ramps merged per 64 m tile; decoration keeps clear of features' run-ups and landings; the backdrop pass (sky, ranges, a lit stand-in of the map's ground past the far plane on Medium and High); cloth sways on the GPU; chairs, riders and smoke are instanced near the camera; the chase camera's `slopeLift`.

**Known issues**
- Not yet tested on a real school Chromebook. On a PC with the CPU slowed 4×, a frame takes about 1.6 ms of CPU on Low in Freeride's forests, 2.1 ms in town, and 2.0 to 2.2 ms on the Slalom (82 to 94 draw calls, 77k to 95k triangles); a jump to a new spot spikes one frame to 30 to 50 ms while snow is built. The GPU side is unmeasured.
- Auto sees as far as Medium (450 m) until milestone 8's frame-rate scaling can pull it in. Until the Settings menu (milestone 6), other presets are picked with `?quality=low|medium|high`.
- Esc opens the map menu as a stand-in pause until milestone 6.
- Park: the huge jumps are sized for tucking the in-run from their flag (tucking straight through the 21° steeps overshoots); the long rail has no brake; kicker-fed rails catch at about 6 to 22 m/s.
- The Test slope ends in an invisible wall at the top of the side berms and at the bottom. Riding off a rail sideways crashes unless you turn the skis back first. In the japan grab the ski hangs low.
- Freeride: straight-lining a couloir reaches ~36 m/s; over a convex rollover the camera can't see the slope below; the Northwest ridge ends on gentle ground; the pillow line is rounded steps, not domes; gully walls throw wall airs only when ridden up fairly square; far stand-in trees are plain cones and stop at the far plane, where the far ground's forests are flat dark facets (the Slalom's hillside stands show the same way down the valley, most on Medium); trail map labels crowd on the North face and in town.
- Town: the rooftop gap needs about 7 m/s off the cafe's lip (slower hits the next wall); a full pop off a chalet ridge or the Market at 18 m/s overshoots its landing drift; rock jibs are flown over above about 14 m/s. Walls stand at the roof's edge, a little outside the drawn walls under the eaves. The camera rises over a roof when riding beside a building.
- Slalom: course times come from a bot that steers far more finely than keys; human runs are unmeasured. The giant slalom is only ~20% faster than the slalom (both ride at the speed the slope gives). Riders reach a start house by steering into its open back from the plateau. Hitting the netting above 5 m/s crashes, like any fence.
- Headless bots don't steer around everything: `face.ts --fall` riders sometimes pin against a tree, and bots only brake on the snow.

**Tips for a new chat**
- Maps are written by scripts: edit `tools/maps/park.ts`, `tools/maps/freeride.ts` or `tools/maps/slalom.ts` and rerun it; never hand-edit the map JSON. In `freeride.ts`, positions are `P(spoke, r, across)` with `r` stretched by `K = 1.5`, and in town `T(u, v)`. In `slalom.ts`, `d` is meters down from the top and each course is a `CourseSpec` (corridor, house, a drifting `middle`, stretches of gates with their own spacing and offset, blended over 30 m).
- After any Freeride change run: `node tools/maps/freeride.ts`, `node tools/maps/sinks.ts src/maps/freeride.json 0.5`, `node tools/sim/face.ts src/maps/freeride.json`, `node tools/sim/face.ts src/maps/freeride.json --fall 48`, and `node tools/sim/features.ts src/maps/freeride.json [jump kicker log building terrace]`. `tools/maps/overview.ts` draws a map from above. For the Park, `tools/sim/line.ts` and `tools/sim/kickers.ts`.
- After any Slalom change run `node tools/sim/course.ts src/maps/slalom.json` with `--margin 0.7`, `1` and `1.3`, each also with `--nobrake` (every gate made at the speed the slope gives), plus `sinks.ts`. It rides each course from its house along a line inside the inner poles, checking speed only when sliding wide; `--trace` prints each gate's speed and how far inside the pole it passed. Lessons: a slalom line is followable up to about 13 m spacing and 3.8 m offset (4.5 m gates) at ~14 m/s; a sudden change of rhythm at speed (open gates into tight ones, or a quick straight stretch into round turns) can't be ridden, so blend between stretches; the bot's speed check must come from sliding wide, not a curvature estimate (that braked a third of the run on gates it could carve).
- Freeride lessons: drops over ~9 m land at the 15 m/s impact limit; a flat pad on a slope is a kicker; dome pillows leave flat landings; a `dip` round each finish draws riders in; a sharp gable ridge throws slow riders nose-high (round it); make booters with landings tables; start a kicker-fed rail past the kicker's back; keep decor clear of features.
- Play-testing: use the `dev-alt` launch config (port 5181, or 5182 when another session holds it). Load `?map=slalom&quality=low`. In dev builds `window.parkLaps` has `loadMap(id)`, `teleport(x, z, headingRad, speed)`, `lookFrom(x, y, z, tx, ty, tz)` (no arguments: back to the chase camera; take `y` from `heightAt`), `heightAt`, `setQuality`, `scene`, `camera`, `renderer`, `backdrop`, `map`, `skier`, `race`, `raceDef`. Wait for `parkLaps.map` before using `heightAt` (it's 0 until the map is built). The dev panel's test spots include each course's start house (`start: Slalom`).
- Measuring: Playwright MCP's `browser_run_code_unsafe` works for screenshots (into `.playwright-mcp/`) and timing: open a page with an `addInitScript` that wraps `requestAnimationFrame` to time callbacks named `frame`, then `page.context().newCDPSession(page)` and `Emulation.setCPUThrottlingRate` 4. The in-app Browser pane goes stale while hidden.
- Leave the uncommitted `dev-alt` entry in `.claude/launch.json` alone. Bash heredocs containing backticks fail; write longer patch scripts with the Write tool and run them.
- For 5e (the Big air map): author it with a script like `tools/maps/park.ts` (`generated` slope, `profile`, `lanes` for each jump's in-run and landing, `hills` for the valley sides); the `tower` start already exists (scaffold drop-in, `TOWER` in `src/maps/startGates.ts`); size the 720 jumps per Jump sizing with `tools/sim/line.ts ... tuck pop 720` (Park lessons: ~18 m/s off a ~31° lip, a long table, a ~46° landing); `floodlight`, `fence`, `flag` and `banner` decor exist; one flag at the top of each lane. Keep thick forest off the far hillsides, or fold them with `hills`, so the far stand-in doesn't show flat slabs.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.035, `dragStand` 0.0055 → 0.0066 → 0.0055 (lowered after play-testing for easier speed), `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73.
- Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85. New: `slopeLift` 0.9, `slopeLiftMax` 7.
- Slalom poles: `kick` 0.25 → 0.6, `clipReach` 0.45 → 0.55. New: `giantSlalom` (panel 0.75 m wide, 0.95 to 1.5 m up; `clipReach` 0.5, `kick` 0.45, `clipSlow` 1.6, `clipPush` 0.6, `stiffness` 40, `damping` 6, `maxBend` 1.15). Halfpipe: `wallPop` 0.4, `wallLaunchMax` 9 m/s. Walls: `wallAngle` 50 → 44. New: `quality.viewDistance` (240 / 450 / 800 m), `quality.fogStart`, `quality.treeDetail` (220 m), `quality.hazeEnd` (240 / 3200 / 6000 m).
- Landing tolerances loosened so edge landings stick. Still untuned: rail values, checkpoint timings, curve load, rough landings, decoration density.
