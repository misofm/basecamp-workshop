/**
 * Every state x every event, black-box (docs/STATE-MODEL.md §1 "Transition table" and
 * "Invariants"). Fixtures are built ONLY by applying events to initialState(), and the
 * expected matrix below is written by hand from the guards in the doc, not from the code.
 * Assertions use observable state fields and the public selectors only, so this file
 * survives a rewrite of the state machine's internals.
 */
import { expect, test } from "@playwright/test";
import {
  canGoHome,
  canLeaveShop,
  handLocked,
  heldIsOwned,
  heldIsUnpaid,
  initialState,
  invariantViolations,
  recordPlace,
  step,
  transition,
  type GameAction,
  type GameState,
} from "../../src/game/state";
import type { OwnedRecord } from "../../src/miso/types";

// ------------------------------------------------------------------ data

const A = "rel-a";
const B = "rel-b";
const COLLECTOR = "buyer:collector";
const OTHER_NPC = "buyer:other";
const PRICE_A = 12_000_000n;
const PRICE_B = 15_000_000n;
const START = 100_000_000n;

const rec = (shopRecordId: string, recordId: string): OwnedRecord => ({
  recordId,
  shopRecordId,
  title: `Title ${shopRecordId}`,
  artist: "Artist",
  coverUrl: `/covers/${shopRecordId}.png`,
  serial: 1,
  maxSupply: 250,
  acquiredAt: 1,
});
const rA = rec(A, "0xrA");

const run = (state: GameState, ...actions: GameAction[]): GameState => {
  let s = state;
  for (const action of actions) {
    const r = step(s, action);
    // Fixture construction must only use accepted events.
    if (r.rejected !== null) throw new Error(`fixture event ${action.type} rejected: ${r.rejected}`);
    s = r.state;
  }
  return s;
};

const ev = {
  pickA: { type: "pick", shopRecordId: A },
  pickB: { type: "pick", shopRecordId: B },
  putBack: { type: "putBack" },
  placeOnDeck: { type: "placeOnDeck" },
  takeFromDeck: { type: "takeFromDeck" },
  swapWithDeck: { type: "swapWithDeck" },
  holdOwnedA: { type: "holdOwned", recordId: rA.recordId },
  stowOwned: { type: "stowOwned" },
  play: { type: "play" },
  nextTrack3: { type: "nextTrack", trackCount: 3 },
  stop: { type: "stop" },
  purchaseStart: { type: "purchaseStart" },
  /** The release held in purchase-pending is A; a fresh Record id for it. */
  purchaseSuccessA: { type: "purchaseSuccess", owned: rec(A, "0xrA2"), digest: "DIGEST-P2", balance: START - 2n * PRICE_A, amount: PRICE_A },
  purchaseFail: { type: "purchaseFail", error: "Register jammed. Try again." },
  sellStartCollector: { type: "sellStart", npcId: COLLECTOR },
  sellSuccess: { type: "sellSuccess", paid: 20_000_000n, digest: "DIGEST-S2", balance: 77_000_000n },
  sellFail: { type: "sellFail", error: "Deal fell through. You still own it." },
  withdrawStart: { type: "withdrawStart" },
  withdrawSuccess: { type: "withdrawSuccess", digest: "DIGEST-W", amount: 50_000_000n, balance: 150_000_000n },
  withdrawFail: { type: "withdrawFail", error: "Card reader jammed. Try again." },
  buyerReturnedCollector: { type: "buyerReturned", npcId: COLLECTOR },
  collectionLoadedEmpty: { type: "collectionLoaded", owned: [] },
  walletLoaded: { type: "walletLoaded", balance: 50_000_000n },
  smashCar0: { type: "smash", carId: "car:0" },
  setZoneStreet: { type: "setZone", zone: "street" },
  dismissError: { type: "dismissError" },
  goHome: { type: "goHome" },
  reset: { type: "reset" },
} satisfies Record<string, GameAction>;
type EventName = keyof typeof ev;

// -------------------------------------------------------------- fixtures

function buildFixtures() {
  const idleStreet = run(
    initialState(),
    { type: "walletLoaded", balance: START },
    { type: "catalogLoaded", prices: { [A]: PRICE_A, [B]: PRICE_B } },
  );
  const idleShop = run(idleStreet, { type: "setZone", zone: "shop" });
  const holdingUnpaidA = run(idleShop, ev.pickA);
  const unpaidAOnDeck = run(holdingUnpaidA, ev.placeOnDeck);
  const aPlaying = run(unpaidAOnDeck, ev.play);
  const holdingUnpaidBWithAOnDeck = run(unpaidAOnDeck, ev.pickB);
  const purchasePending = run(holdingUnpaidA, ev.purchaseStart);
  const purchaseError = run(purchasePending, ev.purchaseFail);
  const holdingOwnedAInShop = run(purchasePending, {
    type: "purchaseSuccess",
    owned: rA,
    digest: "DIGEST-P1",
    balance: START - PRICE_A,
    amount: PRICE_A,
  });
  const holdingOwnedAOnStreet = run(holdingOwnedAInShop, ev.setZoneStreet);
  const sellPending = run(holdingOwnedAOnStreet, ev.sellStartCollector);
  const sellError = run(sellPending, ev.sellFail);
  const withdrawPending = run(idleStreet, ev.withdrawStart);
  const withdrawError = run(withdrawPending, ev.withdrawFail);
  const buyerAway = run(sellPending, { type: "sellSuccess", paid: 20_000_000n, digest: "DIGEST-S1", balance: START - PRICE_A + 20_000_000n });
  const wentHome = run(buyerAway, ev.goHome);
  const ownsAButEmptyHands = run(holdingOwnedAOnStreet, ev.stowOwned);
  return {
    "idle-street": idleStreet,
    "idle-shop": idleShop,
    "holding-unpaid-A": holdingUnpaidA,
    "unpaid-A-on-deck": unpaidAOnDeck,
    "A-playing": aPlaying,
    "holding-unpaid-B-with-A-on-deck": holdingUnpaidBWithAOnDeck,
    "holding-owned-A-in-shop": holdingOwnedAInShop,
    "holding-owned-A-on-street": holdingOwnedAOnStreet,
    "purchase-pending": purchasePending,
    "purchase-error": purchaseError,
    "sell-pending": sellPending,
    "sell-error": sellError,
    "withdraw-pending": withdrawPending,
    "withdraw-error": withdrawError,
    "buyer-away": buyerAway,
    "went-home": wentHome,
    "owns-A-but-empty-hands": ownsAButEmptyHands,
  } satisfies Record<string, GameState>;
}
const fixtures = buildFixtures();
type FixtureName = keyof typeof fixtures;
const FIXTURES = Object.keys(fixtures) as FixtureName[];

// ------------------------------------------------- expected matrix (from the doc)

type Outcome = "accept" | "noop" | "reject";
/** Per event: the fixtures where it is accepted / a no-op. Every other fixture rejects it. */
interface Row {
  accept: FixtureName[] | "all";
  noop?: FixtureName[] | "rest";
}

const SHOP_ZONE: FixtureName[] = [
  "idle-shop",
  "holding-unpaid-A",
  "unpaid-A-on-deck",
  "A-playing",
  "holding-unpaid-B-with-A-on-deck",
  "holding-owned-A-in-shop",
  "purchase-pending",
  "purchase-error",
];
const NOTHING_PENDING: FixtureName[] = FIXTURES.filter(
  (f) => f !== "purchase-pending" && f !== "sell-pending" && f !== "withdraw-pending",
);

const EXPECTED: Record<EventName, Row> = {
  // hand not locked · not holding an owned Record · A on the shelf
  pickA: { accept: ["idle-street", "idle-shop", "withdraw-pending", "withdraw-error", "owns-A-but-empty-hands"] },
  pickB: {
    accept: [
      "idle-street",
      "idle-shop",
      "holding-unpaid-A", // unpaid A goes back to its shelf
      "unpaid-A-on-deck",
      "A-playing",
      "purchase-error", // and clears the stale error
      "withdraw-pending",
      "withdraw-error",
      "buyer-away",
      "went-home",
      "owns-A-but-empty-hands",
    ],
  },
  // hand not locked · holding unpaid stock
  putBack: { accept: ["holding-unpaid-A", "holding-unpaid-B-with-A-on-deck", "purchase-error"] },
  // hand not locked · hand set · deck empty
  placeOnDeck: {
    accept: ["holding-unpaid-A", "holding-owned-A-in-shop", "holding-owned-A-on-street", "purchase-error", "sell-error"],
  },
  // hand not locked · deck set · hand empty
  takeFromDeck: { accept: ["unpaid-A-on-deck", "A-playing"] },
  // hand not locked · hand and deck set
  swapWithDeck: { accept: ["holding-unpaid-B-with-A-on-deck"] },
  // hand not locked · Record owned · not holding an owned Record · release not on deck · not with the collector
  holdOwnedA: { accept: ["owns-A-but-empty-hands"] },
  // hand not locked · holding an owned Record
  stowOwned: { accept: ["holding-owned-A-in-shop", "holding-owned-A-on-street", "sell-error"] },
  // deck set
  play: { accept: ["unpaid-A-on-deck", "A-playing", "holding-unpaid-B-with-A-on-deck"] },
  // playing · n >= 1
  nextTrack3: { accept: ["A-playing"] },
  // always; no-op if silent
  stop: { accept: ["A-playing"], noop: "rest" },
  // nothing pending · holding unpaid stock (an error is replaced)
  purchaseStart: { accept: ["holding-unpaid-A", "holding-unpaid-B-with-A-on-deck", "purchase-error"] },
  // purchase pending · holding unpaid stock of that release
  purchaseSuccessA: { accept: ["purchase-pending"] },
  purchaseFail: { accept: ["purchase-pending"] },
  // nothing pending · holding an owned Record · that buyer not away
  sellStartCollector: { accept: ["holding-owned-A-in-shop", "holding-owned-A-on-street", "sell-error"] },
  sellSuccess: { accept: ["sell-pending"] },
  sellFail: { accept: ["sell-pending"] },
  // nothing pending
  withdrawStart: { accept: NOTHING_PENDING },
  withdrawSuccess: { accept: ["withdraw-pending"] },
  withdrawFail: { accept: ["withdraw-pending"] },
  // always; no-op unless that buyer is away
  buyerReturnedCollector: { accept: ["buyer-away", "went-home"], noop: "rest" },
  // always
  collectionLoadedEmpty: { accept: "all" },
  // balance >= 0
  walletLoaded: { accept: "all" },
  // holding a record · hand not locked · car not smashed
  smashCar0: {
    accept: [
      "holding-unpaid-A",
      "holding-unpaid-B-with-A-on-deck",
      "holding-owned-A-in-shop",
      "holding-owned-A-on-street",
      "purchase-error",
      "sell-error",
    ],
  },
  // always; no-op if unchanged
  setZoneStreet: { accept: SHOP_ZONE, noop: "rest" },
  // always; no-op unless an error
  dismissError: { accept: ["purchase-error", "sell-error", "withdraw-error"], noop: "rest" },
  // at least one sale · nothing pending · not home yet
  goHome: { accept: ["buyer-away"] },
  reset: { accept: "all" },
};

function expectedOutcome(event: EventName, fixture: FixtureName): Outcome {
  const row = EXPECTED[event];
  if (row.accept === "all" || row.accept.includes(fixture)) return "accept";
  if (row.noop === "rest" || row.noop?.includes(fixture)) return "noop";
  return "reject";
}

/**
 * Light effect checks for accepted cells (doc "Effect" column), on observable fields only.
 * `before` is the fixture, `after` the accepted result.
 */
const EFFECT: Partial<Record<EventName, (before: GameState, after: GameState) => void>> = {
  pickA: (_b, a) => expect(a.hand).toEqual({ shopRecordId: A, recordId: null }),
  pickB: (_b, a) => expect(a.hand).toEqual({ shopRecordId: B, recordId: null }),
  putBack: (_b, a) => expect(a.hand).toBeNull(),
  placeOnDeck: (b, a) => {
    expect(a.deck).toEqual(b.hand);
    expect(a.hand).toBeNull();
    expect(a.playing).toBeNull();
  },
  takeFromDeck: (b, a) => {
    expect(a.hand).toEqual(b.deck);
    expect(a.deck).toBeNull();
    expect(a.playing).toBeNull();
  },
  swapWithDeck: (b, a) => {
    expect(a.hand).toEqual(b.deck);
    expect(a.deck).toEqual(b.hand);
    expect(a.playing).toBeNull();
  },
  holdOwnedA: (_b, a) => expect(a.hand).toEqual({ shopRecordId: A, recordId: rA.recordId }),
  stowOwned: (_b, a) => expect(a.hand).toBeNull(),
  play: (b, a) => {
    expect(a.playing).toEqual({ trackIndex: 0 });
    expect(a.listened).toContain(b.deck!.shopRecordId);
  },
  nextTrack3: (b, a) => expect(a.playing).toEqual({ trackIndex: (b.playing!.trackIndex + 1) % 3 }),
  stop: (_b, a) => expect(a.playing).toBeNull(),
  purchaseStart: (b, a) => expect(a.op).toEqual({ kind: "purchase", status: "pending", targetId: b.hand!.shopRecordId }),
  purchaseSuccessA: (b, a) => {
    expect(a.hand).toEqual({ shopRecordId: A, recordId: "0xrA2" });
    expect(a.owned.map((r) => r.recordId)).toEqual(["0xrA2", ...b.owned.map((r) => r.recordId)]);
    expect(a.balance).toBe(START - 2n * PRICE_A);
    expect(a.op).toBeNull();
    expect(a.lastReceipt).toMatchObject({ kind: "purchase", shopRecordId: A, recordId: "0xrA2", digest: "DIGEST-P2", amount: PRICE_A });
  },
  purchaseFail: (b, a) => {
    expect(a.op).toMatchObject({ kind: "purchase", status: "error", error: "Register jammed. Try again." });
    expect(a.hand).toEqual(b.hand);
  },
  sellStartCollector: (_b, a) => expect(a.op).toMatchObject({ kind: "sell", status: "pending" }),
  sellSuccess: (b, a) => {
    expect(a.hand).toBeNull();
    expect(a.owned.some((r) => r.recordId === b.hand!.recordId)).toBe(false);
    expect(a.sold.at(-1)).toMatchObject({ recordId: b.hand!.recordId, shopRecordId: A, npcId: COLLECTOR, paid: 20_000_000n });
    expect(a.buyerAway).toEqual({ npcId: COLLECTOR, shopRecordId: A });
    expect(a.balance).toBe(77_000_000n);
    expect(a.op).toBeNull();
    expect(a.lastReceipt).toMatchObject({ kind: "sell", shopRecordId: A, digest: "DIGEST-S2", amount: 20_000_000n });
    expect(recordPlace(a, A)).toBe("npc");
  },
  sellFail: (b, a) => {
    expect(a.op).toMatchObject({ kind: "sell", status: "error", error: "Deal fell through. You still own it." });
    expect(a.hand).toEqual(b.hand);
    expect(a.owned).toEqual(b.owned);
  },
  withdrawStart: (b, a) => {
    expect(a.op).toMatchObject({ kind: "withdraw", status: "pending" });
    expect(a.hand).toEqual(b.hand);
    expect(handLocked(a)).toBe(false);
  },
  withdrawSuccess: (_b, a) => {
    expect(a.balance).toBe(150_000_000n);
    expect(a.op).toBeNull();
    expect(a.lastReceipt).toMatchObject({ kind: "withdraw", digest: "DIGEST-W", amount: 50_000_000n });
  },
  withdrawFail: (_b, a) => expect(a.op).toMatchObject({ kind: "withdraw", status: "error", error: "Card reader jammed. Try again." }),
  buyerReturnedCollector: (_b, a) => {
    expect(a.buyerAway).toBeNull();
    expect(recordPlace(a, A)).toBe("shelf");
  },
  collectionLoadedEmpty: (b, a) => {
    // The read missed everything: only the Record in hand / on the deck survives.
    const kept = [b.hand?.recordId, b.deck?.recordId].filter((x): x is string => !!x);
    expect(a.owned.map((r) => r.recordId).sort()).toEqual(kept.sort());
  },
  walletLoaded: (_b, a) => expect(a.balance).toBe(50_000_000n),
  smashCar0: (_b, a) => expect(a.smashedCars).toEqual(["car:0"]),
  setZoneStreet: (_b, a) => expect(a.zone).toBe("street"),
  dismissError: (_b, a) => expect(a.op).toBeNull(),
  goHome: (_b, a) => {
    expect(a.wentHome).toBe(true);
    expect(canGoHome(a)).toBe(false);
  },
  reset: (_b, a) => expect(a).toEqual(initialState()),
};

// ------------------------------------------------------------- matrix tests

test("fixtures are reachable, distinct and satisfy every invariant", () => {
  for (const name of FIXTURES) expect(invariantViolations(fixtures[name]), name).toEqual([]);
  expect(new Set(FIXTURES.map((n) => JSON.stringify(fixtures[n], (_k, v) => (typeof v === "bigint" ? `${v}n` : v)))).size).toBe(
    FIXTURES.length,
  );
});

test("selectors per fixture", () => {
  const locked: FixtureName[] = ["purchase-pending", "sell-pending"];
  const unpaid: FixtureName[] = ["holding-unpaid-A", "holding-unpaid-B-with-A-on-deck", "purchase-pending", "purchase-error"];
  const ownedInHand: FixtureName[] = ["holding-owned-A-in-shop", "holding-owned-A-on-street", "sell-pending", "sell-error"];
  for (const name of FIXTURES) {
    const s = fixtures[name];
    expect(handLocked(s), `${name} handLocked`).toBe(locked.includes(name));
    expect(heldIsUnpaid(s), `${name} heldIsUnpaid`).toBe(unpaid.includes(name));
    expect(canLeaveShop(s), `${name} canLeaveShop`).toBe(!unpaid.includes(name));
    expect(heldIsOwned(s), `${name} heldIsOwned`).toBe(ownedInHand.includes(name));
    expect(canGoHome(s), `${name} canGoHome`).toBe(name === "buyer-away");
  }
  expect(recordPlace(fixtures["holding-unpaid-B-with-A-on-deck"], A)).toBe("deck");
  expect(recordPlace(fixtures["holding-unpaid-B-with-A-on-deck"], B)).toBe("hand");
  expect(recordPlace(fixtures["buyer-away"], A)).toBe("npc");
  expect(recordPlace(fixtures["owns-A-but-empty-hands"], A)).toBe("shelf");
});

for (const event of Object.keys(ev) as EventName[]) {
  test(`matrix: ${event} in every state`, () => {
    const failures: string[] = [];
    for (const name of FIXTURES) {
      const before = fixtures[name];
      const snapshot = structuredClone(before);
      const cell = `${name} × ${event}`;
      let result: ReturnType<typeof step>;
      try {
        result = step(before, ev[event]);
      } catch (error) {
        failures.push(`${cell}: step threw ${String(error)}`);
        continue;
      }
      const observed: Outcome =
        result.rejected !== null ? "reject" : result.state === before ? "noop" : "accept";
      const expected = expectedOutcome(event, name);
      if (observed !== expected) {
        failures.push(`${cell}: expected ${expected}, observed ${observed}${result.rejected ? ` ("${result.rejected}")` : ""}`);
      }
      if (result.rejected !== null) {
        if (result.rejected.length === 0) failures.push(`${cell}: empty rejection reason`);
        if (result.state !== before) failures.push(`${cell}: rejected but returned a different object`);
      }
      if (observed !== "accept" && transition(before, ev[event]) !== before) {
        failures.push(`${cell}: transition() did not return the same object`);
      }
      const violations = invariantViolations(result.state);
      if (violations.length) failures.push(`${cell}: invariants broken: ${violations.join("; ")}`);
      // Pure: the input state is never mutated.
      expect(before, `${cell} mutated its input`).toEqual(snapshot);
      if (observed === "accept" && expected === "accept") {
        try {
          EFFECT[event]?.(before, result.state);
        } catch (error) {
          failures.push(`${cell}: effect: ${(error as Error).message.split("\n").slice(0, 6).join(" ")}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

// ------------------------------------------------- targeted rules (this branch)

const opOf = (s: GameState) => s.op && { kind: s.op.kind, status: s.op.status };

test("stale purchase error is cleared when the hand changes (pick / putBack / placeOnDeck / holdOwned)", () => {
  const err = fixtures["purchase-error"];
  for (const action of [ev.pickB, ev.putBack, ev.placeOnDeck] as GameAction[]) {
    const r = step(err, action);
    expect(r.rejected, action.type).toBeNull();
    expect(r.state.op, action.type).toBeNull();
  }
  // holdOwned: own rA, hold unpaid B, fail a purchase of B, then take rA out of the collection.
  const s = run(fixtures["owns-A-but-empty-hands"], ev.pickB, ev.purchaseStart, ev.purchaseFail);
  expect(opOf(s)).toEqual({ kind: "purchase", status: "error" });
  const held = run(s, ev.holdOwnedA);
  expect(held.hand).toEqual({ shopRecordId: A, recordId: rA.recordId });
  expect(held.op).toBeNull();
});

test("stale sell error is cleared when the hand changes (stowOwned / placeOnDeck)", () => {
  for (const action of [ev.stowOwned, ev.placeOnDeck] as GameAction[]) {
    const r = step(fixtures["sell-error"], action);
    expect(r.rejected, action.type).toBeNull();
    expect(r.state.op, action.type).toBeNull();
  }
});

test("errors are kept when the hand doesn't change", () => {
  for (const name of ["purchase-error", "sell-error", "withdraw-error"] as const) {
    const before = fixtures[name];
    for (const action of [
      ev.stop,
      ev.setZoneStreet,
      { type: "setZone", zone: "shop" },
      ev.smashCar0,
      ev.walletLoaded,
      ev.collectionLoadedEmpty,
      { type: "catalogLoaded", prices: { [A]: 1n } },
      ev.buyerReturnedCollector,
      ev.pickA, // rejected (A is in hand) or, for withdraw-error, a hand change that is not about this error
    ] as GameAction[]) {
      const after = transition(before, action);
      expect(opOf(after), `${name} × ${action.type}`).toEqual(opOf(before));
      expect(after.op && "error" in after.op && after.op.error, `${name} × ${action.type}`).toBe(
        before.op && "error" in before.op && before.op.error,
      );
    }
  }
  // A withdraw error is about the ATM, not the hand: hand moves keep it.
  const s = run(fixtures["withdraw-error"], ev.pickA, ev.placeOnDeck, ev.takeFromDeck, ev.putBack);
  expect(opOf(s)).toEqual({ kind: "withdraw", status: "error" });
});

test("smash is refused while a purchase or sale is pending, allowed during a withdrawal", () => {
  for (const name of ["purchase-pending", "sell-pending"] as const) {
    const r = step(fixtures[name], ev.smashCar0);
    expect(r.rejected, name).toBeTruthy();
    expect(r.state).toBe(fixtures[name]);
  }
  const s = run(fixtures["holding-unpaid-A"], ev.withdrawStart);
  expect(handLocked(s)).toBe(false);
  expect(transition(s, ev.smashCar0).smashedCars).toEqual(["car:0"]);
  // A car is smashed at most once.
  const smashed = run(fixtures["holding-unpaid-A"], ev.smashCar0);
  expect(step(smashed, ev.smashCar0).rejected).toBeTruthy();
});

/** Own two Records of A (rA, rA2), sell rA to the collector: A is walking away. */
function twoOfASoldOne(): GameState {
  return run(
    fixtures["owns-A-but-empty-hands"],
    { type: "setZone", zone: "shop" },
    ev.pickA,
    ev.purchaseStart,
    ev.purchaseSuccessA,
    ev.stowOwned,
    ev.holdOwnedA,
    ev.sellStartCollector,
    ev.sellSuccess,
  );
}

test("holdOwned is refused while that release is with the collector, allowed once they return", () => {
  const s = twoOfASoldOne();
  expect(recordPlace(s, A)).toBe("npc");
  expect(s.owned.map((r) => r.recordId)).toEqual(["0xrA2"]);
  const r = step(s, { type: "holdOwned", recordId: "0xrA2" });
  expect(r.rejected).toBeTruthy();
  expect(r.state).toBe(s);
  // The sold one is not holdable at all.
  expect(step(s, ev.holdOwnedA).rejected).toBeTruthy();
  const back = run(s, ev.buyerReturnedCollector);
  expect(transition(back, { type: "holdOwned", recordId: "0xrA2" }).hand).toEqual({ shopRecordId: A, recordId: "0xrA2" });
  // A second return is a harmless no-op.
  expect(step(back, ev.buyerReturnedCollector)).toEqual({ state: back, rejected: null });
});

test("sellStart is refused while that buyer is away; another buyer may buy", () => {
  // Own rA and a B Record; sell rA to the collector, then try to sell B to them.
  const s = run(
    fixtures["holding-owned-A-in-shop"],
    ev.stowOwned,
    ev.pickB,
    ev.purchaseStart,
    { type: "purchaseSuccess", owned: rec(B, "0xrB"), digest: "D", balance: 1n, amount: PRICE_B },
    ev.stowOwned,
    ev.holdOwnedA,
    ev.sellStartCollector,
    ev.sellSuccess,
    { type: "holdOwned", recordId: "0xrB" },
  );
  const r = step(s, ev.sellStartCollector);
  expect(r.rejected).toBeTruthy();
  expect(r.state).toBe(s);
  expect(transition(s, { type: "sellStart", npcId: OTHER_NPC }).op).toMatchObject({ kind: "sell", status: "pending", targetId: OTHER_NPC });
});

test("collectionLoaded keeps the Record in hand / on deck when the read misses it", () => {
  const inHand = fixtures["holding-owned-A-on-street"];
  expect(transition(inHand, ev.collectionLoadedEmpty).owned).toEqual([rA]);
  const onDeck = run(inHand, ev.placeOnDeck);
  const after = transition(onDeck, ev.collectionLoadedEmpty);
  expect(after.owned).toEqual([rA]);
  expect(invariantViolations(after)).toEqual([]);
  // The read is truth for everything else: a Record merely in the collection is dropped.
  expect(transition(fixtures["owns-A-but-empty-hands"], ev.collectionLoadedEmpty).owned).toEqual([]);
  // ...and new chain truth is taken.
  const rB = rec(B, "0xrB");
  expect(transition(inHand, { type: "collectionLoaded", owned: [rB] }).owned.map((r) => r.recordId).sort()).toEqual(["0xrA", "0xrB"]);
});

test("collectionLoaded drops Records sold this session (a lagging read can't resurrect them)", () => {
  const s = twoOfASoldOne();
  const lagging = transition(s, { type: "collectionLoaded", owned: [rA, rec(A, "0xrA2")] });
  expect(lagging.owned.map((r) => r.recordId)).toEqual(["0xrA2"]);
  expect(step(lagging, ev.holdOwnedA).rejected).toBeTruthy();
  expect(invariantViolations(lagging)).toEqual([]);
});

test("success with balance null keeps the known balance (and unknown stays null)", () => {
  const p = transition(fixtures["purchase-pending"], { ...ev.purchaseSuccessA, balance: null });
  expect(p.balance).toBe(START);
  const sale = transition(fixtures["sell-pending"], { ...ev.sellSuccess, balance: null });
  expect(sale.balance).toBe(START - PRICE_A);
  const w = transition(fixtures["withdraw-pending"], { ...ev.withdrawSuccess, balance: null });
  expect(w.balance).toBe(START);
  // Wallet never loaded: stays unknown.
  const unknown = run(initialState(), ev.withdrawStart, { ...ev.withdrawSuccess, balance: null });
  expect(unknown.balance).toBeNull();
});

test("negative walletLoaded is rejected; zero is fine", () => {
  const s = fixtures["idle-street"];
  const r = step(s, { type: "walletLoaded", balance: -1n });
  expect(r.rejected).toBeTruthy();
  expect(r.state).toBe(s);
  expect(transition(s, { type: "walletLoaded", balance: 0n }).balance).toBe(0n);
});

test("purchaseSuccess for a different release is rejected", () => {
  const s = fixtures["purchase-pending"];
  const r = step(s, { ...ev.purchaseSuccessA, owned: rec(B, "0xrB") });
  expect(r.rejected).toBeTruthy();
  expect(r.state).toBe(s);
  expect(s.op).toMatchObject({ kind: "purchase", status: "pending" });
});

test("malformed actions are rejected, never thrown", () => {
  const s = fixtures["holding-unpaid-A"];
  for (const bad of [{ type: "bogus" }, {}, { type: 42 }] as unknown as GameAction[]) {
    let r: ReturnType<typeof step> | undefined;
    expect(() => (r = step(s, bad))).not.toThrow();
    expect(r!.rejected, JSON.stringify(bad)).toBeTruthy();
    expect(r!.state).toBe(s);
    expect(transition(s, bad)).toBe(s);
  }
  for (const bad of [null, undefined] as unknown as GameAction[]) {
    expect(() => step(s, bad)).not.toThrow();
    expect(step(s, bad).rejected).toBeTruthy();
    expect(step(s, bad).state).toBe(s);
  }
});

test("double purchaseStart leaves exactly one pending op", () => {
  const once = transition(fixtures["holding-unpaid-A"], ev.purchaseStart);
  const twice = step(once, ev.purchaseStart);
  expect(twice.rejected).toBeTruthy();
  expect(twice.state).toBe(once);
  expect(twice.state.op).toEqual({ kind: "purchase", status: "pending", targetId: A });
  // Same for sales and withdrawals, and across kinds.
  expect(step(fixtures["sell-pending"], ev.sellStartCollector).rejected).toBeTruthy();
  expect(step(fixtures["withdraw-pending"], ev.withdrawStart).rejected).toBeTruthy();
  expect(step(run(fixtures["holding-unpaid-A"], ev.withdrawStart), ev.purchaseStart).rejected).toBeTruthy();
});

test("Retry after an error replaces it with a new pending op", () => {
  expect(transition(fixtures["purchase-error"], ev.purchaseStart).op).toEqual({ kind: "purchase", status: "pending", targetId: A });
  expect(transition(fixtures["sell-error"], ev.sellStartCollector).op).toMatchObject({
    kind: "sell",
    status: "pending",
    targetId: COLLECTOR,
  });
  expect(transition(fixtures["withdraw-error"], ev.withdrawStart).op).toEqual({ kind: "withdraw", status: "pending" });
  // And the retried purchase can then succeed.
  const done = run(fixtures["purchase-error"], ev.purchaseStart, ev.purchaseSuccessA);
  expect(done.hand).toEqual({ shopRecordId: A, recordId: "0xrA2" });
  expect(done.op).toBeNull();
});

// ------------------------------------------------------------ random walk

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [1, 2, 3]) {
  test(`random walk (seed ${seed}): 2000 events, invariants hold after every step`, () => {
    const rand = mulberry32(seed);
    const pickOne = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    let minted = 0;
    let s = initialState();
    const history: string[] = [];
    const counts = { accept: 0, noop: 0, reject: 0 };
    for (let i = 0; i < 2000; i++) {
      // The representative set, plus the dynamic variants a real chain would produce:
      // a fresh Record id per purchase for the release in hand, holdOwned of any owned Record,
      // a collection read that reports chain truth, the reads' load ops, other buyers.
      const kind = pickOne([...(Object.keys(ev) as EventName[]), "purchaseSuccessHeld", "holdAnyOwned", "collectionTruth", "loadStart", "loadFail", "catalogLoaded", "setZoneShop", "sellStartOther", "buyerReturnedOther", "smashCar1"] as const);
      let action: GameAction;
      switch (kind) {
        case "purchaseSuccessHeld":
          action = { type: "purchaseSuccess", owned: rec(s.hand?.shopRecordId ?? A, `0xm${++minted}`), digest: "D", balance: rand() < 0.3 ? null : 5_000_000n, amount: 1n };
          break;
        case "holdAnyOwned":
          action = { type: "holdOwned", recordId: s.owned.length ? pickOne(s.owned).recordId : "0xnone" };
          break;
        case "collectionTruth":
          action = { type: "collectionLoaded", owned: s.owned.filter(() => rand() < 0.7) };
          break;
        case "loadStart":
          action = { type: "loadStart", kind: pickOne(["catalog", "wallet", "collection"] as const) };
          break;
        case "loadFail":
          action = { type: "loadFail", kind: pickOne(["catalog", "wallet", "collection"] as const), error: "Read failed." };
          break;
        case "catalogLoaded":
          action = { type: "catalogLoaded", prices: { [A]: PRICE_A, [B]: PRICE_B } };
          break;
        case "setZoneShop":
          action = { type: "setZone", zone: "shop" };
          break;
        case "sellStartOther":
          action = { type: "sellStart", npcId: OTHER_NPC };
          break;
        case "buyerReturnedOther":
          action = { type: "buyerReturned", npcId: OTHER_NPC };
          break;
        case "smashCar1":
          action = { type: "smash", carId: "car:1" };
          break;
        case "purchaseSuccessA":
          // The fixed representative id; mint a fresh one so the chain never reuses an id.
          action = { ...ev.purchaseSuccessA, owned: rec(A, `0xm${++minted}`) };
          break;
        case "reset":
          // Rare, so the walk gets deep.
          action = rand() < 0.1 ? ev.reset : ev.stop;
          break;
        default:
          action = ev[kind as EventName];
      }
      history.push(action.type);
      let r: ReturnType<typeof step>;
      expect(() => (r = step(s, action)), `step ${i} ${action.type} threw`).not.toThrow();
      r = r!;
      if (r.rejected !== null) {
        counts.reject++;
        expect(r.state, `step ${i} ${action.type} rejected but changed`).toBe(s);
      } else counts[r.state === s ? "noop" : "accept"]++;
      const v = invariantViolations(r.state);
      if (v.length) throw new Error(`seed ${seed} step ${i} (${history.slice(-12).join(" > ")}): ${v.join("; ")}`);
      s = r.state;
    }
    // The walk actually explored: plenty of accepted moves and some sales.
    expect(counts.accept).toBeGreaterThan(400);
    expect(counts.reject).toBeGreaterThan(100);
  });
}

test("purchaseSuccess with a Record sold this session is refused (stale lost answer)", () => {
  // Buy A (0xrA), sell it, pick A again and pay: an adapter handing back 0xrA must not
  // make the sold Record owned again (invariant: sold ⇒ not owned).
  const sold = run(
    initialState(),
    { type: "walletLoaded", balance: START },
    { type: "setZone", zone: "shop" },
    { type: "pick", shopRecordId: A },
    { type: "purchaseStart" },
    { type: "purchaseSuccess", owned: rA, digest: "P1", balance: START - PRICE_A, amount: PRICE_A },
    { type: "sellStart", npcId: COLLECTOR },
    { type: "sellSuccess", paid: 18_000_000n, digest: "S1", balance: START + 6_000_000n },
    { type: "buyerReturned", npcId: COLLECTOR },
    { type: "pick", shopRecordId: A },
    { type: "purchaseStart" },
  );
  const r = step(sold, { type: "purchaseSuccess", owned: rA, digest: "P1", balance: null, amount: PRICE_A });
  expect(r.rejected).toBeTruthy();
  expect(r.state).toBe(sold);
  expect(invariantViolations(r.state)).toEqual([]);
});

test("malformed payloads are refused or sanitised, never corrupt state", () => {
  const s = run(initialState(), { type: "walletLoaded", balance: START });
  for (const bad of [{ type: "walletLoaded" }, { type: "walletLoaded", balance: 5 }, { type: "setZone", zone: "moon" }]) {
    const r = step(s, bad as unknown as GameAction);
    expect(r.rejected, JSON.stringify(bad)).toBeTruthy();
    expect(r.state).toBe(s);
  }
  const dup = step(s, { type: "collectionLoaded", owned: [rA, rA] });
  expect(dup.state.owned.map((r) => r.recordId)).toEqual(["0xrA"]);
  expect(invariantViolations(dup.state)).toEqual([]);
});
