/**
 * GameState service: the one place the game state lives, as a `SubscriptionRef`.
 *
 * Owns: the current `GameState` and the dispatch rule (pure `step()` from game/state.ts,
 * dev-console warnings for refusals and broken invariants, exactly as
 * GameController.dispatch did). `changes` streams the state for observers.
 * Must not: render, talk to the chain or hold game rules (those stay in game/state.ts).
 */
import { Context, Effect, Layer, SubscriptionRef } from "effect";
import type { Stream } from "effect";
import { initialState, invariantViolations, step, type GameAction, type GameState as GameStateData } from "../game/state";

const DEV = Boolean(import.meta.env?.DEV);

export class GameStateStore {
  /** The current value followed by every accepted transition. */
  readonly changes: Stream.Stream<GameStateData>;
  /** The current state, as an Effect. */
  readonly get: Effect.Effect<GameStateData>;

  constructor(readonly ref: SubscriptionRef.SubscriptionRef<GameStateData>) {
    this.changes = SubscriptionRef.changes(ref);
    this.get = SubscriptionRef.get(ref);
  }

  /** A store starting at `state` (default `initialState()`). */
  static make(state: GameStateData = initialState()): Effect.Effect<GameStateStore> {
    return Effect.map(SubscriptionRef.make(state), (ref) => new GameStateStore(ref));
  }

  /** Synchronous `make` (the ref needs no async work). */
  static makeSync(state: GameStateData = initialState()): GameStateStore {
    return Effect.runSync(GameStateStore.make(state));
  }

  /** Current game state (read-only; change it with dispatch()). */
  get current(): GameStateData {
    return SubscriptionRef.getUnsafe(this.ref);
  }

  /**
   * Apply an action. Returns false if the state machine refused it (or it changed nothing).
   * An illegal action is a no-op plus a dev-console warning, never a crash.
   */
  dispatch(action: GameAction): boolean {
    const current = this.current;
    const { state: next, rejected } = step(current, action);
    if (rejected !== null) {
      if (DEV) console.warn(`[game] ${action.type} refused: ${rejected}`);
      return false;
    }
    if (next === current) return false;
    Effect.runSync(SubscriptionRef.set(this.ref, next));
    if (DEV) {
      const broken = invariantViolations(next);
      if (broken.length) console.warn(`[game] invariant broken after ${action.type}: ${broken.join("; ")}`);
    }
    return true;
  }

  /** `dispatch` as an Effect. */
  dispatchEffect(action: GameAction): Effect.Effect<boolean> {
    return Effect.sync(() => this.dispatch(action));
  }
}

/** The game state store as a service. */
export class GameState extends Context.Service<GameState, GameStateStore>()("app/GameState") {
  /** A fresh store at `initialState()`. */
  static readonly layer = Layer.effect(GameState, Effect.suspend(() => GameStateStore.make()));
}
