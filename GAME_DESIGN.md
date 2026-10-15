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
2. **Freeride:** a really big open mountain, the largest map, several minutes top to bottom and wide enough for many separate lines: bowls, rollers, cliff bands and drops of several heights, chutes, pillows, natural side hits, and tree runs.
   - Decoration: dense rock outcrops and boulders, stands of trees (solid in the tree runs), wind-scoured ridges, a few dead snags.
   - Start gate: a ridgetop start with a line of flags and a small start hut, like a freeride contest.
   - Flags: 4 to 6, spread across the main lines.
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
- Still to build: bowls, ridges and cliffs, more than one timed course on a map, and giant slalom gates with panels.

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

## Not in v1 (later ideas)
Scoring or trick names, butters and nose/tail presses, rail grabs, snowboard, ragdoll crashes, the full grab set, replays and photo mode, a level editor, gamepad support, music, multiplayer.

## Milestones
0. **Scaffold and deploy.** Vite + TypeScript + Three.js app showing a slope and a box, deployed to GitHub Pages by GitHub Actions, with `embed-test.html` working. Test on a school Chromebook at this point.
1. **Skiing.** Carving, braking, pole push, crouch and pop, terrain sampling, and the chase camera on a test slope. Include the dev tuning panel.
2. **Air.** Spins, flips, corks, Lincoln loops, the 8 grab poses, the landing check, bail, and respawn.
3. **Rails and boxes.**
4. **Checkpoints.** Flags, the personal checkpoint, respawn, hold-R to top, and the finish zone with its Back to top button.
5a. **Map features.** The halfpipe, knuckled jump shapes, ride-on rails and boxes, kicker-to-rail setups, slalom gates and the run timer, the four start gate types, and the decoration system with its density tied to the quality preset. Test each one on the test slope.
5b. **Map select and the Park.** A simple map-select menu (a card per map, keyboard or mouse; milestone 6 finishes the menus) with the Test slope as a card. Terrain with varied pitch. Then the Park map from the Maps section. Verify its 720 jumps by measuring airtime, and check its frame rate on the Low preset, fully decorated.
5c. **Freeride map.** Check its frame rate on the Low preset, fully decorated.
5d. **Slalom map.** Its two timed courses (more than one timed course on a map) and giant slalom gates.
5e. **Big air map.** Verify its 720 jumps by measuring airtime.
6. **Menus.** Outfit colors, settings, key rebinding, and pause.
7. **Sound effects.**
8. **Performance and polish pass** on the Low preset, then a final embed and deploy check.

## Status (2026-10-15)

**Done:** 0 scaffold and deploy, 1 skiing, 2 air, 3 rails and boxes, 4 checkpoints, 5a map features, 5b map select and the Park (`tools/maps/park.ts` writes `src/maps/park.json`; `tools/sim/line.ts` rides a whole line headlessly). After play-testing, the Park was made steeper (11° and 13° sections, 6° flats) and shorter (1.94 km) with the same features packed closer; a straight standing run takes the bots about 2 to 2.5 minutes. **Next:** 5c, the Freeride map.

**Known issues**
- Not yet tested on a real school Chromebook. On a PC with the CPU slowed 4×, the Park on Low uses ~0.6 ms of CPU per frame.
- Esc opens the map menu as a stand-in pause until milestone 6.
- The Park's huge jumps are sized for tucking the in-run from their flag. Tucking straight down a line through the 21° steeps (35+ m/s) overshoots whatever comes next.
- The long rail has no brake (about 23 m/s standing through the steeps).
- Kicker-fed rails catch riders rolling off at about 6 to 22 m/s (26 in the steeps); faster flies over them.
- The Test slope ends in an invisible wall at the top of the side berms and at the bottom.
- Riding off a rail sideways crashes unless you turn the skis back first.
- In the japan grab the ski hangs low.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.035, `dragStand` 0.0055 → 0.0066 → 0.0055 (lowered after play-testing for easier speed), `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73.
- Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85.
- Slalom poles: `kick` 0.25 → 0.6, `clipReach` 0.45 → 0.55. Halfpipe: `wallPop` 0.4, `wallLaunchMax` 9 m/s.
- Landing tolerances loosened so edge landings stick. Still untuned: rail values, checkpoint timings, curve load, rough landings, decoration density.
