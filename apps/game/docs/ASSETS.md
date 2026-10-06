# Embedded assets

All assets are served locally by this application. Runtime gameplay does not call an asset provider.

## Materials

Scanned PBR texture sets from [Poly Haven](https://polyhaven.com). All Poly Haven assets are
[CC0](https://polyhaven.com/license). The public API (`api.polyhaven.com`) was used only during
local asset preparation; the game never calls it.

**Street sets** (`public/textures/<id>_{diff,nor_gl,orm}_{1k,2k}.ktx2`, plus `_diff_4k` on the
hero sets). Each has albedo, OpenGL normal and a packed ORM map (R = ambient occlusion,
G = roughness, B = metalness; Poly Haven's "arm" map), encoded as KTX2 / Basis ETC1S with mipmaps:

| Set | Author(s) | Real size | Used for (`materials.ts` `surfaces`) |
| --- | --- | --- | --- |
| [Asphalt 04](https://polyhaven.com/a/asphalt_04) (hero, 4K albedo) | Jenelle van Heerden, Sergej Majboroda | 4 m | `wetAsphalt` (street), `asphalt` |
| [Cracked Concrete](https://polyhaven.com/a/cracked_concrete) | Dimitrios Savva | 2 m | `concrete` (sidewalks), `pavement` |
| [Plastered Wall 03](https://polyhaven.com/a/plastered_wall_03) | Rob Tuytel | 4 m | `plasterStained` (stained render) |
| [Rusty Corrugated Iron](https://polyhaven.com/a/rusty_corrugated_iron) | Charlotte Baglioni | 2 m | `corrugated` |
| [Rounded Square Tiled Wall](https://polyhaven.com/a/rounded_square_tiled_wall) | Charlotte Baglioni | 2 m | `tiles` (small facade tiles) |
| [Weathered Planks](https://polyhaven.com/a/weathered_planks) | Dario Barresi, Dimitrios Savva | 2 m | `woodWorn` |
| [Rusty Metal Shutter](https://polyhaven.com/a/rusty_metal_shutter) | Charlotte Baglioni | 1.9 m | `shutter` (roll-up shutters) |
| [Dark Brick Wall](https://polyhaven.com/a/dark_brick_wall) | Dario Barresi, Dimitrios Savva | 1.05 m | `brickDirty` |
| [Brick Wall 001](https://polyhaven.com/a/brick_wall_001) (hero, 4K albedo) | Rob Tuytel, Dimitrios Savva | 3 m | `brick`, `darkBrick` (shop facade) |
| [Wood Floor Worn](https://polyhaven.com/a/wood_floor_worn) (hero, 4K albedo) | Dimitrios Savva | 2 m | `wood`, `floor` (shop floor, timber) |

**Original 1K sets** (`public/textures/<id>_{diff,nor_gl,rough}.jpg`): Wood Floor Worn and Brick
Wall 001 (the low-tier versions of those keys), [Grey Plaster](https://polyhaven.com/a/grey_plaster)
(`plaster`, `paint`, the shop ceiling, some street props), [Denim Fabric](https://polyhaven.com/a/denim_fabric)
(`fabric`, bench upholstery) and [Asphalt 02](https://polyhaven.com/a/asphalt_02) (kept, now unused by `surfaces`).

Quality tiers (`src/world/quality.ts`): **low** 1K maps (the original JPGs where a key has
them); **medium** 2K albedo + 1K normal/ORM; **high** starts like medium, then swaps in 2K
normal/ORM everywhere and 4K albedo on the hero sets after the first frames. KTX2 transcoding uses
three's Basis transcoder, served locally from `public/basis/`.

Regenerate with `node scripts/fetch-textures.mjs` (idempotent; `--force` re-encodes). It downloads
the 2K/4K JPG sources into a cache (`$TEXTURE_CACHE`, default `~/.cache/miso-fetch-textures`),
resizes with `sharp` and encodes with Basis Universal `basisu` (not an npm dependency: set
`$BASISU`, put it on `PATH`, or pass `--build-basisu` to build the pinned v2_1_0 source release
with cmake). It also downloads the HDRI and copies the transcoder.

## Environment

Image-based lighting (`scene.environment` only; the visible sky is the procedural gradient) uses
the [Joburg Central Sunset](https://polyhaven.com/a/sunset_jhbcentral) HDRI by Greg Zaal and
Dimitrios Savva (Poly Haven, CC0): `public/textures/hdri/sunset_jhbcentral_{1k,2k}.hdr`,
equirectangular Radiance files as published (2K on the high tier, 1K otherwise). At load
`src/world/environment-map.ts` turns the panorama so its low sun lies in the west, down the street.

## Tamashi characters

The player (Gamer), the shopkeeper (Jazz), the collector (Stonks), Inicio, the named story
characters and the street crowd are **Tamashi**. Tamashi and Nozomi © Studio Mirai.
Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. Included with
permission; **not covered by the Apache-2.0 code licence** (see the repo-root `NOTICE.md`).

- The 3D characters are procedural (`src/tamashi/`): a TV head, screen and body built at
  runtime from per-token traits hand-read from the original artwork
  (`src/tamashi/traits.json`), with a procedural animation rig (idle, walk, run, carry,
  overhead record swing, cheer). There are no model files or animation clips.
- `public/tamashi/screens/<n>.webp` are crops of the screen region of the original artwork
  for the 25 tokens whose screen shows an image rather than a face (crop boxes in
  `scripts/tamashi-screen-boxes.json`, regenerated with `scripts/tamashi-assets.mjs`).
- `public/tamashi/portraits/<n>.webp` are 256 px portraits of all 100 Tamashi, for dialogs
  and the collection.

Who plays whom (the player, the shopkeeper, the collector, the named story characters and the crowd) is set in `src/tamashi/cast.ts`; where the named ones stand is `CAST_SPOTS` in `src/world/layout.ts`.
`?gallery=1` shows all 100 in a grid, `?gallery=<id>` one up close next to its artwork.

## Original assets

The Nozomi street is procedural geometry and canvas textures generated at runtime in
`src/world/` (no model files):

- **Street and buildings** (`city.ts`, layout in `layout.ts`): the hotel, the Tamashi fitting
  center, Saisei Records, TriMart, the poster wall, the casino's back, the diner, Stonks's
  walk-up, the scorched block; soot, grime, broken windows, a procedural window atlas.
- **Props** (`street-props.ts`, `props/`): utility poles with crossarms, transformers and
  tangled cables, festival bulbs on wires, dead vending machines, the barricade, debris,
  buckets and puddles, the dead hydrant, the fans' bench; the dead Triangle sedan and the
  other dead cars (`cars.ts`, including the glass-shard smash effect); the ATM (`atm.ts`).
- **Sky and particles** (`atmosphere.ts`): the dusk gradient sky with a low western sun,
  fog, the casino roof fire's embers and smoke, wind-blown ash; optional rain (`?rain=1`).
- **Signs** (`signage.ts`): every sign is bilingual Japanese / English, drawn on one
  canvas atlas. The Triangle mark (`drawTriangleMark`) and TriMart are invented. The full
  list, with translations and placement, is [SIGNAGE.md](SIGNAGE.md) (all Japanese awaits
  native-speaker review).
- The waypoint marker, speech bubbles, section signs and Stonks's BUYING table are
  procedural too.

Record sleeve artwork, store signage, store architecture, fixtures, rain, the procedural
audio (street bed, fire crackle, the diner jukebox, the band's corner, vending hum, the
finale's boom and iron footsteps), footsteps and music demo loops are created in this
project; no samples, no real songs.

## Fonts

- DM Sans and Space Grotesk, locally bundled via Fontsource (SIL Open Font License). The
  intro and the exit-beat title card use them too.
- `public/fonts/nozomi-jp-signs.woff2`: a subset of **Noto Sans JP Bold** holding only the
  Japanese characters used on the signs, SIL Open Font License 1.1 (licence text:
  `public/fonts/OFL-NotoSansJP.txt`). Rebuilt by `scripts/subset-signage-font.sh` whenever
  `SIGNS` in `src/world/signage.ts` gains new characters.

## Workshop release covers

`public/covers/<release-slug>.png` (10 files, 512×512 PNG) are the cover art of
the fictional Miso Basecamp workshop catalog (`catalog/catalog.json`; every
artist, label and title is invented). They are workshop-owned and procedurally
generated, not AI images or third-party art: `catalog/scripts/generate-covers.ts`
draws a per-release SVG motif (seeded from the release slug, coloured from the
release palette) with the artist name and title as text, and rasterises it with
`sharp`. `scripts/organize-releases.ts` copied the 512 px PNGs to
`releases/<artist>-<release>/assets/cover-512.png`; the game copies are
byte-identical to those. The MockAdapter (automated tests only) serves them
locally; the game (testnet) loads covers from `https://cdn.miso.fm/v1/blobs/<blobId>?w=512&f=webp`.

## Real-audio test stream

In the e2e test build, `?mockhls=1` makes the MockAdapter (tests only) stream one real testnet quilt
(its quilt id is in `src/miso/mock-catalog.ts`; aac-96 HLS, 141.11 s) from
`cdn.miso.fm` for every track. Without that flag all deck audio is the
procedural synth loop (`src/audio/synth.ts`); sound effects (`src/audio/sfx.ts`)
are synthesized at runtime with no samples.

## Interface

The HUD, minimap, dialogs and intro card (`src/ui/`) are plain DOM/CSS and a 2D
canvas drawn at runtime: no icon fonts, images or third-party UI kits. Blip glyphs
(♪ $ ★ ¤ ⌂) are Unicode text in Space Grotesk. The intro's dusk gradient, CRT scanlines
and the exit-beat title card are CSS only. Record covers in menus reuse the local
`public/covers/` files (or the cdn.miso.fm cover URL on testnet).
