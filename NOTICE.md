# Notice

## Code

The source code in this repository is licensed under the Apache License, Version 2.0.
See [LICENSE](LICENSE).

## Catalog media and data

The generated workshop catalog is not covered by the Apache License. This includes the
audio, the cover art, the release and party metadata, and the generation prompts, in:

- `catalog/` (except the code in `catalog/scripts/`, which is Apache-2.0)
- `parties/`
- `releases/`
- `apps/game/public/covers/`
- any media for these releases fetched from Walrus or from the Miso CDN.

© Miso Labs, Inc. All rights reserved. This material is provided for the Miso workshop at
Sui Basecamp. No license to it is granted.

The audio was generated with ElevenLabs Music. All artists, people, labels and releases in
the catalog are fictional; any resemblance to real ones is coincidental.

## Third-party game assets

Textures and fonts used by the game come from third parties under their own licenses. The
game's characters are the Tamashi (below). See [apps/game/docs/ASSETS.md](apps/game/docs/ASSETS.md).

## Tamashi

Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. Included with
permission. They are not covered by the Apache License 2.0 that covers the code. This
includes:

- `apps/game/src/tamashi/traits.json`
- `apps/game/public/tamashi/`

## Third-party skills

`.claude/skills/sui-frontend` and `.claude/skills/sui-ts-sdk` are copied unchanged from
[MystenLabs/sui-dev-skills](https://github.com/MystenLabs/sui-dev-skills) (commit e365785), which recommends
committing them into projects. They remain Mysten Labs' work.
