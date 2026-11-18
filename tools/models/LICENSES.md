# Converted model packs: sources and licenses

`tools/models/packs.ts` converts these packs into the game's own flat-colored triangles. The packs themselves stay out of git (`reference/` is ignored); put each zip where its line says, then run `node tools/models/packs.ts` from the repo root. Every pack here is CC0 1.0 (public domain): no attribution is required, given here anyway. License text: https://creativecommons.org/publicdomain/zero/1.0/

| Pack | Author | Where it came from | License | Zip in `reference/packs/` | Used for |
|---|---|---|---|---|---|
| City Builder Bits 1.0 (free) | Kay Lousberg (KayKit) | https://kaylousberg.itch.io/city-builder-bits | CC0 1.0 | `kaykit/KayKit_City_Builder_Bits_1.0_FREE.zip` | `src/render/propModels.json`: the City's cars, bench, hydrant, bins, dumpster, water tower, street and traffic lights (milestone 16) |
| Modular Street Pack | Quaternius | https://quaternius.itch.io/lowpoly-modular-street | CC0 1.0 | `quaternius/Modular Street Pack by Quaternius.zip` | `src/render/propModels.json`: signs and the signal pole (milestone 16) |
| Ultimate Gun Pack (July 2019) | Quaternius | https://opengameart.org/content/low-poly-guns-pack (the file `ultimate_gun_pack_by_quaternius.zip`, listed as CC0); the same pack is https://quaternius.itch.io/50-lowpoly-guns ("Free for everyone to use in any project, even commercially! (CC0)"), checked 2026-11-18 | CC0 1.0 | `quaternius-guns/ultimate_gun_pack_by_quaternius.zip` | `src/render/devModels.json`: one model (`OBJ/SniperRifle_6`, 1,370 triangles) for the developer's powers (milestone 25), fetched only with the dev unlock |
