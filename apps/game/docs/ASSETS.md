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

## Character and animation

`public/models/player-male.glb` embeds the male **Soldier / Vanguard** character
and its original idle/walk/run animations from Adobe Mixamo, distributed with the
[Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf).
The model is normalized to 1.82 m and its right-hand bone carries the record item.
This is a placeholder character for the interactive prototype.
See [Adobe's Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
for permitted project uses. These assets are embedded in the game, not offered as
a standalone asset library.

`public/models/visitor.glb` is **Michelle** (Mixamo character "Ch03", material `Ch03_Body`)
with Idle / Walk / Run clips, as distributed in the
[Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf)
(`Michelle.glb`). It is used for street pedestrians and the shop clerk. The male rig
above is also reused (cloned via SkeletonUtils) for pedestrians and the collector NPC.
Each NPC gets cloned, colour-tinted materials; the collector's hat and headphones are
procedural geometry. Same Mixamo terms apply. The overhead "record swing" is a
procedural bone rotation in `src/world/player.ts`, not a Mixamo clip.

The previous Michelle/Ch03 retargeting source and preparation script remain under
`scripts/` for development reference.

## Original assets

The city (buildings with a procedural window atlas, streets, crosswalks, streetlights,
props), all cars (traffic and parked, including the glass-shard smash effect), the
waypoint marker, speech bubbles and section signs are procedural geometry and canvas
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
