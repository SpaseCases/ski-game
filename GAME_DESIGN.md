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

## Maps (v1: four maps plus the Test slope, all unlocked from the start; Brundage Mountain after v1)
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
   - Each jump looks and rides differently: at least one is massive all round (in-run, lip, kicker width, table and landing), one has a really steep lip, one is a freestyle aerials kicker (nearly vertical, for flips), and one is a ski jump (a steep in-run, a takeoff table tipped down to its edge, and a long landing hill with distance markers).
   - A short run-in: lanes start soon after the drop-in, with short, steep in-runs.
   - Tables are wider than their kickers, with room to ride round the kicker and huck the knuckle.
   - Start gate: a scaffold drop-in tower, like a big air contest.
   - Decoration: spectator fencing beside the landings, flags, floodlights.
   - Flags: one at the top of each lane.
5. **Brundage Mountain (milestone 9, after v1):** a recreation of the real ski area near McCall, Idaho, built from public data: the terrain from USGS elevation data, the runs and lifts from OpenStreetMap, checked against the owner's own GPS tracks. It should feel like riding the real mountain: the real runs where they really are, under their real names.
   - Start gate: a ridgetop start on the summit. Finish: the base lodge area, with an arch over the main run-out.
   - Chairlifts along the real lift lines, moving like Freeride's (scenery; riding them stays a later idea).
   - Groomed runs cut into the terrain, forest between them, trees spaced out in the gladed areas, rocks where it's steep.
   - Trail signs with the real run names at forks; checkpoint flags at the main junctions (lift tops and major splits).
   - Its own art throughout: no Brundage logo, no copy of their trail map art, nothing suggesting the resort made or endorses the game. Credit for the data ("© OpenStreetMap contributors", USGS) and a "not affiliated" line in the game and the README.
6. **Test slope:** the development map, kept as a playable map: every feature side by side in four lanes (halfpipe, jumps, rails and boxes, slalom) under all four start gates, for trying things out.

### Jump sizing
- Size the 720 jumps from the config: measure the airtime a clean 720 takes at the current spin rate, including winding up and slowing down, then give those jumps at least 20% more airtime than that at the speed the in-run naturally reaches.
- Every landing is long enough that riding in at full speed with a full pop still lands on the slope, not past it onto flat.
- Casing a knuckle at low speed is a rough landing, not a crash.

### Mechanics the maps need
- Done in 5a: the halfpipe (wall riding follows the surface normal; airs launch straight up and land back in the transition), ride-on rails and boxes at snow level, slalom gates with flex, the missed-gate check and the run timer.
- Done in 5b: terrain with varied pitch (the fall line as pitch sections, plus lanes: bands with their own fall line that start and end level with the slope beside them), rails that follow the snow, and the map-select menu.
- Done in 5c-1: terrain built around a peak that can be ridden down in any direction (spokes for each face and ridge, then ridges, gullies, cliff bands, wind lips and cornices, bowls, pillows and pillow lines, bumps, run-out dips and flat pads, with a rim of hills past the edge), a play area shaped as a polygon, several finish zones on one map, named runs, decoration placed by height and steepness, and the trail map. The snow is built in chunks around the camera, coarser in the distance, and decoration is culled in 2D tiles, with simple stand-in trees far away. Each quality preset sees its own distance: Low 240 m, Medium and Auto 450 m, High 800 m.
- Done in 5c-2: buildings and terraces as map features (roofs you ride, drifts up to them and landing drifts below, solid walls, stairs and handrails), rail and box looks (fallen logs, handrails, ledges, benches, rocks, stumps), booters with no dyed lip, finish arches on wide run-outs, trail signs, crags, moving chairlifts, swaying cloth, chimney smoke, town props, and a backdrop of sky and distant ranges past the far plane.
- Done in 5e: takeoffs of any steepness (a takeoff face is never a wall, and popping off one steeper than a wall pushes straight up), and lanes that blend bank to bank.
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
9. **Brundage Mountain** (the Maps section). Research and plan before any code, and stop for the user's go-ahead at the two checkpoints marked **Stop**. Every step is a script in `tools/maps/brundage/` that can be rerun, like the other maps; nothing is edited by hand.
   - **Privacy first.** The user's Strava archive goes in `reference/brundage/`, which is gitignored: never commit, copy into `src/` or `public/`, or deploy raw tracks. Read `activities.csv` (and `activities/*.gpx`, `.fit.gz`, `.tcx.gz`) and keep only activities whose GPS points fall inside the ski area's boundary (OpenStreetMap's `landuse=winter_sports` polygon, buffered ~200 m); skip everything else without looking further. Clip kept tracks to the boundary and keep only relative times. Only derived results (run lines, lift lines, speed figures) go into the repo. Parsing `.fit` needs a library: ask before adding a dev dependency, or convert outside the repo.
   - **Research and plan (no code).**
     - Elevation: USGS 3DEP from The National Map. Prefer the 1 m lidar DEM where it covers the ski area, else the 1/3 arc-second (~10 m) DEM, plus 1 arc-second for scenery around it. Bare earth, public domain. Ask before downloading, stating the products, tiles and sizes.
     - OpenStreetMap (Overpass): the ski-area boundary, `piste:type=downhill` ways and areas (`name`, `piste:difficulty`, `piste:grooming`, glades), `aerialway=*` lines and stations (`name`, `aerialway:occupancy`), and the base lodge. Note what's missing or wrong. The data is ODbL: credit it in the game and README, and treat the map file built from it as a derived database under ODbL.
     - Tree cover: OSM woods if they're mapped well, else the NLCD Tree Canopy Cover raster (public domain, 30 m) for where forest grows; glades from OSM tags and the Strava lines.
     - Strava: split each kept track into lift rides (a steady climb of ~2 to 6 m/s along a near-straight line) and descents. Fit a line through each cluster of lift rides for the lift's path and terminals, and check it against OSM. Overlay the descents on the OSM runs (a heat map) to find the user's real lines and favorite runs, and note runs OSM lacks.
     - Write the plan in `tools/maps/brundage/PLAN.md`: extent and bounds, projection, resolution and file size, every lift and run (OSM name, difficulty, ridden in Strava or not), which runs are "main", where the start, finish, flags and signs go, and open questions. **Stop** for approval.
   - **Heightfield.**
     - Project to UTM zone 11N (meters) with north = -Z and east = +X, origin at the summit start. Keep the transform in one module the tools share, so the DEM, OSM and GPS line up exactly.
     - Resample the play area (the boundary plus ~100 m) to 3 m cells, like the other maps: physics samples it directly and the chunked renderer already coarsens it with distance. Fill a scenery ring out to 2 to 3 km at 10 to 20 m from the coarser DEM, blended at the seam, with the existing `peaks` backdrop beyond it.
     - Add a terrain type that loads a heightfield file (a 16-bit PNG, or a small binary with origin, cell size, base height and a 2 to 5 cm step), fetched lazily like the other maps. Aim for 3 MB or less. The bounds polygon comes from the boundary, with a rim that turns riders back like Freeride's.
     - Clean up without flattening the mountain: lidar has road cuts, ditches, building pads and noise. Use a small median then a light blur, clip one-cell spikes, and fill pits until `tools/maps/sinks.ts` reports no holes. Keep real rollers, benches and cat tracks.
     - Check the scale: overlay the Strava descents on the DEM; elevations along the tracks should match within a few meters.
   - **Runs and lifts.**
     - Groom each OSM run into the snow: along its line (with its width, or its area), smooth the cross-slope and small bumps but keep the fall line. Widen cat tracks and traverses to at least 8 m and give them ~3° or more downhill so riders don't stall (pole pushing tops out at 8.5 m/s).
     - Each run becomes a map `run` under its real name, giving the trail map, test spots and tree-free corridors.
     - Chairlifts from the OSM lines, adjusted by the Strava lift rides, as moving `chairlift` decor with stations at the real terminals.
     - **Stop:** show an overhead view (`tools/maps/overview.ts`, with the OSM runs, lifts and the user's Strava descents drawn over the shaded terrain) and in-game screenshots down the main runs (High, and Low with its 240 m view), then wait for corrections before decorating.
   - **Speeds.** On the main runs, compare the user's real speeds (moving segments only, smoothed; median and 90th percentile per run) with headless riders on the same lines (`tools/sim/face.ts`-style, standing and tucked). The game's gravity is 12, not 9.81, and its drag is tuned for feel, so expect it to run faster. Report the ratio and recommend leaving `config.ts` alone unless the user agrees otherwise: the other maps are tuned to it.
   - **Decorate.** The summit ridge start, a generic base lodge (no real signage) with the finish zone and arch, trail signs with real run names and difficulty at forks, flags at the main junctions, forest outside the runs with spaced trees in the glades, runs and lift lines kept clear, rocks on steep ground. Keep thick forest near the runs and fold distant hillsides so far forests don't read as slabs. Add the map card (named "Brundage Mountain", with credits) and a credits line in the game for OSM and USGS.
   - **Check.** Zero build errors; `sinks.ts` finds no holes; a headless rider finishes every named run; the Low preset holds the budget with the CPU slowed 4× (draw calls about 120 or fewer, like Freeride's town); it looks right on High; the embed test passes; the other maps' tools are unchanged. Commit, and ask before pushing.

## Status (2026-10-20)

**Done:** milestones 0 to 5e: scaffold and deploy, skiing, air, rails and boxes, checkpoints, map features, map select, and the Park, Freeride, Slalom and Big air maps. 5d, 5e and the Big air update are committed but not pushed. **Next:** 6, menus. Milestone 9 (Brundage Mountain) is planned, not started.

**Known issues**
- Not tested on a real school Chromebook. With the CPU slowed 4×, Low takes ~1.6 to 3 ms of CPU per frame (42 to ~115 draw calls); a jump to a new spot spikes one frame to 30 to 50 ms. GPU cost unmeasured.
- Until milestone 6, quality comes from `?quality=low|medium|high` and Esc opens the map menu. Auto sees as far as Medium.
- Far forests show as flat dark facets past the far plane (Freeride; the Slalom on Medium); far stand-in trees are plain cones.
- Park: huge jumps sized for tucking from their flag; the long rail has no brake.
- Freeride: couloirs reach ~36 m/s; the camera can't see past a convex rollover; trail map labels crowd.
- Slalom: course times come from a bot that steers more finely than keys.
- Big air: no speed-check rise below the tower, so landings are sized for tucking from it; full-speed knuckle hucks overshoot Massive, Steep and Aerials; a 720 off the aerials kicker corks into a flip; the outer lanes are a ~160 m swing out; the tower's deck needs a pole push.
- Test slope: invisible walls at the berm tops; riding off a rail sideways crashes; the japan grab's ski hangs low.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.035, `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73. Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85; new `slopeLift` 0.9, `slopeLiftMax` 7.
- Air: `wallAngle` 50 → 44 (takeoff faces never count as walls); new `wallPop` 0.4, `wallLaunchMax` 9 m/s.
- Slalom gates: `kick` 0.25 → 0.6, new `grazeWidth` 0.2; new `giantSlalom` block (`clipReach` 0.42, `kick` 0.45, `stiffness` 40, `damping` 6, `maxBend` 1.15).
- Quality: `viewDistance` 240 / 450 / 800 m, `treeDetail` 220 m, `hazeEnd` 240 / 3200 / 6000 m.
- Still untuned: rail values, checkpoint timings, curve load, rough landings, decoration density.
