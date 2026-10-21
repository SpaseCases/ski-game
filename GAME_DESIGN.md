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
| Esc or P | Pause menu (P also works in fullscreen, where the browser takes Esc) | same | same |

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
   - Scenery: rock outcrops and boulders, stands of trees (solid in the tree runs) thinning to a treeline, dead snags, wind-scoured ridges, trail signs at forks, and distant peaks around the map. Detailed enough to look good on a fast computer in clear weather (milestone 6f), while Low thins it out.
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
- **Outfit:** colors, headwear and skis, chosen in the Locker and saved locally (below).
- Sky is a gradient, with matching fog per map and weather.

## Locker: outfit, headwear and skis
- Opened from the title and pause menus. A live preview of the skier turns slowly beside the choices. It reuses the one WebGLRenderer (a scissored viewport, or the paused world when opened from pause), never a second WebGL context.
- **Colors** for the helmet, goggles (frame, lens and strap; the lens is a tinted mirror, lighter at the top), jacket, pants, boots and mittens, each picked from one shared palette of about 16 to 20 swatches that look good together. Arrow keys move across the swatches.
- **Headwear:** a helmet; a helmet with a Santa hat over it (red, a white band, and a pom-pom that sways like the banners' cloth); or a jack-o'-lantern: a full carved pumpkin head with a carved face instead of goggles, whose eyes and mouth glow at night. The Santa hat and the pumpkin keep their own colors.
- **Skis:** the ski type and one of its 3 to 4 graphics (see Skis), with stat bars.
- The defaults are today's look: the current outfit colors (the palette includes them), the helmet, and the park ski with lime tips as its first graphic.
- Everything is saved locally; the defaults work without storage. The rig rebuilds its geometry only when the outfit changes, never per frame.

## Skis
Three ski types, each with its own model, 3 to 4 top sheet graphics to pick from, and its own stats. Stats are multipliers on the base numbers in `config.ts` (a `skis` block there). The park ski's multipliers are all 1, so it rides exactly like today's skiing and every map stays tuned for it. The physics treats all three skis as the same length, so rails and landings don't shift between them.

| Ski | Model | Better at | Worse at |
|---|---|---|---|
| Park | Today's twin tip: both ends turned up | Spins (the baseline) | Nothing; it's the baseline |
| Big mountain | Longer looking and much wider, a long early-rise nose, a small tail rise | Bigger drops (higher `impactMax`), landing with the nose further up or down (higher `pitchMax`) | Slower spins and flips, but still able to clear a 720 on the 720 jumps (they have 20% spare airtime) |
| Carving | A narrow waist with a clear sidecut, a flat race tail, a low tip | Holds an edge at speed (`grip`), keeps speed through turns (`carveFriction`), sharper turns when fast (`turnRateFast`), higher top speed (less friction and drag) | Stiff landings (lower `pitchMax` and `impactMax`), slower spins, twitchy riding switch (catches an edge more easily going backwards) |

- The Locker shows stat bars for each ski: Spins, Landings, Top speed, Grip. They come from the multipliers.
- **Graphics:** original art painted as vertex colors on a grid of small faces across the top sheet, so it shows on Low without textures. Park graphics are bold and graphic (stripes, blocks, checks). Big mountain graphics are colorful hand-drawn art in the spirit of artist-series skis (painted mountains, sunsets, swirls, critters). Carving graphics are race style (speed stripes, gradients). No real brands, logos, text or copied artwork.
- Poles are the same for every ski.

## Cheats
- A Cheats screen, reached from the title and pause menus, with toggles that combine freely:
  - **Low gravity:** gravity scaled down, for long floaty airs.
  - **Super fast:** a much higher top speed (less friction and drag), and quicker, stronger pole pushes that keep helping up to a higher speed. Everything else runs at normal speed.
  - **Moon jump:** pops launch far higher.
  - **Slow motion:** the whole game runs slower (the time fed to the fixed-step loop is scaled), so tricks are easier to time.
  - **No crashes:** every landing rides away, however bad: the skier is set upright on the snow instead of bailing. Hitting an obstacle stops you without a crash.
  - **Turbo spins:** spins, flips and Lincoln loops rotate much faster.
- Every cheat's numbers live in `config.ts` (a `cheats` block) and layer on top of the base numbers and the ski's multipliers, so turning a cheat off restores exactly what was there.
- **Tuning panel:** the Cheats screen has a button that opens the live tuning panel (lil-gui) in any build. It loads only when opened (its own chunk), so the first load is unchanged. Its changes last until reload, and it has a reset button. Typing into it never steers the skier.
- Cheats start off on every visit (never saved). While any cheat is on, or the tuning panel has changed a value, a small "Cheats on" tag shows in a corner.

## Weather
- **Bluebird:** clear, today's look, with the far scenery on Medium and High.
- **Overcast:** flat gray light, low contrast, closer haze.
- **Blizzard:** moody but playable, with about 100 to 120 m of view on every preset. Falling snow blows sideways in gusts under a gray-white sky, and more snow blows off the ridges.
- **Night:** a dark blue sky with a moon and stars, blue moonlight on the snow, and a headlamp glow ahead of the skier. Floodlights switch on at the Park, Big air and Slalom with pools of light on their runs, the windows and street lamps glow in Freeride's town, and the jack-o'-lantern's face glows.
- Picked on each map card before riding, or from the pause menu mid-run (it changes live). The last pick is remembered for every map. Default: bluebird.
- Lighting stays within CLAUDE.md's rule (one directional plus one hemisphere light). Weather changes their colors and strength, the sky and the fog. The headlamp and floodlight pools are faked (for example, additive light decals on the snow), not real lights.
- Each map's sky and fog colors are its bluebird look. The other weathers derive from them unless a map overrides them.
- Low keeps its fog within its 240 m budget; the blizzard brings it closer.

## Snow effects
- One pooled effects system with a fixed budget and no per-frame allocations. The render layer reads sim state and events. Low gets fewer particles and shorter tracks.
- Spray when carving hard (scaled by edge angle and speed), and a sheet of spray when braking or hockey stopping.
- Ski tracks: a ribbon behind each ski that fades out, broken in the air and on rails, wider and deeper in powder.
- A puff of snow on hard landings and a burst on a crash.
- Sparks off metal rails (none off boxes, logs or other wood).
- Powder clouds: bigger, fluffier spray off-piste on Freeride. Groomed snow is the Park, Slalom, Big air, the Test slope, and Freeride's named runs and town. The rest of Freeride is powder.
- Wind blowing snow off ridges, wind lips and cornices, more in a blizzard. The blizzard's falling snow uses the same system.

## Camera
- Third-person chase from behind and above, smoothed. It pulls back as speed rises and swings around when you ride switch.
- It doesn't clip into terrain.
- In the air it keeps the horizon stable and does not spin with the skier.
- Click-and-drag with the mouse (or a finger) orbits the camera around the skier. Standing still, the view stays where you leave it; once riding, it eases back behind the skier a moment after you let go.

## Audio (sound effects only)
- Built with Web Audio, either procedurally (filtered noise) or from CC0 sound files (credited).
- Snow carve hiss scaled by speed and edge angle; wind in the air scaled by speed.
- Pop, soft and hard landing thuds, rail scrape (separate sounds for metal rails and wood boxes), bail tumble, and UI clicks.
- Weather ambience: howling wind and gusts in a blizzard, a quiet hush at night.
- A Big air crowd by the landings that cheers when you land clean.
- Chairlift hum near the lifts and chatter in Freeride's town, fading with distance.
- Slow motion (a cheat) lowers the sounds' pitch with the game's speed.
- Master and SFX volume sliders plus a mute toggle in Settings.

## Menus (HTML/CSS overlay, usable with keyboard or mouse)
- **Title:** Play, Locker, Settings, Controls, Cheats
- **Map select:** a card per map: Park, Freeride, Slalom, Big air, and the Test slope, each with a weather picker (milestone 6f)
- **Locker:** outfit colors, headwear and skis with a live preview of the skier (see Locker)
- **Settings:** quality (Auto / Low / Medium / High, applied live); master and SFX volume plus mute; key rebinding for every action (it listens for the next key, refuses Esc, and swaps or warns on a key that's already taken), with reset to defaults. Saved locally.
- **Controls:** the tables above, built from the current bindings so they show rebound keys
- **Cheats:** see Cheats
- **Pause (Esc or P):** Resume, Respawn, Back to top, Weather, Map select, Locker, Settings, Controls, Cheats. The simulation stops while paused (the fixed-step accumulator doesn't build up).
- Every menu works with the keyboard alone (arrows or Tab move focus, Enter picks, Esc goes back, focus is always visible) and with the mouse. While a menu is open, no game key reaches the skier; while riding, Tab sets the checkpoint and never moves browser focus.
- **HUD:** minimal and with no score. A brief "Checkpoint set" toast, the Back to top button at the finish, the trail map button, "Open in new tab" when the game is embedded, and a small "Cheats on" tag while cheats are on.
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
6a. **Menus.** The title (Play, Settings, Controls; Cheats joins in 6b and the Locker in 6c), the finished map select, Settings (quality applied live, key rebinding, volume and mute saved for milestone 7), Controls built from the bindings, and the pause menu (Esc or P) that freezes the simulation. Keyboard only, embedded, and without storage all work.
6b. **Cheats.** The Cheats screen with its six toggles, the tuning panel reachable in every build, and the "Cheats on" tag. Turning every cheat off leaves the sim tools' results unchanged.
6c. **Locker: outfit and headwear.** Palette colors for helmet, goggles, jacket, pants, boots and mittens; the helmet, Santa hat and jack-o'-lantern; the live preview; saved locally.
6d. **Skis.** The three ski types with their own models, 3 to 4 graphics each, stats and stat bars. The park ski's sim tool results are unchanged; measure that the big mountain ski still clears a 720 on the Park's and Big air's 720 jumps.
6e. **Snow effects.** Spray, tracks, landing puffs and crash bursts, rail sparks, powder clouds and ridge snow, within the Low budget.
6f. **Weather.** Bluebird, overcast, blizzard and night, picked on the map card or from pause. Low keeps its fog inside the Chromebook budget; clear weather on a fast computer shows the far scenery.
7. **Sound effects** (the Audio section).
8. **Performance and polish pass** on the Low preset, then a final embed and deploy check. Polish includes a sun in the sky with a soft glow and warmer golden-hour light.
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

## Status (2026-10-21)

**Done:** milestones 0 to 5e (scaffold and deploy, skiing, air, rails and boxes, checkpoints, map features, map select, and the Park, Freeride, Slalom and Big air maps), pushed and live; 6a, menus, committed. 6a added the title (a trail sign over a painted mountain), the finished map select (each card has an empty options row for 6f's weather), Settings (quality applied live, volume and mute saved for milestone 7, every key rebindable with two slots per action, swaps on a taken key, reset), Controls built from the bindings, and the pause menu (Esc or P, both rebindable apart from Esc), which freezes the sim and every time-based animation. Settings save under `parkLaps.settings.v1` (the old `quality` key is read once). Menus live in `src/ui/menus.ts` (screen stack and all keyboard routing); later screens add planks with `addItem`. 6b, cheats, committed: the Cheats screen (title and pause) with six switches laid out like a lift status board, Switch all off, and the tuning panel button. The sim reads `TUNING` (`src/sim/tuning.ts`): CONFIG × the ski's multipliers (all 1 until 6d: `setSkiScale`) × the `cheats` block, rebuilt only when something changes; with every cheat off it equals CONFIG, and the sim tools' output is byte-identical to 6a's. Slow motion scales the time fed to the loop (`sim.timeScale`); the HUD (toasts, fades, hold R) keeps real time. The tuning panel (`src/ui/tuningPanel.ts`, lil-gui) is its own chunk, fetched only when opened (dev builds open it folded at startup); keys pressed in it never reach the skier or the menus. 6c, the Locker's outfit and headwear, committed: Locker on the title and pause menus; one 20-swatch palette (`src/core/outfit.ts`, which includes today's colors) for helmet, goggle frame, goggle lens (a tinted mirror; the default Steel matches the old smoke lens), goggle strap (now drawn round the back of the helmet), jacket, pants, boots and mittens; headwear: helmet, Santa hat over the helmet (its tip and pom-pom sway with `cloth.ts`), or a big jack-o'-lantern that swallows the head and most of the neck, with a carved face drawn unlit so 6f can light it at night with `SkierRig.setGlow(0..1)` (no extra light). The outfit saves under `parkLaps.outfit.v1`; anything missing or not in the palette falls back to the default. `SkierRig.setOutfit` rebuilds only the parts that changed and frees the old geometry (left and right limbs share one). The preview draws into a scissored rectangle of the one renderer, seen through a clip-path hole in the menu (`Menus.setHole`): from the title, a small stage that turns the skier; from pause, the paused world with the camera circling the real skier. The Skis tab shows the park ski until 6d. The skier is 16 draw calls and 5,600 triangles with the helmet (was 16 and 5,436), 17 and 6,044 with the Santa hat, 17 and 4,464 with the pumpkin; with the CPU slowed 4× on Low, riding the Park costs the same as before (median ~2.8 ms per frame) and opening, changing and closing the Locker stays under ~4 ms per frame. **Next:** 6d, skis. Milestone 9 (Brundage Mountain) is planned, not started.

**Known issues**
- Not tested on a real school Chromebook. With the CPU slowed 4×, Low takes ~1.6 to 3 ms of CPU per frame (42 to ~115 draw calls); a jump to a new spot spikes one frame to 30 to 50 ms. GPU cost unmeasured.
- Auto is the same as Medium until milestone 8's frame-rate scaling. `?quality=` still overrides the saved preset for a visit.
- With the CPU slowed 4×, the first time Settings or Controls opens costs one ~60 / ~30 ms frame (layout), while the game is already paused; later opens and pausing or resuming cost 6 to 18 ms. Riding on Low is unchanged (~1.6 ms per frame).
- Key names follow key positions on a US keyboard (bindings use `KeyboardEvent.code`).
- Volume and mute are saved but nothing plays until milestone 7.
- Cheats: Low gravity slows in-runs too (gravity drives them), so its airs are slower as well as longer; with Low gravity or Moon jump, flights that fall steeply onto flat snow can land nose-down and crash (No crashes covers it). Moon jump in a halfpipe is still capped by `air.wallLaunchMax`. The tuning panel can cover the right of a menu in a small embed (close it from its own button).
- Far forests show as flat dark facets past the far plane (Freeride; the Slalom on Medium); far stand-in trees are plain cones.
- Park: huge jumps sized for tucking from their flag; the long rail has no brake.
- Freeride: couloirs reach ~36 m/s; the camera can't see past a convex rollover; trail map labels crowd.
- Slalom: course times come from a bot that steers more finely than keys.
- Big air: no speed-check rise below the tower, so landings are sized for tucking from it; full-speed knuckle hucks overshoot Massive, Steep and Aerials; a 720 off the aerials kicker corks into a flip; the outer lanes are a ~160 m swing out; the tower's deck needs a pole push.
- Locker: opened from pause, the circling camera can pass through a nearby wall or start house. In a small embed the Locker scrolls, and its preview gets short. The default helmet, goggle frame and jacket are the palette's Coal (#2c3037), a hair off the old #2a2d32 and #30343a.
- Test slope: invisible walls at the berm tops; riding off a rail sideways crashes; the japan grab's ski hangs low.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.035, `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73. Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85; new `slopeLift` 0.9, `slopeLiftMax` 7.
- Air: `wallAngle` 50 → 44 (takeoff faces never count as walls); new `wallPop` 0.4, `wallLaunchMax` 9 m/s.
- Slalom gates: `kick` 0.25 → 0.6, new `grazeWidth` 0.2; new `giantSlalom` block (`clipReach` 0.42, `kick` 0.45, `stiffness` 40, `damping` 6, `maxBend` 1.15).
- Quality: `viewDistance` 240 / 450 / 800 m, `treeDetail` 220 m, `hazeEnd` 240 / 3200 / 6000 m.
- New in 6b: `sim.timeScale` 1, and the `cheats` block (Low gravity × 0.4 gravity; Super fast × 0.3 ski friction, × 0.4 all three drags, × 2 pole push, × 2.5 pole max speed, × 0.6 pole plant, stroke and interval; Moon jump × 2.5 pop; Slow motion × 0.5 time; Turbo spins × 2 spin, flip and Lincoln rates and rotateAccel), still to tune by feel.
- New in 6c: the `locker` block (preview `turnRate` 0.45 rad/s, `halfHeight` 1.2 m, `halfWidth` 0.95 m, `rise` 0.55 m, `stageAngle` -0.35).
- Still untuned: rail values, checkpoint timings, curve load, rough landings, decoration density.
