---
name: miso-wallet
description: Set up a Sui testnet wallet for Miso and fund it — testnet SUI for gas and FakeUsd, the testnet dollar Miso Record Shop listings are priced in. Use before publishing, buying, or transferring anything on Miso testnet, or when a transaction fails for lack of gas or FakeUsd.
---

# Testnet wallet, SUI and FakeUsd

Every Miso write is a Sui testnet transaction. You need a keypair, a little testnet SUI
for gas (well under 1 SUI covers a workshop), and FakeUsd to buy Records.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

## 1. Create the wallet

```sh
miso wallet new --out "$HOME/.miso/wallet.key"   # mode 600, prints only the address
export SUI_PRIVATE_KEY_FILE="$HOME/.miso/wallet.key"
miso wallet
```

`miso wallet new` never overwrites a file. `miso wallet` prints the address and the SUI
and FakeUsd balances. Never print the key file, never commit it, and never use a key
that holds mainnet funds. Put the `export` line in the shell profile so every new shell
has it.

## 2. Get testnet SUI

```sh
miso wallet faucet
```

The scripted faucet is refused (exit 4). The command then prints the browser faucet URL
`https://faucet.sui.io/?network=testnet` and your address. Open the URL, choose
**Testnet**, paste the address (the page cannot be prefilled), and request SUI. Run
`miso wallet` to see the new balance.

## 3. Mint FakeUsd

FakeUsd has a permissionless faucet: anyone can mint, and the caller pays the gas.

```sh
miso fakeusd mint 100              # 100 FakeUsd to your wallet
miso fakeusd mint 25 --to 0x…      # 25 FakeUsd to another address
miso wallet
```

FakeUsd has 6 decimals: 1 FakeUsd = `1_000_000` base units. `miso fakeusd mint` checks
that the wallet covers the gas before it signs and exits 6 with a `fix:` line if not.

## Troubleshooting

- Exit 6 with a `fix:` line: the wallet is short; follow the line (more SUI from step 2, or
  `miso fakeusd mint <amount>`), then rerun the command.
- Balance looks stale right after a transaction: reads are eventually consistent; rerun
  `miso wallet` after a second.
