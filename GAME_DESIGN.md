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

## Status (2026-10-14)

**Milestones done**
- 0, scaffold and deploy: Vite + Three.js, GitHub Pages via Actions, `embed-test.html`.
- 1, skiing: carving, hockey-stop brake, pole push, crouch and pop, chase camera with drag orbit, dev tuning panel.
- 2, air: spins, flips, corks and misty flips, Lincoln loops, the 8 grabs, carve-into-the-lip spin, landing check, crash tumble, fade and respawn. The test slope has three jumps.
- 3, rails and boxes: land on a rail or box to lock on (light magnet), slide with friction, ←/→ turn the skis straight ↔ sideways, pop or spin off, ride off the end. Missing the line or landing off-angle slips off. Hitting a rail or box below its top bumps you, or crashes you if hard. The test slope has a flat box, a flat rail, a down rail and a flat-down rail.
- Also done early: the Park Laps name, the low-poly skier and all its poses (`poses.html`), turns driven from the knees.
- Next: milestone 4 (checkpoints).

**Known issues**
- Not yet tested on a real school Chromebook.
- The test slope ends in an invisible wall.
- Riding off a rail sideways crashes unless you turn the skis back first (the landing checks sideways however short the drop).
- A full pop carries 6–9 m, so you pop well before a rail. Lower `popMin`/`popMax` if rails feel hard to hit.
- No ride-on (snow-level) boxes or rails yet; every feature needs a pop to get on.
- Respawn goes to the map spawn until checkpoints arrive (milestone 4).
- The large test jump: a full pop above ~15 m/s overshoots the landing and crashes, and a 720 needs a little more air than it gives. The real maps (milestone 5) get properly sized jumps.
- In the japan grab the ski hangs low.
- In a full tuck the thighs poke up to ~1 cm through the jacket front (hidden by the body).

**Tuned config values** (`src/config.ts`, starting value → now)
- Riding: `gravity` 11 → 12, `skiFriction` 0.05 → 0.025, `dragCrouch` 0.003 → 0.002, `brakeDecel` 6 → 7.
- Turning: `grip` 1.8 → 2.0 (plus new `carveFriction` 0.08), `turnRateSlow` 2.8 → 2.3, `turnRateFast` 1.5 → 1.25, `turnResponse` 14 → 10.
- Pole push: `polePushSpeed` 1.8 → 3.1, `poleMaxSpeed` 7 → 8.5, `polePushInterval` 0.55 → 0.73.
- Pop: `popMin` 3 → 3.2, `popMax` 5.2 → 5.5.
- Landing (new, loosened for edges): `pitchMax` 0.6, `rollMax` 0.9, `sideMax` 1.0 rad, `sideSpeed` 6 m/s, `edgeCheckAir` 0.3 s.
- Camera: `heightNear` 2.1 → 2.35, `heightFar` 2.6 → 4.85.
- Rails (new, untuned): `snapDistance` 0.35 m, `angleMax` 0.6 rad, `tiltMax` 0.75 rad, `railFriction` 0.05, `boxFriction` 0.09, `turnRate` 7 rad/s, `spinCarry` 0.5, `crashSpeed` 5 m/s.
- Skier look (new): `render.leanBodyShare` 0.5, `hipShift` 0.3, `kneeDrive` 1.6, `turnCounter` 0.25.
