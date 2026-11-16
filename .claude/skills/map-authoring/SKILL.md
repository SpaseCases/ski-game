---
name: map-authoring
description: Use when creating, reworking or extending a Park Laps map (tools/maps/*.ts generators, src/maps/*.json, peak or generated terrain, buildings, terraces, rails, wallrides, quarters, gaps, decor), or when a map tool (features.ts, face.ts, score.ts, sinks.ts) reports crashes, misses or holes after a layout change.
---

# Map authoring (Park Laps)

Maps are data written by a generator script. The checks ride the real sim, so a layout is only done when they pass and every other map's tool output is unchanged. Read `ARCHITECTURE.md` → Maps (and the map's own Fragile notes) first; this is the short list of lessons that cost a rerun before.

## Workflow
1. **Baseline first.** Before touching shared code (`src/maps/*`, `src/sim/*`, `tools/sim/*`, `railKit.ts`), save every tool's output for every other map (`node tools/sim/<tool>.ts <map> > base/<tool>-<map>.txt`, plus `sinks.ts`). After the change, diff: byte-identical, or explain why not.
2. **Edit the generator, rerun it** (`node tools/maps/<map>.ts`). Never hand-edit `src/maps/*.json`.
3. **Check:** `tools/maps/sinks.ts <map>` (0 holes), `tools/sim/features.ts <map>` (every kind and jib: 0 problems), `tools/sim/face.ts <map>` (every run and fall line finishes), `tools/sim/score.ts` (named gaps score), `tools/maps/overview.ts <map> <png>` and look at it.
4. **Perf** on Low with the CPU slowed 4×: draw calls and frame CPU against a known map (Freeride's town).

## Rules that bit before
| Rule | Why |
|---|---|
| **Feature order is identity.** Append new features; never insert before old ones. | Tools report rails by index; sim rails follow feature order. |
| **Seeded random order is identity.** One shared `rand()` re-rolls everything after any change to a call before it. Give independent areas their own `random(seed)`. | A tweak in one block re-rolled colors and strips everywhere below. |
| Tree/decor seeds count the decor before them: add decor **after** trees. Changing a scatter's `count`/`area` re-places the set. | |
| **Quarters (and wallrides built from them) are pipe walls** in the sim: leaving one going up launches straight up with inward drift. For a bank you ride over at speed (curb plow banks, banks under drops) use a natural `landing`, not a quarter. | City riders crossing a plow quarter got launched straight up. |
| **Wallrides go full length** (18 m) on a wall at least `before + length + past` long. | Shorter ends with the rider still on it heading into the wall; one ending near the building's end throws riders over the coping into the next wall. |
| **Rooftop rows step down:** each roof's uphill eave (shed eave + rise) stands lower than the roof before it. | Otherwise its uphill wall clips riders crossing over. |
| **Clear snow before pop-on bonks:** ~26 m (`CLEAR_BEFORE`) of open snow before anything you pop onto (planters, benches, barriers, ledges, cars, dumpsters) after a stair set, drop or rail; bonks stand ~2.5 m off the line's middle; ledges ~4 m out, clear of handrails (2.7 m). | Straight-line riders in `features.ts` run into their sides. |
| **Keep-out strips:** `runway`/run corridors are rows of 4 m circles 4 m apart: use a half-width ≤ 4 or ≥ 10, never 4 to 8. | Two lines leave a hole down the middle where decor lands. |
| A run's `clear` keeps decor off it; named gaps clear their way in, gap and landing; cliff bands need `clear`. | Boulders/crags on a gap's run-in stop riders. |
| **Peak terrain:** element order matters (`flat` and `track` sample the elements before them); bounds must be star-shaped from the summit; a road (`track`) needs `crossfall` (~0.35), level roads on steep faces cause impact crashes. Anything laid on `groundSoFar()` moves when an earlier element changes. | |
| Drops: on groomed snow keep cliffs/drops ≤ ~9 m with a bench 2.5H + 8; bigger only onto 38–45° powder. | Impact limit 15 m/s. |
| Steep lips (> 44° = `air.wallAngle`) pop straight up; takeoff faces are exempt. | |
| Buildings nobody rides: shed roof turned uphill (yaw 180, rise = slope drop) so they stand level; their roof ends are `SURFACE.hidden`. | |
| Check footprints: no rail, box, kicker or quarter inside a building (keep a `clashes` check in the script). | |
| Kicker-fed rails: start at the lip's height, ~1 m gap, 12+ m long. Rails catch only on the way down. | |
| New named gaps go at the **end** of `tools/sim/score.ts`'s last section. | Older output lines stay identical. |
| **A named gap's takeoff area must hold the lip itself** (takeoff start to lip + 3 m), and its landing area starts where slow riders land (the landing's flat top), not at the knuckle. | The air starts at the lip: an area that stops short of it never scores. |
| **A generated slope's profile needs one more section past the map's end, falling away.** | The land beyond otherwise carries the last pitch on for good: a stop rise becomes a wall across the valley. |
| **An airbag's pad must reach past the longest flight** (tucked, full pop) by 5 m or more: check with `tools/sim/airbag.ts`, not by estimate. Its wall starts `back` m before the kicker's lip, so its top begins at the lip. | A pop adds half a second of air; the first pads were 8 m short. |
| Trees inside a play area are `solid: true` and laid in islands whose edges only wander **inward**. Trees a jump flies over are `spots` with `anywhere: true`. | Solid trees pushed out into a trail are crashes; a jump's keep-out clears ordinary scatter out of its gap. |
| A rail may span a gap high over riders: rails are solid only 2.5 m under their tops. | |

## The checkers' geometry is a layout rule
The tools ride from fixed distances; lay features so those starts and run-outs are clear:
- `features.ts` building with no drift: starts 15 m behind its uphill wall, so the roof before it must be ≥ 16 m (or the ride starts in front of that roof's wall). Terrace: from 8 m behind its back to ~33 m past its front. Wallride: from 6 m out at 25° and 45°, and riders leave its far end heading back out (keep ~36 m past it open).
- `score.ts` named gap: starts 12 m before the takeoff zone; a step down inside those 12 m ends the ride early, so make the lip roof ≥ 16 m.
- Pass kinds as separate args: `features.ts map.json handrail jib`. `handrail,jib` silently runs nothing and prints "no problems".
- Take gap zones and wallride lines from the building **as laid** (world coordinates), not from a street or column line: a curving edge splays away from the straight buildings on it.

## Big shapes from terrain lanes (Proving Ground pattern)
A `generated` slope's lane that climbs (a pitch flatter than the slope, or uphill), runs with the slope, then drops is a mound, and its `blend` banks are landings: height H over a blend B has a mean bank of atan(H / B), steepest 1.5 H / B in the middle. Two mounds a few meters apart make a slot; one narrow lane with wide banks is a hip's spine (kickers angled 30 to 36° off its deck, each lip on the deck's edge); a rib under a tree island is a low wide lane. Give the last section no pitch so it solves back level. Lanes add where they overlap. Easy trails get character from a lane that steps: benches (9°) and short pitches (25°) in turn.

Riders reach a deck slower than they left the slope (the climb costs v² = 2 g H): size what's on it for that speed, and put what needs speed further along the deck. A transfer across a slot wants its kickers angled 60° off the fall line, so riders keep the speed the deck gives.

## A chairlift riders take
A `chairlift` line with `ride: true`, bottom point first. Riders board from the **outside** of the up cable (the right-hand side looking up the line), so fence off the uphill side of the loading point and leave the outside open; keep 12 m clear at the top's outside, where the half circle off the chair ends. Its towers stand every ~55 m: run the line through a tree island, not down a trail. Check with `tools/sim/lift.ts`.

## Packing a dense map (City pattern)
Record every building's outline (with drift and landing drift) and every feature's clear zone as oriented rectangles in a grid (`cityKit.ts` `footprints`/`keeps`). Everything placed afterwards (columns, infill, trees, lamps, vehicles, people) keeps off both; report "clear zones with a building in them" at the end. Give each area its own seeded random so one change doesn't re-roll the map.

## Adding or renaming a map
`registry.ts` (`MapId`, `MAPS`), `ui/mapArt.ts` (`ART`), the generator, and its named gaps at the end of `tools/sim/score.ts`. With a leaderboard: `online/limits.ts` + `online/boards.ts`, then a Worker redeploy (ask first).

## Performance budget (Low preset)
Flat-shaded vertex colors, no textures. Static geometry merges into tiles (props 64 m, glow and rails 128 m); instanced trees. Aim for ≤ ~120 draw calls in view at Low 4× CPU and frame time near Freeride's town. Count triangles for any new kit piece; the skyline/backdrop shows tall buildings past the far plane only inside `plainRing`.

## Common mistakes
- Changing `peak.ts`/`terrain.ts`/`shapes.ts` without rerunning **every** generator that bakes terrain-derived numbers (Freeride's booter yaws, log heights, finish widths). Nothing checks for drift.
- Reading only the summary line of a tool: read the problem lines.
- Moving a jump inside a named gap's polygon without rerunning its generator (Jam Park's Cat gap).
