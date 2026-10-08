---
name: verify-release
description: Verify an artist's Miso release package (manifest.json, parties.json, cover, FLAC masters) before publishing — offline, with `miso release verify`. Use whenever someone hands over release packages or a deliveries folder and asks to check, validate, or verify them, and always before publish-release.
---

# Verify a release package

A release package is a directory with a `manifest.json` (format
`miso.release-package/1`), a cover, `audio/*.flac`, and a `parties.json` either in
the package or in its parent folder. A package may also hold a `media.testnet.json`:
the audio was uploaded ahead of time, and verify checks that its blob ids match the
local cover and masters. The Miso CLI verifies it offline: no wallet, no network.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

Install ffmpeg (it includes ffprobe): `brew install ffmpeg` on macOS,
`sudo apt-get install -y ffmpeg` on Debian or Ubuntu.

## Do this

1. **Find the packages.** Each package directory contains a `manifest.json`.
   For a deliveries folder, that is every subdirectory:
   `ls <folder>/*/manifest.json`.
2. **Run verify on all of them in one go:**

   ```sh
   miso release verify <folder>/*/
   ```

3. **Read the result.** One table per package (✓ pass, ! warning, ✗ error) and a
   summary line: `verify: N packages — R ready, E with errors (…)`. Exit code 0
   means every package can be published; warnings don't block.
4. **If there are errors,** apply the `fix:` line printed under each failing row,
   exactly as written, **from that package's directory**, then rerun step 2.
   Mechanical fixes (re-mastering a file with `miso master`, pointing
   `tracks[i].file` at the new master, a file path) are yours to apply. Ask
   the user before changing anything artistic: titles, credits, prices, genres,
   or cover art.
5. **Report briefly:** packages verified, tracks, parties, any warnings that
   remain, and whether everything is ready for `publish-release`.

## Masters

The Miso transcoder rejects masters whose AAC renditions would clip. `miso release verify`
warns above its true-peak target (`-4` dBTP by default, see `miso release verify --help`)
and errors far above it. `miso master` brings a file to its target (`-4` dBTP by default,
see `miso master --help`) with a plain gain change and writes a STREAMINFO-only FLAC:

```sh
miso master track.wav --out audio/01-track.flac
```

## Don't

- Don't convert or edit audio with other tools; `miso master` is the only fix.
- Don't publish from this skill. Publishing is `publish-release`.
