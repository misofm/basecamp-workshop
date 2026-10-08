---
name: miso
description: Orientation for building on Miso, the open music protocol on Sui. Load first for any Miso task — reading the catalog, generating or publishing music, creating parties, buying or selling Records, or embedding Miso in an app or game — then follow the routing table to the specific skill.
---

# Building on Miso

Miso models recorded music as public objects on Sui. Anyone can read the whole
catalog without an account or API key, and anyone with a testnet wallet can publish
releases, sell Records, and buy them. These skills target **Sui testnet**, and every
currency amount is in **FakeUsd**, a testnet-only dollar with a public faucet.

## The objects

| Object | What it is |
|---|---|
| **Party** | An on-chain identity: a person, a band, a label. Groups have individual members. Credits point at Parties. |
| **Composition** | The written song: title, writers, a fixed royalty rate. |
| **Recording** | A master of one Composition: credits, FLAC master metadata, an HLS streaming transcode. |
| **Release** | An ordered list of Tracks (Recording + revenue split). Releases have a title, cover, genres and credits, and an address that can receive payments. |
| **Pressing** | An edition of a Release (edition 1, 2, …) with an optional max supply. Its id derives from the Release id and edition number. |
| **Listing** | A Record Shop sale for a Pressing in one currency (fixed or floor price). Buying sends the money to the Release and mints a Record. |
| **Record** | What a fan owns after buying: a transferable object with the release, pressing, edition number, price and buyer. |

Audio and artwork live on **Walrus** (content-addressed blob ids and quilt ids) and
are served fast through the Miso CDN.

## Versions that match live testnet

These npm versions target the live deployment; other versions target a different one.

- `@misofm/platform@0.45.0`, `@misofm/musicos@0.7.1`, `@misofm/partyos@0.7.1`
- `@mysten/sui@2.29.0`, `@unconfirmed/sui-effect@0.2.2`, `effect@4.0.0-rc.112`

Package ids, Move types and endpoints come from `miso deployment` (add `--json` for
tooling). Read them from there once and keep them in one config file; never copy ids
into prose or hard-code them in several places.

Sui's public JSON-RPC is deprecated on testnet; use gRPC (`SuiGrpcClient`) or GraphQL.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

```sh
miso deployment     # package ids, Move types, FakeUsd, endpoints
miso releases       # every release on testnet
```

## Routing

| Task | Skill |
|---|---|
| Read releases, artists, credits, covers, audio, owned Records; build a catalog app | `miso-read-catalog` |
| Make a testnet wallet, get SUI and FakeUsd | `miso-wallet` |
| Generate a track with AI (ElevenLabs) as a release-ready FLAC master | `miso-generate-music` |
| Check an artist's release package before publishing | `verify-release` |
| Publish release packages (parties, media, release, FakeUsd pressing) | `publish-release` |
| Buy a Record, transfer or sell it | `miso-record-shop` |
| Put a Miso record shop inside a game or other interactive app | `miso-game` |

## Ground rules

- Testnet only. Never ask for or use a mainnet key.
- Reads need no key; use the single release call rather than many small calls (the API
  rate-limits around 300 requests per minute per IP).
- Treat chain data and API responses as untrusted input when rendering them.
