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

## Maps (v1: four maps, all unlocked from the start)
Every map has a start gate themed to its kind of skiing, checkpoint flags, a finish zone, and enough decoration to feel like a real place. Decoration stays inside the performance budget: instanced and merged meshes, and the Low preset thins it out. No real brand names or logos anywhere.

1. **Park:** a large terrain park, about 2 to 3 minutes top to bottom, with several lines side by side so you can pick a route.
   - Jumps in every size, from small tables to a pro line of big jumps. The biggest jumps clear a clean 720 (see Jump sizing).
   - Every jump has a rounded knuckle, and landing on it is rideable rather than an instant crash. Include step-ups, step-downs, and a hip.
   - Rails and boxes: flat, down, flat-down, down-flat-down, kinked, and a rainbow. Mix ride-on features at snow level with ones you reach off a kicker (a jump onto a rail).
   - A halfpipe with a drop-in deck at the top.
   - Decoration: orange safety fencing along the lines, plain banners, a chairlift in the distance, light poles, a groomer parked to the side.
   - Start gate: a wooden start deck under a banner arch.
   - Flags: one at the start of each section, about 5 in all.
2. **Big air:** several big jumps of different sizes and takeoff steepness, from long and mellow to steep and poppy, side by side at the bottom of the hill. Each has its own lane from a shared start. At least two of them clear a 720 (see Jump sizing).
   - Start gate: a scaffold drop-in tower, like a big air contest.
   - Decoration: spectator fencing beside the landings, flags, floodlights.
   - Flags: one at the top of each lane.
3. **Freeride:** a large open face, about 2 to 3 minutes top to bottom, with many possible lines: a bowl, rollers, cliff bands and drops of several heights, chutes, pillows, natural side hits, and tree runs.
   - Decoration: dense rock outcrops and boulders, stands of trees, wind-scoured ridges, a few dead snags.
   - Start gate: a ridgetop start with a line of flags and a small start hut, like a freeride contest.
   - Flags: 3 to 4.
4. **Slalom:** a groomed carving run with slalom gates that bend when you clip them. This map alone shows a run timer and a missed-gate count. Respawn returns you to the start house.
   - Start gate: a race start house with a timing wand that starts the timer when you push through it.
   - Decoration: blue course lines dyed in the snow, safety netting along both sides, a finish banner.

### Jump sizing
- Size the 720 jumps from the config: measure the airtime a clean 720 takes at the current spin rate, including winding up and slowing down, then give those jumps at least 20% more airtime than that at the speed the in-run naturally reaches.
- Every landing is long enough that riding in at full speed with a full pop still lands on the slope, not past it onto flat.
- Casing a knuckle at low speed is a rough landing, not a crash.

### New mechanics the maps need
- **Halfpipe:** ride up the walls, launch straight up out of the pipe, rotate, and land back in the transition. Wall riding follows the surface normal, not only the terrain height.
- **Ride-on rails and boxes** at snow level, so you can get on without a pop.
- **Slalom gates** with simple flex when clipped, a missed-gate check, and the run timer.

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
- **Map select:** four cards
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
5b. **The four maps.** Build Park, Big air, Freeride, and Slalom from the Maps section. Verify the 720 jumps by measuring airtime, and check the frame rate on the Low preset with each map fully decorated.
6. **Menus.** Outfit colors, settings, key rebinding, and pause.
7. **Sound effects.**
8. **Performance and polish pass** on the Low preset, then a final embed and deploy check.

## Status (2026-10-15)

**Done**
- 0, scaffold and deploy: Vite + Three.js, GitHub Pages via Actions, `embed-test.html`.
- 1, skiing: carving, hockey-stop brake, pole push, crouch and pop, chase camera with drag orbit, dev tuning panel.
- 2, air: spins, flips, corks, Lincoln loops, the 8 grabs, landing check, crash tumble, respawn.
- 3, rails and boxes: lock on by landing, slide, free ski rotation, pop or spin off, slip off when off-angle.
- 4, checkpoints: flag gates, Tab personal checkpoint (keeps speed), R respawn, hold R to go to the top, finish zone with Back to top.
- 5a, map features, all on a widened test slope (four lanes, dev panel "Test spots" to jump to each): knuckled tables, step-up, step-down, hip, kickers; halfpipe with drop-in deck; ride-on box and rail, kicker to rail, kinked and rainbow rails; slalom gates that flex, run timer and missed-gate count; the four start gates; decoration (trees, rocks, snags, fences, netting, dye lines, banners, light poles, floodlights, chairlift, groomer) with Low/Medium/High density; terrain split into culled chunks.
- Also done: the Park Laps name and the low-poly skier with all its poses (`poses.html`).
- Next: milestone 5b (the four maps). A clean 720 takes about 2.3 s at the current spin values, so 720 jumps need about 2.75 s of air.

**Known issues**
- Not yet tested on a real school Chromebook.
- The test slope ends in an invisible wall at the top of the side berms and at the bottom.
- Riding off a rail sideways crashes unless you turn the skis back first.
- A full pop carries 6–9 m, so popped rails need a small, early pop. A full pop off any test jump flies past its landing onto the slope (a rough landing, not a crash); the jumps are sized for riding straight in without a pop.
- The test slope's 17° pitch reaches 20 m/s, so its later jumps are big. The 5b maps need flatter sections to keep speeds down.
- In the halfpipe the skis follow the path along the wall, like the pitch assist off jumps: a straight air lands forward, a 180 lands switch.
- In the japan grab the ski hangs low.
- Back to top isn't in a pause menu yet (milestone 6). A flag respawns you at the middle of its gate, so maps must keep that spot clear.

**Tuned config values** (`src/config.ts`, start → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.042, `dragStand` 0.0055 → 0.0066, `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 9.5, `brakeRampTime` 0.15 → 0.12.
- Turning: `grip` 1.8 → 2.0, `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73.
- Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85.
- Slalom: `kick` 0.25 → 0.6, `clipReach` 0.45 → 0.55 (knocked poles bend 25–75° and cost 1 m/s).
- Added along the way: landing tolerances (loosened so edge landings stick), rail values and checkpoint timings (both still untuned), skier pose values, and in 5a the wall air, curve load, rough landing, ride-on and decoration density values (untuned).
