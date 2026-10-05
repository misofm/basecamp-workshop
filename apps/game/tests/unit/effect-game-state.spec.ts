import { expect, test } from "@playwright/test";
import { Effect, Fiber, Stream } from "effect";
import { GameState, GameStateStore } from "../../src/app/game-state";
import { initialState, invariantViolations, step, type GameAction } from "../../src/game/state";
import type { OwnedRecord } from "../../src/miso/types";

const owned: OwnedRecord = {
  recordId: "0xrec1",
  shopRecordId: "low-tide-tapes",
  title: "Low Tide Tapes",
  artist: "Harbor Lights",
  coverUrl: "/covers/low-tide-tapes.png",
  serial: 106,
  maxSupply: 250,
  acquiredAt: 1,
};

const purchase: GameAction[] = [
  { type: "setZone", zone: "shop" },
  { type: "walletLoaded", balance: 100_000_000n },
  { type: "pick", shopRecordId: "low-tide-tapes" },
  { type: "purchaseStart" },
  { type: "purchaseSuccess", owned, digest: "D1", balance: 88_000_000n, amount: 12_000_000n },
];

/** Refused by step() from the initial state (nothing pending). */
const REFUSED: GameAction = { type: "purchaseSuccess", owned, digest: "D0", balance: null, amount: 1n };
/** A harmless no-op from the initial state (stop while silent). */
const NOOP: GameAction = { type: "stop" };

test("fixtures: REFUSED is rejected and NOOP is a same-state no-op", () => {
  const s = initialState();
  expect(step(s, REFUSED).rejected).not.toBeNull();
  const noop = step(s, NOOP);
  expect(noop.rejected).toBeNull();
  expect(noop.state).toBe(s);
});

test("dispatch returns true when accepted, false when refused or a no-op", () => {
  const store = GameStateStore.makeSync();
  const start = store.current;
  expect(start).toEqual(initialState());
  expect(store.dispatch(REFUSED)).toBe(false);
  expect(store.current).toBe(start);
  expect(store.dispatch(NOOP)).toBe(false);
  expect(store.current).toBe(start);
  expect(store.dispatch({ type: "setZone", zone: "shop" })).toBe(true);
  expect(store.current).not.toBe(start);
  expect(store.current.zone).toBe("shop");
  // Same zone again: no-op.
  expect(store.dispatch({ type: "setZone", zone: "shop" })).toBe(false);
});

test("pick → purchase: every step accepted and invariants hold", () => {
  const store = GameStateStore.makeSync();
  for (const a of purchase) {
    expect(store.dispatch(a), a.type).toBe(true);
    expect(invariantViolations(store.current), a.type).toEqual([]);
  }
  expect(store.current.hand).toEqual({ shopRecordId: "low-tide-tapes", recordId: "0xrec1" });
  expect(store.current.op).toBeNull();
  // A second success is refused (no purchase pending).
  expect(store.dispatch(purchase[4])).toBe(false);
});

test("changes emits the current state, then accepted transitions only", async () => {
  const store = GameStateStore.makeSync();
  const start = store.current;
  const seen = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 3)));
      yield* Effect.yieldNow;
      store.dispatch(REFUSED);
      store.dispatch(NOOP);
      store.dispatch({ type: "setZone", zone: "shop" });
      store.dispatch({ type: "setZone", zone: "shop" });
      store.dispatch(NOOP);
      store.dispatch({ type: "walletLoaded", balance: 5n });
      return yield* Fiber.join(fiber);
    }),
  );
  expect(seen).toHaveLength(3);
  expect(seen[0]).toBe(start);
  expect(seen[1].zone).toBe("shop");
  expect(seen[1].balance).toBeNull();
  expect(seen[2]).toBe(store.current);
  expect(seen[2].balance).toBe(5n);
});

test("Effect API: GameState.layer, get and dispatchEffect", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const gs = yield* GameState;
      const before = yield* gs.get;
      const refused = yield* gs.dispatchEffect(REFUSED);
      const accepted = yield* gs.dispatchEffect({ type: "setZone", zone: "shop" });
      const after = yield* gs.get;
      return { before, refused, accepted, after, current: gs.current };
    }).pipe(Effect.provide(GameState.layer)),
  );
  expect(result.before).toEqual(initialState());
  expect(result.refused).toBe(false);
  expect(result.accepted).toBe(true);
  expect(result.after.zone).toBe("shop");
  expect(result.current).toBe(result.after);
});

test("each GameState.layer build is a fresh store", async () => {
  const zone = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const gs = yield* GameState;
        return gs.current.zone;
      }).pipe(Effect.provide(GameState.layer)),
    );
  await Effect.runPromise(
    Effect.gen(function* () {
      const gs = yield* GameState;
      gs.dispatch({ type: "setZone", zone: "shop" });
    }).pipe(Effect.provide(GameState.layer)),
  );
  expect(await zone()).toBe(initialState().zone);
});
