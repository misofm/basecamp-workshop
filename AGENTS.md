# Agent notes

This is the Miso workshop repo for Sui Basecamp 2026. Everything targets Sui testnet and prices in FakeUsd.

- Skills for this repo are in `.claude/skills/`: `verify-release` and `publish-release` for the release
  packages, `miso-read-catalog` for catalog apps, `miso-game` for the game, and `miso`, `miso-wallet`,
  `miso-record-shop`, `miso-generate-music`; and Mysten's `sui-frontend` (dApp Kit, wallets, React) and
  `sui-ts-sdk` (transactions, clients) for any Sui code. Use the skill a task names; they say exactly what to run.
- `deliveries/`: an artist's release packages (10 albums, ready to verify and publish). Their media is
  already uploaded (`media.testnet.json`), so publishing only creates parties and releases on Sui.
- `examples/`: put new apps built during the workshop here, one folder per app. It is not committed.
- `apps/spa` and `apps/game` are the finished reference apps.
- The wallet key is a file outside the repo, `~/.miso/wallet.key`. Never print, copy or commit key files
  or `apps/game/.env.local`.
