---
name: publish-release
description: Publish verified Miso release packages to Sui testnet with `miso release publish` — parties, the release and its FakeUsd Record Shop pressing (plus Walrus media and streaming transcodes when the audio was not uploaded ahead of time), in one resumable command. Use when someone asks to publish, release, or put music on Miso; verify first with verify-release.
---

# Publish release packages

`miso release publish <dir...>` does the whole job for each package: it verifies,
creates or reuses the credited parties, stores the masters and cover on Walrus,
transcodes each master for streaming, publishes the release with its credits,
and opens the pressing and FakeUsd listing. A package with a `media.testnet.json`
had its audio uploaded ahead of time: publish skips the Walrus and transcode work for
it and only sends the Sui transactions. Rerunning the same command skips finished work.

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

```sh
export SUI_PRIVATE_KEY_FILE="$HOME/.miso/wallet.key"
```

The key file is the one `miso wallet new --out "$HOME/.miso/wallet.key"` creates (mode 600).
Never print its contents and never use a key that holds mainnet funds.

Media goes through a public Walrus testnet publisher, so no WAL is needed.

## Do this

1. **Verify.** Run the `verify-release` steps on the folder. Publish verifies again
   and refuses (exit 2) on errors.
2. **Dry run** (no gas, a few seconds). It prints the plan, the signer, the wallet
   balance and the gas estimate, and per package whether its media is already
   uploaded (`media uploaded earlier (media.testnet.json), nothing to upload`):

   ```sh
   miso release publish <folder>/*/ --dry-run
   ```

   `✓ enough` means go on. `✗ short` (exit 6) means nothing was done: follow its
   `fix:` line, then rerun this step.
3. **Publish.** Run it as a **background command** and keep the user informed from
   its output:

   ```sh
   miso release publish <folder>/*/
   ```

   Output is one line per package with its stage: `verify ✓ · parties ✓ ·
   media ✓ · stream ✓ · publish …`, with `media uploaded earlier` after it when
   the package has a `media.testnet.json`. Ten releases whose media was uploaded
   ahead of time take roughly 5 minutes, most of it creating their parties.
   Exit 0 = all published, 1 = some packages failed (the others are done),
   2 = verify refused, 6 = wallet short.
4. **If it stops or a package fails,** rerun **the exact same command**. It
   resumes from `<package>/.miso/state.testnet.json`.
5. **Report** from each `<package>/publication.testnet.json`: `title`,
   `releaseId`, the pressing (`pressing.price.amount` + `currency`,
   `pressing.maxSupply`), and the transaction link
   `https://devxplorer.io/?search=<digests.publication>&network=testnet`.
   Total gas is `gasUsedMist` (1 SUI = 1,000,000,000 MIST).

To publish one unpackaged track, make it a package first: a folder with the FLAC under
`audio/`, a square cover (at least 1400 px), a `manifest.json` (`miso schema package`
prints its schema) and a `parties.json` (`miso schema parties`). Then run verify and
the steps above on that folder.

Check a published release with `miso release show <releaseId>`.

## Don't

- Don't write `release.json` / `release-config.testnet.json` intent files by
  hand, and don't call `blobs store`, `transcode` or `party create` yourself for
  a package; `release publish` does all of it and keeps the state consistent.
- Don't delete `.miso/` folders.
- Don't generate or modify audio here.
- Don't rerun with a different signer: parties and state belong to the wallet
  that started the run.
