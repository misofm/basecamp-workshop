# Embedded assets

All assets are served locally by this application. Runtime gameplay does not call an asset provider.

## Materials

Scanned PBR texture sets from [Poly Haven](https://polyhaven.com), downloaded at 1K resolution:

- [Wood Floor Worn](https://polyhaven.com/a/wood_floor_worn): floor and timber furniture.
- [Brick Wall 001](https://polyhaven.com/a/brick_wall_001): masonry.
- [Grey Plaster](https://polyhaven.com/a/grey_plaster): ceiling, painted surfaces, and pavement.
- [Asphalt 02](https://polyhaven.com/a/asphalt_02): street.
- [Denim Fabric](https://polyhaven.com/a/denim_fabric): bench upholstery.

Files are in `public/textures/`. Each includes diffuse color, OpenGL normal, and roughness maps.
Poly Haven assets are [CC0](https://polyhaven.com/license). The public API was used only during local asset preparation; there is no live API integration.

## Tamashi characters

The player, the shop clerk, the collector and the street crowd are **Tamashi**.
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

The city (buildings with a procedural window atlas, streets, crosswalks, streetlights,
props), all cars (traffic and parked, including the glass-shard smash effect), the
waypoint marker, speech bubbles, section signs and the collector's tote are procedural geometry and canvas
textures generated at runtime in `src/world/`.

Record sleeve artwork, store signage, store architecture, fixtures, traffic, rain,
procedural audio ambience, footsteps, and music demo loops are created in this project.
Fonts are DM Sans and Space Grotesk, locally bundled via Fontsource (SIL Open Font License).

## Workshop release covers

`public/covers/<release-slug>.png` (10 files, 512×512 PNG) are the cover art of
the fictional Miso Basecamp workshop catalog (`catalog/catalog.json`; every
artist, label and title is invented). They are workshop-owned and procedurally
generated, not AI images or third-party art: `catalog/scripts/generate-covers.ts`
draws a per-release SVG motif (seeded from the release slug, coloured from the
release palette) with the artist name and title as text, and rasterises it with
`sharp`. `scripts/organize-releases.ts` copied the 512 px PNGs to
`releases/<artist>-<release>/assets/cover-512.png`; the game copies are
byte-identical to those. In mock mode the game serves them locally; on testnet
covers come from `https://cdn.miso.fm/v1/blobs/<blobId>?w=512&f=webp`.

## Real-audio test stream

With `?mockhls=1` the mock adapter streams one real testnet quilt
(its quilt id is in `src/miso/mock-catalog.ts`; aac-96 HLS, 141.11 s) from
`cdn.miso.fm` for every track. Without that flag all deck audio is the
procedural synth loop (`src/audio/synth.ts`); sound effects (`src/audio/sfx.ts`)
are synthesized at runtime with no samples.

## Interface

The HUD, minimap, dialogs and intro card (`src/ui/`) are plain DOM/CSS and a 2D
canvas drawn at runtime: no icon fonts, images or third-party UI kits. Blip glyphs
(♪ $ ★) are Unicode text in Space Grotesk. Record covers in menus reuse the local
`public/covers/` files (or the cdn.miso.fm cover URL on testnet).
