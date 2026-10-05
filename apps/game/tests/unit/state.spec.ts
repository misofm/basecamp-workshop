import { expect, test } from "@playwright/test";
import {
  canGoHome,
  canLeaveShop,
  initialState,
  recordPlace,
  transition,
  type GameAction,
  type GameState,
} from "../../src/game/state";
import { objective } from "../../src/game/objectives";
import type { OwnedRecord } from "../../src/miso/types";

const owned = (shopRecordId: string, recordId = "0xrec1"): OwnedRecord => ({
  recordId,
  shopRecordId,
  title: "Low Tide Tapes",
  artist: "Harbor Lights",
  coverUrl: "/covers/low-tide-tapes.png",
  serial: 106,
  maxSupply: 250,
  acquiredAt: 1,
});

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(transition, state);

/** Holding an owned Record of low-tide-tapes, in the shop. */
function boughtState(): GameState {
  return run(
    initialState(),
    { type: "setZone", zone: "shop" },
    { type: "walletLoaded", balance: 100_000_000n },
    { type: "pick", shopRecordId: "low-tide-tapes" },
    { type: "purchaseStart" },
    {
      type: "purchaseSuccess",
      owned: owned("low-tide-tapes"),
      digest: "D1",
      balance: 88_000_000n,
      amount: 12_000_000n,
    },
  );
}

test("full happy path: pick, deck, play, take, buy, smash, sell", () => {
  let s = initialState();
  expect(objective(s).target).toBe("shop-door");
  s = run(s, { type: "setZone", zone: "shop" }, { type: "walletLoaded", balance: 100_000_000n });
  expect(objective(s).target).toBeNull();

  s = transition(s, { type: "pick", shopRecordId: "low-tide-tapes" });
  expect(s.hand).toEqual({ shopRecordId: "low-tide-tapes", recordId: null });
  expect(recordPlace(s, "low-tide-tapes")).toBe("hand");
  expect(objective(s).target).toBe("deck");

  s = transition(s, { type: "placeOnDeck" });
  expect(recordPlace(s, "low-tide-tapes")).toBe("deck");
  s = transition(s, { type: "play" });
  expect(s.playing).toEqual({ trackIndex: 0 });
  expect(s.listened).toContain("low-tide-tapes");
  s = transition(s, { type: "nextTrack", trackCount: 5 });
  expect(s.playing).toEqual({ trackIndex: 1 });

  s = transition(s, { type: "takeFromDeck" });
  expect(s.playing).toBeNull();
  expect(s.deck).toBeNull();
  expect(objective(s).target).toBe("cashier");

  s = transition(s, { type: "purchaseStart" });
  expect(s.op).toMatchObject({ kind: "purchase", status: "pending", targetId: "low-tide-tapes" });
  s = transition(s, {
    type: "purchaseSuccess",
    owned: owned("low-tide-tapes"),
    digest: "D1",
    balance: 88_000_000n,
    amount: 12_000_000n,
  });
  expect(s.op).toBeNull();
  expect(s.hand).toEqual({ shopRecordId: "low-tide-tapes", recordId: "0xrec1" });
  expect(s.balance).toBe(88_000_000n);
  expect(s.owned).toHaveLength(1);
  expect(s.lastReceipt).toMatchObject({ kind: "purchase", digest: "D1", amount: 12_000_000n });
  expect(canLeaveShop(s)).toBe(true);
  expect(objective(s).target).toBe("shop-door");

  s = transition(s, { type: "setZone", zone: "street" });
  expect(objective(s).target).toBe("car");
  s = transition(s, { type: "smash", carId: "car:1" });
  expect(s.smashedCars).toEqual(["car:1"]);
  expect(s.hand?.recordId).toBe("0xrec1"); // record survives
  expect(objective(s).target).toBe("buyer");

  s = transition(s, { type: "sellStart", npcId: "buyer:collector" });
  expect(s.op).toMatchObject({ kind: "sell", status: "pending" });
  s = transition(s, { type: "sellSuccess", paid: 20_000_000n, digest: "D2", balance: 108_000_000n });
  expect(s.hand).toBeNull();
  expect(s.owned).toHaveLength(0);
  expect(s.sold).toEqual([
    { recordId: "0xrec1", shopRecordId: "low-tide-tapes", npcId: "buyer:collector", paid: 20_000_000n },
  ]);
  expect(s.balance).toBe(108_000_000n);
  expect(recordPlace(s, "low-tide-tapes")).toBe("npc");
  expect(objective(s).text).toMatch(/^Head home with Inicio/);
});

test("can't leave the shop holding unpaid stock", () => {
  const s = run(initialState(), { type: "setZone", zone: "shop" }, { type: "pick", shopRecordId: "kindling" });
  expect(canLeaveShop(s)).toBe(false);
  const back = transition(s, { type: "putBack" });
  expect(canLeaveShop(back)).toBe(true);
  expect(recordPlace(back, "kindling")).toBe("shelf");
});

test("no second op while one is pending", () => {
  const s = run(
    initialState(),
    { type: "pick", shopRecordId: "kindling" },
    { type: "purchaseStart" },
  );
  expect(transition(s, { type: "purchaseStart" })).toBe(s);
  expect(transition(s, { type: "loadStart", kind: "collection" })).toBe(s);
  // Hand is locked while the purchase is in flight.
  expect(transition(s, { type: "putBack" })).toBe(s);
  expect(transition(s, { type: "pick", shopRecordId: "blue-hours" })).toBe(s);
  expect(transition(s, { type: "placeOnDeck" })).toBe(s);
});

test("purchase failure keeps the unpaid item in hand and allows retry", () => {
  let s = run(initialState(), { type: "pick", shopRecordId: "kindling" }, { type: "purchaseStart" });
  s = transition(s, { type: "purchaseFail", error: "Transaction rejected" });
  expect(s.op).toMatchObject({ kind: "purchase", status: "error", error: "Transaction rejected" });
  expect(s.hand).toEqual({ shopRecordId: "kindling", recordId: null });
  expect(s.owned).toHaveLength(0);
  // Retry replaces the error.
  const retry = transition(s, { type: "purchaseStart" });
  expect(retry.op).toMatchObject({ kind: "purchase", status: "pending" });
  // Or dismiss.
  expect(transition(s, { type: "dismissError" }).op).toBeNull();
});

test("sell failure keeps the record", () => {
  let s = run(boughtState(), { type: "sellStart", npcId: "buyer:collector" });
  s = transition(s, { type: "sellFail", error: "Transaction rejected" });
  expect(s.op?.status).toBe("error");
  expect(s.hand?.recordId).toBe("0xrec1");
  expect(s.owned).toHaveLength(1);
  expect(s.sold).toHaveLength(0);
});

test("pick swaps unpaid stock back to the shelf; refuses while holding an owned record", () => {
  let s = run(initialState(), { type: "pick", shopRecordId: "kindling" });
  s = transition(s, { type: "pick", shopRecordId: "blue-hours" });
  expect(s.hand?.shopRecordId).toBe("blue-hours");
  expect(recordPlace(s, "kindling")).toBe("shelf");

  const bought = boughtState();
  expect(transition(bought, { type: "pick", shopRecordId: "kindling" })).toBe(bought);
  expect(transition(bought, { type: "putBack" })).toBe(bought);
});

test("deck swap exchanges hand and deck and stops playback", () => {
  let s = run(
    initialState(),
    { type: "pick", shopRecordId: "kindling" },
    { type: "placeOnDeck" },
    { type: "play" },
    { type: "pick", shopRecordId: "blue-hours" },
  );
  expect(s.playing).not.toBeNull();
  s = transition(s, { type: "swapWithDeck" });
  expect(s.hand?.shopRecordId).toBe("kindling");
  expect(s.deck?.shopRecordId).toBe("blue-hours");
  expect(s.playing).toBeNull();
  // A record on the deck can't be picked from the shelf.
  expect(transition(s, { type: "pick", shopRecordId: "blue-hours" })).toBe(s);
});

test("illegal transitions return the same object", () => {
  const s = initialState();
  for (const action of [
    { type: "putBack" },
    { type: "placeOnDeck" },
    { type: "takeFromDeck" },
    { type: "swapWithDeck" },
    { type: "play" },
    { type: "stop" },
    { type: "purchaseStart" },
    { type: "sellStart", npcId: "x" },
    { type: "smash", carId: "car:1" },
    { type: "holdOwned", recordId: "0xnope" },
    { type: "dismissError" },
  ] satisfies GameAction[]) {
    expect(transition(s, action)).toBe(s);
  }
});

test("smash needs a held record and only works once per car", () => {
  const s = run(initialState(), { type: "pick", shopRecordId: "kindling" }, { type: "smash", carId: "car:1" });
  expect(s.smashedCars).toEqual(["car:1"]);
  expect(transition(s, { type: "smash", carId: "car:1" })).toBe(s);
});

test("holdOwned takes a record out of the collection", () => {
  let s = run(initialState(), { type: "collectionLoaded", owned: [owned("kindling", "0xA")] });
  s = transition(s, { type: "pick", shopRecordId: "blue-hours" });
  s = transition(s, { type: "holdOwned", recordId: "0xA" });
  expect(s.hand).toEqual({ shopRecordId: "kindling", recordId: "0xA" });
  expect(recordPlace(s, "blue-hours")).toBe("shelf");
});

test("a release can be bought again after selling", () => {
  let s = run(
    boughtState(),
    { type: "sellStart", npcId: "buyer:collector" },
    { type: "sellSuccess", paid: 20_000_000n, digest: "D2", balance: 108_000_000n },
    { type: "pick", shopRecordId: "kindling" },
  );
  // low-tide-tapes is with the collector; another release is pickable.
  expect(s.hand?.shopRecordId).toBe("kindling");
  s = run(s, { type: "purchaseStart" }, {
    type: "purchaseSuccess",
    owned: owned("kindling", "0xrec2"),
    digest: "D3",
    balance: 98_000_000n,
    amount: 10_000_000n,
  });
  expect(s.owned.map((r) => r.recordId)).toEqual(["0xrec2"]);
});

test("stowOwned puts a held owned Record away; refuses unpaid stock and while selling", () => {
  const s = boughtState();
  const stowed = transition(s, { type: "stowOwned" });
  expect(stowed.hand).toBeNull();
  expect(stowed.owned).toHaveLength(1);
  // Unpaid stock must go back to the shelf with putBack, not stowOwned.
  const unpaid = run(initialState(), { type: "pick", shopRecordId: "kindling" });
  expect(transition(unpaid, { type: "stowOwned" })).toBe(unpaid);
  // Locked while a sale is in flight.
  const selling = transition(s, { type: "sellStart", npcId: "buyer:collector" });
  expect(transition(selling, { type: "stowOwned" })).toBe(selling);
  // Then hold it again from the collection.
  expect(transition(stowed, { type: "holdOwned", recordId: "0xrec1" }).hand).toEqual({
    shopRecordId: "low-tide-tapes",
    recordId: "0xrec1",
  });
});

test("the collector comes back: buyerReturned puts the sold release back in stock", () => {
  const sold = run(
    boughtState(),
    { type: "sellStart", npcId: "buyer:collector" },
    { type: "sellSuccess", paid: 18_000_000n, digest: "D2", balance: 106_000_000n },
  );
  expect(sold.buyerAway).toEqual({ npcId: "buyer:collector", shopRecordId: "low-tide-tapes" });
  expect(recordPlace(sold, "low-tide-tapes")).toBe("npc");
  // Can't pick it while the collector is carrying it off.
  expect(transition(sold, { type: "pick", shopRecordId: "low-tide-tapes" })).toBe(sold);
  // Another buyer id is refused.
  expect(transition(sold, { type: "buyerReturned", npcId: "buyer:someone-else" })).toBe(sold);

  const back = transition(sold, { type: "buyerReturned", npcId: "buyer:collector" });
  expect(back.buyerAway).toBeNull();
  expect(recordPlace(back, "low-tide-tapes")).toBe("shelf");
  // Sales history is kept; returning twice is a no-op.
  expect(back.sold).toHaveLength(1);
  expect(transition(back, { type: "buyerReturned", npcId: "buyer:collector" })).toBe(back);

  // The loop can run again: the same release can be picked and the mission restarts.
  const again = transition(back, { type: "pick", shopRecordId: "low-tide-tapes" });
  expect(again.hand).toEqual({ shopRecordId: "low-tide-tapes", recordId: null });
  expect(objective(again).target).toBe("deck");
});

// ------------------------------------------------------------- ATM / withdraw

const PRICES = { "low-tide-tapes": 12_000_000n, kindling: 8_000_000n, "big-one": 25_000_000n };

test("withdraw: start → pending → success sets balance and receipt; hand is not locked", () => {
  let s = run(initialState(), { type: "walletLoaded", balance: 100_000_000n }, { type: "pick", shopRecordId: "kindling" });
  s = transition(s, { type: "withdrawStart" });
  expect(s.op).toEqual({ kind: "withdraw", status: "pending" });
  expect(objective(s)).toEqual({ text: "Wait for the ATM.", target: "atm" });
  // Only one op at a time.
  expect(transition(s, { type: "purchaseStart" })).toBe(s);
  expect(transition(s, { type: "withdrawStart" })).toBe(s);
  // Withdrawing never locks the record in your hands.
  expect(transition(s, { type: "putBack" }).hand).toBeNull();
  // Results for other ops are ignored.
  expect(transition(s, { type: "sellSuccess", paid: 1n, digest: "X", balance: 1n })).toBe(s);

  s = transition(s, { type: "withdrawSuccess", digest: "W1", amount: 50_000_000n, balance: 150_000_000n });
  expect(s.op).toBeNull();
  expect(s.balance).toBe(150_000_000n);
  expect(s.lastReceipt).toEqual({ kind: "withdraw", digest: "W1", amount: 50_000_000n });
  // Not pending any more: a late success is refused.
  expect(transition(s, { type: "withdrawSuccess", digest: "W2", amount: 1n, balance: 1n })).toBe(s);
});

test("withdraw: fail → error, Retry can start again, dismissError clears it", () => {
  let s = run(initialState(), { type: "walletLoaded", balance: 5_000_000n }, { type: "withdrawStart" });
  s = transition(s, { type: "withdrawFail", error: "faucet down" });
  expect(s.op).toEqual({ kind: "withdraw", status: "error", error: "faucet down" });
  expect(s.balance).toBe(5_000_000n);
  expect(transition(s, { type: "withdrawFail", error: "again" })).toBe(s); // not pending
  const retry = transition(s, { type: "withdrawStart" });
  expect(retry.op).toEqual({ kind: "withdraw", status: "pending" });
  expect(transition(s, { type: "dismissError" }).op).toBeNull();
  // Can't withdraw while a purchase is pending.
  const buying = run(initialState(), { type: "pick", shopRecordId: "kindling" }, { type: "purchaseStart" });
  expect(transition(buying, { type: "withdrawStart" })).toBe(buying);
});

test("catalogLoaded stores prices for the objective", () => {
  const s = transition(initialState(), { type: "catalogLoaded", prices: PRICES });
  expect(s.prices).toEqual(PRICES);
  // Without prices (and nothing pending) it is a no-op.
  expect(transition(s, { type: "catalogLoaded" })).toBe(s);
});

test("objective: short on FakeUSD points at the ATM", () => {
  const base = run(initialState(), { type: "catalogLoaded", prices: PRICES });
  // Balance unknown: no ATM nag.
  expect(objective(base).target).toBe("shop-door");
  // Empty-handed and below the cheapest price (8.00).
  const broke = transition(base, { type: "walletLoaded", balance: 7_999_999n });
  expect(objective(broke)).toEqual({ text: "Get cash at the ATM.", target: "atm" });
  // Exactly the cheapest price is enough.
  expect(objective(transition(base, { type: "walletLoaded", balance: 8_000_000n })).target).toBe("shop-door");
  // Holding an unpaid record: compared with that record's price.
  const holding = run(base, { type: "setZone", zone: "shop" }, { type: "walletLoaded", balance: 10_000_000n }, { type: "pick", shopRecordId: "big-one" });
  // Unpaid stock can't leave the shop, so the mission says to put it back first.
  expect(objective(holding)).toEqual({ text: "Put it back. Hit the ATM.", target: null });
  const affordable = transition(holding, { type: "pick", shopRecordId: "kindling" });
  expect(objective(affordable).target).toBe("deck");
  // After a withdrawal the normal loop resumes.
  const topped = run(holding, { type: "withdrawStart" }, { type: "withdrawSuccess", digest: "W", amount: 50_000_000n, balance: 60_000_000n });
  expect(objective(topped).target).toBe("deck");
  // Holding an owned Record: never nagged (go sell it).
  const owning = run(
    base,
    { type: "walletLoaded", balance: 100_000_000n },
    { type: "pick", shopRecordId: "low-tide-tapes" },
    { type: "purchaseStart" },
    { type: "purchaseSuccess", owned: owned("low-tide-tapes"), digest: "D", balance: 1n, amount: 12_000_000n },
  );
  expect(objective(owning).target).toBe("car"); // on the street, owned Record in hand
  // Prices unknown (catalog not loaded): no nag.
  expect(objective(run(initialState(), { type: "walletLoaded", balance: 0n })).target).toBe("shop-door");
});

// ------------------------------------------------------------- exit beat / goHome

/** Bought low-tide-tapes, smashed the sedan, sold it to Stonks (empty-handed, on the street). */
function soldState(): GameState {
  return run(
    boughtState(),
    { type: "setZone", zone: "street" },
    { type: "smash", carId: "car:0" },
    { type: "sellStart", npcId: "buyer:collector" },
    { type: "sellSuccess", paid: 18_000_000n, digest: "S1", balance: 106_000_000n },
  );
}

test("goHome: refused before any sale (same object back)", () => {
  const fresh = initialState();
  expect(canGoHome(fresh)).toBe(false);
  expect(transition(fresh, { type: "goHome" })).toBe(fresh);
  const bought = boughtState();
  expect(transition(bought, { type: "goHome" })).toBe(bought);
  expect(fresh.wentHome).toBe(false);
});

test("goHome: after a sale → wentHome, objective walks you home, then reads Home", () => {
  const sold = soldState();
  expect(sold.wentHome).toBe(false);
  expect(canGoHome(sold)).toBe(true);
  expect(objective(sold)).toEqual({ text: "Head home with Inicio.", target: "home" });
  const home = transition(sold, { type: "goHome" });
  expect(home).not.toBe(sold);
  expect(home.wentHome).toBe(true);
  expect(canGoHome(home)).toBe(false);
  expect(objective(home)).toEqual({ text: "Home. Press H to reset.", target: null });
  // Only once.
  expect(transition(home, { type: "goHome" })).toBe(home);
  // Reset starts over.
  expect(transition(home, { type: "reset" }).wentHome).toBe(false);
});

test("goHome: never while an op is pending; an errored op does not block it", () => {
  const pending = transition(soldState(), { type: "withdrawStart" });
  expect(canGoHome(pending)).toBe(false);
  expect(transition(pending, { type: "goHome" })).toBe(pending);
  const failed = transition(pending, { type: "withdrawFail", error: "down" });
  expect(transition(failed, { type: "goHome" }).wentHome).toBe(true);
});

test("goHome: the loop keeps working afterwards (pick another record)", () => {
  const home = run(soldState(), { type: "goHome" }, { type: "setZone", zone: "shop" }, { type: "pick", shopRecordId: "kindling" });
  expect(home.hand).toEqual({ shopRecordId: "kindling", recordId: null });
  expect(objective(home).target).toBe("deck");
});
