---
name: miso-game
description: Embed Miso in a video game or other interactive 3D/2D app — an in-game record shop whose records are real Miso releases, previews streamed from the CDN, purchases that mint Records with FakeUsd on Sui testnet, a FakeUsd cash machine, and player-to-NPC resale. Use when designing or building game, metaverse, or interactive experiences on Miso.
---

# Miso inside a game

The point to land: music infrastructure can power a *place*, not just a catalog page.
A player walks into a shop, flips through crates of real releases, listens on a
turntable, buys a Record that exists on chain, and can carry it, gift it or sell it.

Everything below runs in the browser: no server, no wallet pop-ups. It is complete and
checked against live testnet as written: copy the module in step 2, fill in its config,
and wire it into the game as in step 3. There is no need to probe the SDK or the API first.

## Setup

```sh
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone https://github.com/misofm/cli ~/miso-cli && (cd ~/miso-cli && bun install && bun link)
miso --help
```

`bun link` installs the `miso` command from the CLI's `bin` entry into `~/.bun/bin`; the
`export PATH` line puts it on `PATH`.

The game depends on exactly `@mysten/sui@2.29.0` and `@misofm/platform@0.45.0` (other
versions target a different deployment). Check `package.json`; `npm i` them only when
they are missing or at another version.

## 1. Two wallets, baked into the testnet build

A game has two signers:

- the **player** wallet: buys Records, withdraws FakeUsd at the cash machine, hands a
  Record to an NPC;
- the **game** wallet: the world itself, for example the NPC collector who receives a
  sold Record and pays for it.

For a testnet game both are `suiprivkey1…` Ed25519 keys in build-time env vars (Vite:
`VITE_…` in `.env.local`, read with `import.meta.env`). Each pays its own gas in testnet
SUI; FakeUsd comes from its permissionless faucet. Build-time vars end up in the shipped
JavaScript: testnet keys only, never log them, and a hosted keyed build sits behind
access control.

## 2. The Miso module

Run `miso deployment --json` and copy these fields into the config block:
`result.recordSales.recordPackageId`, `result.recordSales.recordShopPackageId`,
`result.fakeUsd.type`, `result.fakeUsd.mint`, `result.fakeUsd.treasury`. Keep every
Sui SDK import in this one module and load it with `import()` from the adapter, so the
SDK stays out of the main bundle.

```ts
// miso.ts — all Miso / Sui access. Config from `miso deployment --json`.
const RECORD_PACKAGE_ID = "0x…";       // result.recordSales.recordPackageId
const RECORD_SHOP_PACKAGE_ID = "0x…";  // result.recordSales.recordShopPackageId
const FAKE_USD_TYPE = "0x…::fakeusd::FakeUsd"; // result.fakeUsd.type (6 decimals)
const FAKE_USD_MINT = "0x…::faucet::mint";     // result.fakeUsd.mint
const FAKE_USD_TREASURY = "0x…";               // result.fakeUsd.treasury
const RECORD_TYPE = `${RECORD_PACKAGE_ID}::record::Record`;
const MISO_API = "https://api.testnet.miso.fm/v1";
const MISO_CDN = "https://cdn.miso.fm/v1";

import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { deriveSaleIds, purchaseRecord } from "@misofm/platform/pressing";

export const sui = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io" });

export function keypair(suiprivkey: string): Ed25519Keypair {
  const { secretKey } = decodeSuiPrivateKey(suiprivkey.trim());
  return Ed25519Keypair.fromSecretKey(secretKey);
}

/** GET JSON; retries 429 / 5xx (the API answers 503 to a burst) with backoff. */
async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json() as Promise<T>;
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`HTTP ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
}

/** One shelf entry, hydrated: release (title, artist, cover, tracks), pressing supply, FakeUsd price. */
export async function loadShopRecord(releaseId: string, edition: number) {
  const { pressingId, listingId } = deriveSaleIds(releaseId, edition, FAKE_USD_TYPE, RECORD_PACKAGE_ID, RECORD_SHOP_PACKAGE_ID);
  const [release, pressing, listing] = await Promise.all([
    getJson<any>(`${MISO_API}/protocol/releases/${releaseId}?include=trackCredits`),
    getJson<any>(`${MISO_API}/platform/pressings/${pressingId}`),
    getJson<any>(`${MISO_API}/platform/pressings/${pressingId}/listing?currencyType=${encodeURIComponent(FAKE_USD_TYPE)}`),
  ]);
  const primary = (release.credits ?? []).filter((c: any) => c.roles.includes("Primary")).map((c: any) => c.displayName);
  const labelCredit = Object.values(release.trackCredits ?? {}).flatMap((t: any) => t.recordingCredits?.credits ?? []).find((c: any) => c.roles.includes("Label"));
  return {
    releaseId,
    edition,
    pressingId,
    listingId,
    title: release.title as string,
    artist: (primary.length ? primary : release.primaryArtists ?? []).join(", ") as string,
    genre: (release.genres?.[0] ?? "") as string,
    label: (labelCredit?.displayName ?? "Independent") as string,
    description: (release.description ?? "") as string,
    year: new Date(release.publishedAtMs ?? Date.now()).getUTCFullYear(),
    coverUrl: release.cover?.still?.blobId ? `${MISO_CDN}/blobs/${release.cover.still.blobId}?w=512&f=webp` : "",
    tracks: (release.tracks ?? []).map((t: any, index: number) => ({
      index,
      title: t.title as string,
      quiltId: (t.transcodeQuiltId ?? null) as string | null, // HLS: `${MISO_CDN}/blobs/by-quilt-id/${quiltId}/aac-96.m3u8`
      durationSec: Number(t.master?.samples ?? 0) / Number(t.master?.sample_rate_hz ?? 44100),
    })),
    minted: pressing.supply as number,
    maxSupply: pressing.maxSupply as number,
    /** Base units (6 decimals). Pass back unchanged to purchaseTx. */
    pricing: { kind: listing.pricing.kind as "fixed" | "floor", amount: BigInt(listing.pricing.amount) },
    onSale: listing.state === "enabled",
  };
}

/** SUI (MIST) and FakeUsd (base units) of an address. */
export async function balances(owner: string) {
  const [s, f] = await Promise.all([
    sui.core.getBalance({ owner, coinType: "0x2::sui::SUI" }),
    sui.core.getBalance({ owner, coinType: FAKE_USD_TYPE }),
  ]);
  return { sui: BigInt(s.balance.balance), fakeUsd: BigInt(f.balance.balance) };
}

/** Buy one Record of `edition`, paid in FakeUsd from the buyer's wallet, minted to the buyer. */
export function purchaseTx(releaseId: string, edition: number, pricing: { kind: "fixed" | "floor"; amount: bigint }, buyer: string) {
  const tx = new Transaction();
  tx.setSender(buyer);
  tx.add(purchaseRecord({
    releaseId, edition,
    paymentAmount: pricing.amount,
    expectedPricing: pricing, // aborts if the price changed since the catalog read
    currencyType: FAKE_USD_TYPE,
    recipient: buyer,
    recordPackageId: RECORD_PACKAGE_ID,
    recordShopPackageId: RECORD_SHOP_PACKAGE_ID,
  }));
  return tx;
}

/** Mint `amount` FakeUsd (base units) from the public faucet to `recipient`; `sender` pays the gas. */
export function mintFakeUsdTx(amount: bigint, sender: string, recipient: string) {
  const tx = new Transaction();
  tx.setSender(sender);
  const balance = tx.moveCall({ target: FAKE_USD_MINT, typeArguments: [FAKE_USD_TYPE], arguments: [tx.pure.u64(amount), tx.object(FAKE_USD_TREASURY)] });
  const coin = tx.moveCall({ target: "0x2::coin::from_balance", typeArguments: [FAKE_USD_TYPE], arguments: [balance] });
  tx.transferObjects([coin], recipient);
  return tx;
}

/** Hand an owned object (a Record) to another address. */
export function transferTx(objectId: string, sender: string, recipient: string) {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.transferObjects([tx.object(objectId)], recipient);
  return tx;
}

/**
 * Sign, execute and wait until final. One transaction at a time per signer, so two
 * actions never race for the same gas coin. `recordId`: the Record the tx created, if any.
 */
const queues = new Map<string, Promise<unknown>>();
export function run(tx: Transaction, signer: Ed25519Keypair): Promise<{ digest: string; recordId: string | null }> {
  const key = signer.toSuiAddress();
  const job = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const result = await sui.core.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
    const t = result.Transaction ?? result.FailedTransaction;
    if (!t.status.success) throw new Error(`Transaction failed: ${t.status.error?.message ?? "unknown"}`);
    await sui.core.waitForTransaction({ digest: t.digest, pollSchedule: [500, 1500, 3000] });
    const created = t.effects.changedObjects.filter((c) => c.idOperation === "Created").map((c) => c.objectId);
    return { digest: t.digest, recordId: created.find((id) => t.objectTypes[id] === RECORD_TYPE) ?? null };
  });
  queues.set(key, job.catch(() => undefined));
  return job;
}

/** One Record's serial in its edition (e.g. 7 of 250), read right after a purchase. */
export async function recordSerial(recordId: string): Promise<number> {
  const { object } = await sui.core.getObject({ objectId: recordId, include: { json: true } });
  return Number((object.json as any)?.number ?? 0);
}

/** Records an address owns, with what the chain stores on each. */
export async function ownedRecords(owner: string) {
  const out: { recordId: string; releaseId: string; number: number; purchasePrice: bigint; purchasedAtMs: number }[] = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof sui.core.listOwnedObjects>> = await sui.core.listOwnedObjects({ owner, type: RECORD_TYPE, include: { json: true }, limit: 50, cursor });
    for (const o of page.objects) {
      const j = o.json as any;
      out.push({ recordId: o.objectId, releaseId: j.release_id, number: Number(j.number), purchasePrice: BigInt(j.purchase_price), purchasedAtMs: Number(j.purchased_timestamp_ms) });
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return out;
}
```

`release_id` on a Record is the release it was pressed from; `number` is its serial in
the edition (1 of `maxSupply`).

## 3. Wire it into the game

| Game action | Call |
|---|---|
| Fill the shelves | `loadShopRecord(releaseId, edition)` for every entry of the game's shelf list, all in parallel (`Promise.allSettled`). Skip an entry that fails or has `onSale: false`, with a `console.warn`. Keep `pricing` per release for the purchase. |
| Show the cash | `balances(player.toSuiAddress())`. |
| Buy at the counter | `run(purchaseTx(releaseId, edition, pricing, player.toSuiAddress()), player)`; `recordId` is the new Record. |
| Cash machine / ATM | `run(mintFakeUsdTx(amount, player.toSuiAddress(), player.toSuiAddress()), player)`. |
| The player's collection | `ownedRecords(player.toSuiAddress())`, joined to the shelf data by `releaseId` for title, artist and cover. |
| Sell to an NPC | Two transactions, because one Sui transaction has one sender: `run(transferTx(recordId, playerAddress, gameAddress), player)`, then the game pays with `run(mintFakeUsdTx(offer, gameAddress, playerAddress), game)`. Return the payout's digest. |
| Receipt links | `https://suiscan.xyz/testnet/tx/<digest>`, `https://suiscan.xyz/testnet/object/<id>` (or the game's own explorer helper). |

Reads lag writes by a few seconds: right after a purchase or sale, `ownedRecords` can
still miss the new Record or still list the sold one. Keep the Records bought and sold
this session in memory for two minutes and merge them into every collection read:
add bought ones the read misses, drop sold ones it still returns.

Create the keypairs once (lazily, on the first wallet call). When a key is missing or
does not parse, the catalog still loads and every wallet call rejects with a short
message such as "The till's offline." (log which env var is missing to the console).

## 4. Errors the player can read

Every rejection is an `Error` whose message is one short sentence in game language. Give
it a `kind` so the game can react (for example point a player who is short on cash at
the cash machine):

```ts
export class PlayerError extends Error {
  constructor(message: string, readonly kind: "fusd" | "gas" | "soldOut" | "priceChanged" | "network" | "timeout" | "other" = "other") {
    super(message);
    this.name = "PlayerError";
  }
}

export function toPlayerError(error: unknown, fallback: string): PlayerError {
  if (error instanceof PlayerError) return error;
  console.warn("[miso]", error);
  const text = error instanceof Error ? error.message : String(error);
  if (/Insufficient balance of \S*fakeusd::FakeUsd/i.test(text)) return new PlayerError("Not enough cash for that.", "fusd");
  if (/Insufficient balance of \S*sui::SUI|No valid gas coins|InsufficientGas|GasBalanceTooLow/i.test(text)) return new PlayerError("The till's offline. Try later.", "gas");
  const abort = /abort code:\s*(\d+),\s*in '0x[0-9a-f]+::(\w+)::/i.exec(text);
  if (abort?.[2] === "pressing" && abort[1] === "4") return new PlayerError("Sold out.", "soldOut");
  if (abort?.[2] === "listing" && abort[1] === "4") return new PlayerError("Price changed. Reload.", "priceChanged");
  if (abort?.[2] === "listing" && abort[1] === "2") return new PlayerError("Not on sale right now.");
  if (/timed out|DEADLINE_EXCEEDED|TimeoutError/i.test(text)) return new PlayerError("That took too long. Try again.", "timeout");
  if (/Failed to fetch|NetworkError|UNAVAILABLE|fetch failed/i.test(text)) return new PlayerError("Connection dropped. Try again.", "network");
  return new PlayerError(fallback);
}
```

A purchase the buyer cannot afford fails while the transaction is built ("Insufficient
balance of …FakeUsd"), before anything is signed: nothing is minted silently.

## 5. Covers and the turntable

Covers (`coverUrl`) load directly as `<img>` or WebGL textures (CORS `*`). The CDN only
hosts media Miso uploaded; on a 404 load the same path from the Walrus aggregator
`https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>` (no `?w=` resizing).

Stream `https://cdn.miso.fm/v1/blobs/by-quilt-id/{quiltId}/aac-96.m3u8` with `hls.js`
into an `<audio>` element and route it through Web Audio (a `PannerNode` gives
positional sound that fades as the player walks away). Preview 30 seconds from the
middle of the track with a short fade-in and fade-out, as the official app does.

## Staging

- Fund both wallets with testnet SUI before going on stage (`miso-wallet` skill). One
  buy-and-sell loop costs well under 0.01 SUI.
- Records bought in the game show up in any Miso app right away, for example a catalog
  page at `?address=<player address>`. That moment is the demo's payoff.
