# Second collector: the house digger

> **Out of date:** this patch was made against the earlier version of the game that had a
> Bun bank server (`apps/game/server/`, `src/miso/testnet/bank.ts`, `burner.ts`). The game now
> runs without a server, on two baked-in testnet keys, so the patch's testnet and server
> hunks no longer apply. To try it as written, check out commit `cc23ffb` first. On the
> current game the same idea lives in `src/miso/testnet/sell.ts`: the GAME wallet's payout
> would take the buyer's offer rule.

A patch for [`apps/game`](../../apps/game/README.md) that adds a second street buyer, the
**house digger**, across the street from the collector. He pays 2× the shop price, but only
for records from the HOUSE section, and politely turns down anything else.

## The prompt

The stretch goal of section 3 was "a second collector who pays 2× for HOUSE records". It was
shown from a prepared branch rather than built live, because it is bigger than it looks: the
game assumed exactly one buyer who can be away at a time, and the server's payout rate was a
single constant.

## What the change does

`second-collector.patch` touches 14 files: about 320 lines added and 50 changed, including
two new test files (90 lines).

- **Game rules** (`src/game/npc-buyers.ts`): buyers become a list of profiles. A profile can be
  limited to one shop section; the house digger is `section: "HOUSE"` with a 2/1 offer.
- **Street flow** (`src/game/flows/street-flow.ts`, `src/game/controller.ts`, `src/debug.ts`):
  either buyer can be approached; the house digger refuses non-HOUSE records with a toast; only
  one buyer can be away at a time, so selling to one calls the other back.
- **World** (`src/world/npcs.ts`, `src/world/layout.ts`): a second NPC with its own spot, purple
  ring, gear and lines, and its own walk-off and return.
- **Testnet** (`src/miso/testnet/backend.ts`, `bank.ts`, `testnet-adapter.ts`): the sale sends
  `npcId` to the bank server. The Record still goes to the bank's single collector address; the
  house digger is a second face on the same wallet.
- **Bank server** (`server/collector.ts`, `server/index.ts`): `POST /api/collector/buy` accepts
  `npcId`. With `npcId: "buyer:house"` it pays 2× (same cap), but only if the Record's release is
  a HOUSE entry in `public/shop.testnet.json`; the release is read from the Record on chain.
  Otherwise it pays the normal 1.5×, since the Record has already moved by then.
- **Docs and tests**: `README.md` (loop step 6, architecture, endpoint),
  `tests/unit/npc-buyers.spec.ts` and `tests/e2e/house-digger.spec.ts` (mock mode).

## Apply and run

From the repo root:

```sh
git apply examples/second-collector/second-collector.patch
cd apps/game && npm install && npm run dev
```

Mock mode (`npm run dev`) runs the whole thing with fake money: buy Warehouse Gospel (HOUSE),
walk across the street, sell it for 2×. On testnet (at commit `cc23ffb`), real payouts needed
the bank server with your own funded keys.

Tests: `npm run test:unit` covers the offer rules; `npx playwright test tests/e2e/house-digger.spec.ts`
plays the refusal and the 2× sale in mock mode.

## Revert

```sh
git apply -R examples/second-collector/second-collector.patch
```

## Combining with the billboard

This patch and [`billboard.patch`](../billboard/README.md) are independent. Both were made
against the same version of the game, and they apply cleanly together in either order (they
both touch `src/game/controller.ts`, in different places). The game typechecks with both
applied.
