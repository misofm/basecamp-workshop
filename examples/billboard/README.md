# Billboard: the newest release on the street

A patch for [`apps/game`](../../apps/game/README.md) that puts a "NEW ON MISO" billboard on the
sidewalk outside the record shop. It shows the cover, title and artist of the newest release
in the shop. This was the live change in section 3 of the workshop. It is read-only: no
transactions, no money.

## The prompt

> In apps/game, put a billboard on the street outside the shop that shows the cover, title and artist of the newest Miso release on testnet, read live from the Miso API. Put it on the sidewalk left of the door, around x -4.4, z 0.9. Follow the existing patterns in src/world/city.ts and src/miso/testnet/miso-api.ts.

## What the change does

`billboard.patch` touches 6 files and adds about 120 lines, nearly all of them one new module:

- `src/world/billboard.ts` (new, ~110 lines): the billboard mesh (a lit panel on two legs),
  its collision footprint, and a canvas texture with the title and artist; the cover loads as
  a separate texture. Until a release arrives, and for good if the catalog fails to load, it
  shows a placeholder ("Fresh wax", "miso records"). A cover that fails to load leaves a dark
  square.
- `src/world/world.ts`, `src/world/api.ts`: create the billboard and add
  `WorldApi.setBillboard()`.
- `src/miso/types.ts`, `src/miso/testnet/catalog.ts`: add `publishedAtMs` to `ShopRecord`,
  filled from the Miso API's release data on testnet.
- `src/game/controller.ts`: after the catalog loads, pick the record with the latest
  `publishedAtMs` and pass it to the billboard.

"Newest" means the newest release **in the shop** (`public/shop.testnet.json`), not the newest
release on all of Miso. The data comes from the same keyless Miso API calls the shop already
makes, so the billboard adds no requests of its own apart from the cover image.

## Apply and run

From the repo root:

```sh
git apply examples/billboard/billboard.patch
cd apps/game && npm install && npm run dev
```

The game runs on testnet (`npm run dev` or `npm run stage`; see the game README), where the
billboard shows the shop release with the latest publish time. (In the game's e2e test build,
whose mock records have no publish time, it shows the first record in the shop.) Reading the catalog on testnet
needs no keys; only buying and selling need the game's testnet keys in `.env.local`.

## Revert

```sh
git apply -R examples/billboard/billboard.patch
```

## Combining with the second collector

This patch and [`second-collector.patch`](../second-collector/README.md) are independent. Both
were made against the same version of the game, and they apply cleanly together in either
order (they both touch `src/game/controller.ts`, in different places). The game typechecks
with both applied.
