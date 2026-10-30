# Beta feedback (2026-10-29)

The first beta testers' comments, typed up by the owner as one-line summaries of what testers said out loud. Each line was treated as a symptom rather than a spec: traced to the code, reproduced with the sim tools or the browser where possible, and then settled with the owner. The fixes are milestones 9 to 18 in `GAME_DESIGN.md`. Milestones 19 (Brundage Mountain) and 20 (billboard ads) are on hold until the owner asks for them.

**Severity:** *breaks* the game, *hurts* it, or *nice* to have. **Size:** S, M or L.

## Items

| # | Item | From lines | Times raised | Type | Severity | Size | Milestone |
|---|---|---|---|---|---|---|---|
| 1 | Rotations reversed in the air (or in a butter) count down | 23 | 1 | Bug | Hurts | M | 10 |
| 2 | Flips past four all read "quad" | 6 | 1 | Bug | Nice | S | 10 |
| 3 | Flat 3s don't track | 14 | 1 | Bug | Hurts | S | 10 |
| 4 | Keys drop when more than three are held | 3 | 1 | Bug (hardware) | Hurts | M | 9 |
| 5 | Pop on Space, ↑ only for flips | 2 | 1 | UI / feature | Hurts | M | 9 |
| 6 | Crashes too sensitive on tips and tails | 9 | 1 | Feel / tuning | Hurts | S | 9 |
| 7 | Long combos: show the whole chain, more grabs | 6 | 1 | UI | Nice | M | 10 |
| 8 | Cheat combos bank to their own best | 7 | 1 | Feature | Nice | S | 10 |
| 9 | Gap bonuses | 17, 18 | 2 | Feature | Nice | M | 10 (engine), 15–17 (named gaps) |
| 10 | Remove the poles | 4 | 1 | Visual / feature | Nice | M | 11 |
| 11 | More cosmetics | 5 | 1 | Visual | Nice | M | 11 |
| 12 | New crash sound | 22 | 1 | Audio | Nice | S | 11 |
| 13 | Ski design pixel editor | 11 | 1 | Feature | Nice | M | 12 |
| 14 | Leaderboards across devices and tabs | 12, 21 | 2 | Feature | Hurts | L | 13 (online), 10 (local fixes) |
| 15 | More, more unusual rails, a loop | 15 | 1 | Content / feature | Nice | L | 14 |
| 16 | Rails on the park jumps' knuckles | 10 | 1 | Content | Nice | M | 14 |
| 17 | Freeride is underwhelming: no real cliffs | 1, 13 | 2 | Content | Hurts | L | 15 (plus 9's powder landings) |
| 18 | More maps | 1, 16, 19 | 3 | Content | Hurts | L | 16, 17 |
| 19 | More cool setups, like the cat gap | 18 | 1 | Content | Nice | M | 10, 15–17 |
| 20 | First-person mode | 20 | 1 | Feature | Nice | M | 18 |
| 21 | A mute grab | 8 | 1 | Already in the game | None | None | None |

## Line by line

1. **"Make more maps (freeride map is underwhelming)"**
   - **What it meant:** two things: more maps (items 18 and 19), and Freeride feeling flat (item 17, which line 13 also raises).
   - **What I found:** Freeride's cliffs are 0 to 9 m, most of them 2 to 5 m, on a 6.2 km mountain. A drop over about 9 m lands harder than the 15 m/s impact limit, even onto 34 to 39° snow, so the map was built small to stay landable.
   - **Fix:** a steeps zone with 12 to 25 m cliffs and couloir drops onto 40 to 45° powder landings. Landings in powder get softer (impact limit × 1.4, 15 → 21 m/s). More features on every face, including cat tracks with cat gaps. Bolder rock bands, cornices and tree lines. The new maps are a city map and a contest-and-progression park.
   - **Milestones:** 9 (powder landings), 15 (Freeride), 16 (city), 17 (contest park).
   - **Check:** `face.ts` rides every run and 48 fall lines to a finish, and the bot lands each new cliff line. Every tool runs on each new map, and Low holds its budget there.
2. **"Make an option to have jump be bound to Space, and the up arrow is just for up rotations"**
   - **What it meant:** what it says.
   - **What I found:** today ↑ crouches and pops on the snow and rails, and front-flips once in the air (`stepSkier`, `fly` in `src/sim/skier.ts`). Nothing is bound to Space.
   - **Fix:** a Settings switch, *Pop with: ↑ / Space*, defaulting to ↑, plus a rebindable `pop` action. On Space, Space crouches and pops everywhere ↑ does today, including ollies out of butters and pops off rails, and ↓ still cancels. ↑ only front-flips, so it can be held off the lip.
   - **Milestone:** 9.
   - **Check:** every sim tool's output stays byte-identical on ↑. In the browser on Space: it pops, flips off the lip, cancels, ollies and pops off rails.
3. **"Issue where pressing over three keys at once can be unresponsive"**
   - **What it meant:** some key combinations stop responding.
   - **What I found:** holding six game keys at once in the browser (↑, ←, ↓, Shift, A, Q) registered all six, so the input code (`src/core/input.ts`) doesn't drop them. Laptop and Chromebook keyboards drop some 3- and 4-key combos in hardware. That's ghosting, and which combos drop depends on the keyboard.
   - **Fix:** a live key tester on the Controls screen. The owner runs it on the school Chromebook with the usual combos, and an *Alternate* layout preset then moves whichever keys drop.
   - **Milestone:** 9 (with a Stop for the Chromebook test).
   - **Check:** the tester lights every held key. The preset applies and saves. The combos that dropped on the Chromebook work on the preset.
4. **"Make an option to remove poles"**
   - **What it meant:** the owner chose no poles and no pole push, with a leg push in its place that works the same way.
   - **Fix:** a Locker switch. With the poles off, Shift does a skating push: one ski steps out and kicks back, on the same timing and physics. It gets a skate scrape sound and a kick of spray. Shift still tucks.
   - **Milestone:** 11.
   - **Check:** sim tools byte-identical, `clearance.ts` passes, and the pose gallery shows the push.
5. **"Make more cosmetic options"**
   - **What it meant:** the owner chose more headwear and patterns.
   - **Fix:** headwear: a beanie with a pom, a cap worn backwards, a hood over the helmet and a bucket hat. Patterns on the jacket and pants: stripes, color blocks, camo and plaid, in palette colors, painted as vertex colors.
   - **Milestone:** 11.
   - **Check:** the skier stays within 17 draw calls and about 9,000 triangles, and Low's frame time is unchanged.
6. **"Make it so it counts as many flips as done (can really inflate the numbers in cheat mode, maybe start giving numbers after quad) and make it so the score counter can string tons of things together"**
   - **What it meant:** two things: naming flips past four (item 2), and longer combos (item 7).
   - **What I found:** flips are named only up to "quad" (`MULTI` in `src/sim/score.ts`), though their points already count every flip. The combo panel shows only the last three tricks, and a trick names at most three grabs (`MAX_GRABS`). The owner chose showing the whole chain and more grabs; the ×10 multiplier cap and the 4 s timer stay.
   - **Fix:** "5x back flip", "6x rodeo 540" and so on. The panel lists the whole live chain, wrapping, with only the last three in a small embed. `MAX_GRABS` 3 → 6.
   - **Milestone:** 10.
   - **Check:** scripted five and six flips (with Turbo spins and Low gravity) come out named and scored in `tools/sim/score.ts`. The HUD is reviewed at four window sizes.
7. **"Make it so top score can bank with cheats, but it is saved separately"**
   - **What I found:** a combo ridden with cheats banks, but it never saves as a best (`src/core/bests.ts`). Separately, two open tabs overwrite each other's bests, because each keeps its own copy.
   - **Fix:** a separate cheats best per map, shown as "Best with cheats" while cheats are on. Bests re-read storage before writing. The online board gets a Cheats tab too (line 12).
   - **Milestone:** 10 (local), 13 (online).
   - **Check:** banking with a cheat saves the cheats best and leaves the clean best alone.
8. **"Add a mute grab"**
   - **What I found:** the game already has one. Left mute is A and right mute is Z: the hand reaches across to the other ski's outside edge in front of the boot. The owner said never mind.
   - **Fix:** none.
9. **"Maybe make crashes less sensitive (when it comes to landing on tips and tails)"**
   - **What I found:** the nose-up or nose-down limit is `landing.pitchMax` 0.6 rad (34°). Releasing ↓ for a back flip off a Park table (jump 48, 16 m/s) lands only inside a 0.22 s window; a 360's window is 0.27 s, and spins have one every 180°. Also, casing a 22° deck slowly with no pop crashes nose-first (jumps 47 and 94 at 8 m/s), though the design says casing should be a rough landing.
   - **Fix:** `pitchMax` 0.6 → 0.75 rad, which widens that window to about 0.28 s. While the trick rotation is small, a landing along your own flight path is allowed up to 1.0 rad as a rough landing: `caseTrickMax` 0.35 and `casePitchMax` 1.0 are new keys.
   - **Milestone:** 9 (tuning, which the owner tests in one sitting).
   - **Check:** a new `tools/sim/flips.ts` prints the windows. `features.ts` no longer crashes the deck cases. Every tool's diff is reviewed.
10. **"Some jumps that have the knuckle, with the jump going onto the knuckle on the park maps, could have rails"**
    - **What it meant:** the owner chose both readings.
    - **Fix:** on Park and Jam Park, some tables get a rail that starts at the knuckle and runs down the landing face, so coming up short slides a rail. Others get rails or boxes along the deck between the lip and the knuckle.
    - **Milestone:** 14.
    - **Check:** `features.ts` jib and kicker runs, `line.ts`, `sinks.ts`.
11. **"Make a ski design pixel editor so you can make custom designs"**
    - **Fix:** in the Locker's Skis tab, paint the ski's own top-sheet grid with the palette (park and carving 64 × 8, big mountain 120 × 12). Tools: pencil, fill, mirroring, clear and undo. Three slots per ski type, saved on the device, working with keyboard or mouse.
    - **Milestone:** 12.
    - **Check:** paint, reload, and ride on the design; storage blocked; keyboard alone.
12. **"Make a leaderboard for the slalom and maps that saves across instances"**
    - **What it meant:** the owner chose an online board for everyone.
    - **What I found:** the Slalom saves no times at all, and combo bests are one number per map, on one device only. Cookies wouldn't save any better than local storage: a school Chromebook clears both together.
    - **Fix:** names entered on the title screen. Nobody owns a name, and each name keeps one entry per board at its best. Per map, the best combo; on the Slalom, the best time per course; each with Clean and Cheats tabs. The top 10 show, with a search for any name, in a closable panel at the finish line and on a Leaderboards screen. The board is Firestore in the existing Firebase project, reached over REST with no new dependency, and loads only when needed. This changes CLAUDE.md's "no backend" rule. Anyone can post a made-up score.
    - **Milestone:** 13.
    - **Check:** post, top 10, search and close in Playwright. First load unchanged. Offline and blocked paths. The school network reaches it.
13. **"Make some steeper parts of the freeride map with actual cliffs and drops"**
    - Same item as line 1's Freeride part. **Milestones:** 9 (powder landings) and 15.
14. **"Make it so the nicher rotations (flat 3s) actually track properly"**
    - **What I found:** a spin with a Lincoln key (Q/E) lands as "Cork 360", the same name as a spin with a flip key. A Lincoln-heavy mix that doesn't finish a loop scores nothing beyond "Air".
    - **Fix:** a spin plus Lincoln is "Flat 360 / 540 / 720", worth a cork's points. Unfinished Lincoln-heavy mixes count as flat spins of their total rotation.
    - **Milestone:** 10.
    - **Check:** scripted spin + Lincoln reads "Flat 360". Spin + flip still reads "Cork 360".
15. **"Add more unique rails (including a loop de loop)"**
    - **What it meant:** the owner picked all four kinds offered.
    - **Fix:** wave, A-frame, double kink and flat-down-flat-down rails. A rail that ends into a wallride, a rail over a gap, and a pole jam. Then 3D rails: a loop-de-loop and a corkscrew that hold the skier on only while fast enough. Today's rails are 2D lines with heights, so 3D rails are new sim work.
    - **Milestone:** 14.
    - **Check:** the hold-on speed through the loop matches the physics, and every older rail is byte-identical.
16. **"Add the swatch nines and woodward to a new map maybe"**
    - **What it meant:** a map inspired by big creative contest setups and by training parks. Both are real brands, so the map takes only the ideas, under its own name.
    - **Fix:** giant step-ups and step-downs, a hip into a wallride, a huge quarterpipe, a cannon rail, tree gaps and a loop. A progression corner of lanes from small to XL ends on a new airbag feature that never crashes you.
    - **Milestone:** 17.
17. **"Add bonuses for gapping stuff"**
    - **Fix:** automatic gaps: open gap jumps cleared, rail-to-rail transfers and fence hops. Named gaps come from map data. Each counts as a trick with points and a multiplier step: `gapPoints` 250, `transferPoints` 200, `hopPoints` 100.
    - **Milestone:** 10 (the engine). The map milestones place the named gaps.
    - **Check:** scripted gap, transfer, hop and named-gap cases in `tools/sim/score.ts`.
18. **"Add more cool stuff (like the cat gap)"**
    - **What it meant:** the cat gap was just an example. The owner wants both cat-track gaps and jumps over parked snowcats, plus other standout features and setups.
    - **Fix:** Jam Park's jump over the parked groomer becomes the "Cat gap" (10). Cat tracks with cat gaps go on Freeride (15). Standout setups go on the new maps (16, 17).
19. **"Make a mostly urban map, almost entirely a city"**
    - **Fix:** a city map down a steep town: stair sets with handrails, ledges, kinked rails, rooftop gaps, wallrides on walls, bonks and drops, built from the town pieces.
    - **Milestone:** 16.
    - **Check:** every tool, and Low with the CPU slowed 4× at about 120 draw calls or fewer.
20. **"First-person mode eventually"**
    - **Fix:** a camera key (default H) switches to first person: the eye at the helmet, the head hidden, the horizon held level in the air.
    - **Milestone:** 18.
21. **"Leaderboard for points that transcends tabs?"**
    - Same item as line 12. Separately, two open tabs overwriting each other's bests is fixed in 10. Chrome may also keep the Google Sites embed's storage apart from a new tab's (third-party storage partitioning). That didn't reproduce in a test browser, and the online board doesn't depend on it.
22. **"Remove the crash boom and replace it with a bleep that sounds like its hiding a cuss and maybe a slight bone breaking"**
    - **What I found:** the crash sound (`bail` in `src/audio/synth.ts`) is five low tone thumps (95 to 40 Hz) and a slide.
    - **Fix:** no booms. A short bone-crack click, then a breathy "sh—" cut off by a TV-style censor bleep (about 1 kHz, 0.4 s), then the slide fading. No real words.
    - **Milestone:** 11.
    - **Check:** rendered WAV levels (the bleep near -22 dBFS), then the owner listens.
23. **"When rotating one direction, if you then rotate the next direction it counts down your rotations"**
    - **What it meant:** testers hit it in a tail press.
    - **What I found:** a butter's turn and a flip both count the net rotation, so turning back counts down. A back flip then a front flip scores only "Air". Spins count the total both ways instead: 360 left then 180 right lands as "540", which wiggling can inflate.
    - **Fix:** each direction counts on its own, in whole steps, for spins, flips, Lincolns and butters alike ("360 · reverse 180"). The grace for coming up short applies only at the landing, so wiggling scores nothing.
    - **Milestone:** 10.
    - **Check:** scripted reversed spins and a reversed tail butter in `tools/sim/score.ts`.
