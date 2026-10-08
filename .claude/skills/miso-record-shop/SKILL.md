---
name: miso-record-shop
description: Buy a Record from a Miso Record Shop listing with FakeUsd, list the Records a wallet owns, transfer a Record, and sell one to another party. Use for any Miso purchase, ownership, gifting or resale flow on Sui testnet.
---

# Record Shop: buy, own, transfer, sell

A **Pressing** is an edition of a Release; its **Listing** sells it in one currency.
Buying sends the payment to the Release's address (where the protocol splits it
between the tracks' rights holders) and mints a **Record** to the buyer. A Record is a
normal Sui object with `key + store`: its owner can transfer it like any other object.

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
export SUI_PRIVATE_KEY_FILE="$HOME/.miso/wallet.key"
```

The key file is the one `miso wallet new --out "$HOME/.miso/wallet.key"` creates (mode 600).
Never print its contents and never use a key that holds mainnet funds.

The wallet needs SUI for gas and FakeUsd for the price (`miso-wallet` skill: `miso wallet`,
`miso wallet faucet`, `miso fakeusd mint <amount>`).

## Find something to buy

```sh
miso releases                      # every release: id, title, artist
miso release show <releaseId>      # tracks, cover, streams, pressing supply, FakeUsd price
```

`release show` prints a `recordShop` block: edition, pressing id, supply, max supply, and
the listing (kind, price, state, currency).

## Buy

```sh
miso record buy <releaseId> --dry-run     # price, gas and the would-be Record; nothing is signed
miso record buy <releaseId>               # buys edition 1; prints the new Record id
miso record buy <releaseId> --edition 2   # buys another edition
```

`miso record buy` simulates first and checks the wallet covers the FakeUsd price and the
gas. If it does not, it exits 6 before signing, with a `fix:` line (for example
`miso fakeusd mint 9`); follow it and rerun. A buy fails with a message when the
listing is disabled or the pressing reached its max supply (sold out).

## Own

```sh
miso records                  # Records the wallet owns
miso records <address>        # Records another address owns
```

## Transfer (gift)

```sh
miso record transfer <recordId> <toAddress> --dry-run
miso record transfer <recordId> <toAddress>
```

The signer must own the Record. It keeps its history (release, pressing, edition
number, original price and buyer).

## Sell to someone else

Two independent owners cannot co-sign a single Sui transaction, so a trustless swap
needs an escrow contract or a Kiosk. For a demo or game, this is enough:

1. The seller sends the Record to the buyer: `miso record transfer <recordId> <buyerAddress>`.
2. The buyer's service checks the transaction on chain: it succeeded, it moved that
   Record (the type is `types.record` in `miso deployment --json`) from the seller to the
   buyer, and the digest has not been paid before.
3. The buyer pays the seller: `miso fakeusd mint <amount> --to <sellerAddress>`.

Say plainly in the product that the buyer pays after delivery. The `miso-game` skill
shows this as an NPC collector whose game wallet pays after delivery.

## Gotchas

- Prices in the API are base units: `12000000` = 12 FakeUsd. The CLI prints whole FakeUsd.
- Reads are eventually consistent: after a transaction, wait a second, then rerun
  `miso records` or `miso wallet`.
