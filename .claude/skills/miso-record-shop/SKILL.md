---
name: miso-record-shop
description: Buy a Record from a Miso Record Shop listing with FakeUsd, list the Records a wallet owns, transfer a Record, and sell one to another party — from the terminal, or from a web app where the visitor connects a Sui wallet and buys. Use for any Miso purchase, ownership, gifting or resale flow on Sui testnet, including a Buy button or Connect wallet in an app.
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

## Buy from a web app (the visitor's Sui wallet)

A browser app never holds a key: the visitor connects a wallet (Slush or any Wallet Standard wallet) with
Mysten's dApp Kit, and the wallet signs. Install the two packages:

```sh
npm install @mysten/sui@^2.35.0 @mysten/dapp-kit-react@^2.1.39
```

Wrap the app once and show the kit's own Connect button (it opens the wallet picker and shows the
connected account):

```tsx
import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: "https://fullnode.testnet.sui.io:443" }),
  autoConnect: true,
  slushWalletConfig: { appName: "My Record Shop" },
});

// <DAppKitProvider dAppKit={dAppKit}> <ConnectButton /> … </DAppKitProvider>
```

The buy is one transaction of plain Move calls. The ids are the live testnet ones (`miso deployment --json`
prints the same values). Read the price from the Miso API listing
(`GET https://api.testnet.miso.fm/v1/platform/pressings/{pressingId}/listing?currencyType=<FAKEUSD_TYPE>`
returns `pricing: { kind: "fixed" | "floor", amount }` in FakeUsd base units, 6 decimals, and `state`):

```ts
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeStructTag } from "@mysten/sui/utils";

const RECORD_PACKAGE = "0xf51af0e4a29d764a6880db65d99aaa7d1802774f7be18e7220a05a2d673b4743";
const RECORD_SHOP_PACKAGE = "0x6eb622211786516988c6ee8e7c0403b4ef64a8c004d654494122e29c103060e1";
const FAKEUSD_TYPE = "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd";

/** Pressing (edition 1 is the release's record) and its FakeUsd listing, derived from the release id. */
export const pressingId = (releaseId: string, edition = 1) =>
  deriveObjectID(releaseId, `${RECORD_PACKAGE}::pressing::PressingKey`, bcs.u16().serialize(edition).toBytes());
export const listingId = (pressing: string) =>
  deriveObjectID(pressing, `${RECORD_SHOP_PACKAGE}::listing::ListingKey<${normalizeStructTag(FAKEUSD_TYPE)}>`, new Uint8Array([0]));

/** Buy the next copy of a release's record; the wallet pays the price in FakeUsd and gas in SUI. */
export function buyRecord(releaseId: string, pricing: { kind: "fixed" | "floor"; amount: bigint }, buyer: string) {
  const pressing = pressingId(releaseId);
  const tx = new Transaction();
  tx.setSender(buyer);
  const payment = tx.balance({ balance: pricing.amount, type: FAKEUSD_TYPE, useGasCoin: false });
  const expected = tx.moveCall({ target: `${RECORD_SHOP_PACKAGE}::listing::${pricing.kind}`, arguments: [tx.pure.u64(pricing.amount)] });
  const record = tx.moveCall({
    target: `${RECORD_SHOP_PACKAGE}::listing::purchase`,
    typeArguments: [FAKEUSD_TYPE],
    arguments: [tx.object(listingId(pressing)), tx.object(pressing), payment, expected, tx.object.clock()],
  });
  tx.transferObjects([record], buyer);
  return tx;
}
```

In a component, sign with the connected wallet and show the result:

```tsx
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";

const account = useCurrentAccount();
const kit = useDAppKit();
// on click (account connected, listing.state === "enabled"):
const result = await kit.signAndExecuteTransaction({ transaction: buyRecord(releaseId, { kind, amount: BigInt(amount) }, account.address) });
// success: link https://devxplorer.io/?search=<digest>&network=testnet (the digest is in the result)
```

The visitor needs testnet SUI for gas (https://faucet.sui.io/?network=testnet; paste the address) and
FakeUsd for the price. A "Get 100 FakeUsd" button is one more transaction the wallet signs:

```ts
export function mintFakeUsd(recipient: string, amount = 100_000_000n /* 100 FakeUsd */) {
  const tx = new Transaction();
  tx.setSender(recipient);
  const balance = tx.moveCall({
    target: "0xa31234471b3644f55fee16b4d5a2a12a161efc5f05e43c2feb34b4b949adcb1c::faucet::mint",
    typeArguments: [FAKEUSD_TYPE],
    arguments: [tx.pure.u64(amount), tx.object("0xa3babc5ccf3018c0a743c3a6ee880adb4424a885ef4ca1e62645da7e460897b6")],
  });
  const coin = tx.moveCall({ target: "0x2::coin::from_balance", typeArguments: [FAKEUSD_TYPE], arguments: [balance] });
  tx.transferObjects([coin], recipient);
  return tx;
}
```

A purchase that fails with "Insufficient balance" means the wallet lacks the FakeUsd price: mint first.
The price passed to `listing::purchase` must equal the listing's current price, or it aborts (no overcharge).

## Gotchas

- Prices in the API are base units: `12000000` = 12 FakeUsd. The CLI prints whole FakeUsd.
- Reads are eventually consistent: after a transaction, wait a second, then rerun
  `miso records` or `miso wallet`.
