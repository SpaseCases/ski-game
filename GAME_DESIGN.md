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
| ← / → | Turn | Spin left / right | Rotate skis (straight ↔ sideways) |
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
- Ski orientation carries over from how you landed: straight (parallel) or sideways (perpendicular). ←/→ adjusts it on the rail.
- You leave by riding off the end or by popping off with ↑. Spinning off is allowed.
- Too far off-angle or off-center and you slip off. That's not a bail unless you then land badly.
- v1 features: flat box, flat rail, down rail, flat-down rail. Rails are defined as polylines in the map JSON.

## Checkpoints and runs
- Each map has flags. Riding past a flag saves it.
- **Tab** sets a personal checkpoint at your current position, heading, and speed, so you can re-hit a jump with the same approach. It works only while on the ground.
- Respawning (R, or after a bail) goes to whichever checkpoint was set most recently, personal or flag.
- Holding R for 1s sends you back to the top.
- Every map has a finish zone at the bottom. Entering it shows an on-screen **Back to top** button (Enter also works). Back to top is also in the pause menu.

## Maps (v1: three small maps, all unlocked from the start)
Keep maps small, around 45–60 seconds top to bottom.
1. **Park run:** a short linear terrain park with 3 jumps (small, medium, large), a flat box, a down rail, and a flat-down rail. 2–3 flags and a finish zone.
2. **Big air:** one long in-run into a single large jump with a steep landing, plus a short rail line beside it. The player spawns at the drop-in.
3. **Freeride:** a small bowl with rollers, a couple of cliffs and drops, scattered trees, and natural side hits. 2 flags.

Each map defines: name, heightfield (generated from parameters or loaded from a small grayscale PNG), features, spawn, flags, finish zone, and sky and fog colors.

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
- **Map select:** three cards
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
5. **The three maps.**
6. **Menus.** Outfit colors, settings, key rebinding, and pause.
7. **Sound effects.**
8. **Performance and polish pass** on the Low preset, then a final embed and deploy check.

## Status (2026-10-15)

**Done**
- Milestone 0: scaffold, GitHub Pages deploy, `embed-test.html`.
- Milestone 1: skiing (carve, hockey-stop brake, pole push, crouch and pop, airs off rollers, chase camera, dev tuning panel).
- Extras ahead of schedule: the game is named Park Laps; the low-poly skier and all poses are built (stance, crouch, tuck, 8 grabs, reviewed on `poses.html`); stance, crouch, tuck, lean, brake and pole push animate in game; mouse-drag camera orbit.
- Next: milestone 2 (air).

**Known issues**
- Not yet tested on a real school Chromebook.
- The test slope ends in an invisible wall; brake or press R before the bottom.
- The box on the test slope has no collision yet (milestone 3).
- In the air the skier holds its stance; spins, flips, grabs and landing checks are milestone 2.
- Visual-only facet jitter means skis can sit up to ~3 cm into or above the drawn snow.
- In the japan grab the ski hangs low, its tip near the other ski's level.
- Braking during a pole plant leaves a hand ~3 cm short of its target (not visible).

**Tuned config values** (`src/config.ts`, starting value → current)
- `skier.gravity` 11 → 12; `skier.skiFriction` 0.05 → 0.035 (faster acceleration).
- `skier.grip` 1.8 → 2.0, plus new `carveFriction` 0.08; the ski turn rate is capped by grip so held turns carve.
- `skier.turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10 (slower turning).
- `skier.brakeDecel` 6 → 7.
- Pole push is now a stroke: `polePushSpeed` 1.8 → 2.4, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.8, new `polePlantTime` 0.1 and `polePushTime` 0.5.
- `skier.popMin` 3 → 3.2, `popMax` 5.2 → 5.5 (keeps pop heights at the higher gravity).
- `light.sunFrom` moved behind and above the skier so the chase camera sees it lit.
- New look and camera values: `render.tuckSpeedMin` 7 / `tuckSpeedFull` 12, `brakeCounter` 0.4, `brakeLean` 0.3, `brakeSink` 0.35; `camera.orbit*` for the drag orbit.
