/**
 * The game's state machine. PURE: no DOM, no Three.js, no async, no adapter calls.
 *
 * Owns: where each record physically is (shelf / hand / deck / with a buyer),
 * what the player owns (a cache of chain truth from the MisoAdapter), which
 * cars are smashed, and which single chain operation is in flight.
 * Must not: talk to the chain, render, play audio or read the clock. The
 * controller performs side effects and reports results back as actions
 * (purchaseStart -> adapter.purchase() -> purchaseSuccess / purchaseFail).
 *
 * ## Shelf vs hand, per shopRecordId
 * The shop has ONE physical object per release (ShopRecord.id) — the world
 * never duplicates it. The shelf copy is *stock*: buying a release mints a new
 * on-chain Record, it does not empty the shelf forever. So for a shopRecordId:
 *  - "hand"  the player holds that release's object. `HeldItem.recordId` says
 *            whether it is unpaid stock (null) or an owned on-chain Record.
 *  - "deck"  it sits on the listening deck (paid or unpaid).
 *  - "npc"   the collector is carrying this release's object away after the
 *            latest sale (`buyerAway`). When they come back (`buyerReturned`,
 *            so a presenter can rerun the sale) it is back in stock on the shelf.
 *  - "shelf" everywhere else — including releases the player owns but is not
 *            holding (owned Records live in the collection, not in the world).
 * A release can be bought again; each purchase is a separate OwnedRecord.
 *
 * Unpaid stock can never leave the shop (canLeaveShop). Sold-out checks need
 * catalog data, so the controller does them before dispatching pick.
 *
 * ## Rules (docs/STATE-MODEL.md has the full transition table and invariants)
 * - `step` is the single transition function. It returns `{ state, rejected }`:
 *   an illegal action gives back the SAME state object plus a reason (the
 *   controller logs it as a dev-console warning); a harmless no-op (setZone to
 *   the current zone, stop while silent…) gives back the same object with
 *   `rejected: null`. `step` never throws. `transition` is `step(...).state`.
 * - Only one op at a time: starting any op while one is pending is refused.
 *   An op in "error" status may be replaced by a new op (retry) or dismissed.
 * - While a purchase or sell is pending, the held record is locked (no pick,
 *   put back, deck moves, holdOwned, stowOwned or smash). A withdraw (the
 *   street ATM) only moves money, so it never locks the hand.
 * - A purchase / sell error is about the record in your hand: once the hand
 *   changes, the error is stale and is cleared (Retry would act on another record).
 * - Chain reads can lag or race a transaction: collectionLoaded never drops the
 *   Record in your hand or on the deck and never resurrects one you sold;
 *   balances are never negative (an unknown balance stays null).
 * - `invariantViolations(state)` lists broken invariants (empty for every state
 *   `step` can produce from `initialState()`); the controller checks it in dev.
 */
import type { OwnedRecord } from "../miso/types";

export interface HeldItem {
  shopRecordId: string;
  /** null = unpaid shop stock; set = an owned on-chain Record id. */
  recordId: string | null;
}

export type OpKind = "catalog" | "wallet" | "purchase" | "sell" | "withdraw" | "collection";

/** One chain operation: in flight, or failed with a player-safe message (Retry / dismiss). */
export type PendingOp =
  | {
      kind: OpKind;
      status: "pending";
      /** purchase: shopRecordId; sell: npcId. */
      targetId?: string;
    }
  | {
      kind: OpKind;
      status: "error";
      error: string;
      /** purchase: shopRecordId; sell: npcId. */
      targetId?: string;
    };

export interface SoldRecord {
  recordId: string;
  shopRecordId: string;
  npcId: string;
  paid: bigint;
}

export type Receipt =
  | {
      kind: "purchase" | "sell";
      shopRecordId: string;
      recordId: string;
      digest: string;
      amount: bigint;
    }
  /** FakeUSD from the street ATM (no Record involved). */
  | { kind: "withdraw"; digest: string; amount: bigint };

export type Zone = "street" | "shop";

export interface GameState {
  hand: HeldItem | null;
  deck: HeldItem | null;
  /** Non-null only while deck != null. */
  playing: { trackIndex: number } | null;
  /** Cache of chain truth, newest first. */
  owned: OwnedRecord[];
  sold: SoldRecord[];
  /** The buyer currently walking off with a sold release; null once they're back. */
  buyerAway: { npcId: string; shopRecordId: string } | null;
  smashedCars: string[];
  /** shopRecordIds previewed on the deck. */
  listened: string[];
  /** FakeUSD base units; null until the wallet loads. */
  balance: bigint | null;
  /** Shop price (FakeUSD base units) per shopRecordId; filled at catalog load. */
  prices: Readonly<Record<string, bigint>>;
  op: PendingOp | null;
  zone: Zone;
  lastReceipt: Receipt | null;
  /** The exit beat happened: Gamer took Inicio home after a sale (bible §7.4). */
  wentHome: boolean;
}

export type LoadKind = "catalog" | "wallet" | "collection";

export type GameAction =
  // Physical record handling
  | { type: "pick"; shopRecordId: string }
  | { type: "putBack" }
  | { type: "placeOnDeck" }
  | { type: "takeFromDeck" }
  | { type: "swapWithDeck" }
  | { type: "holdOwned"; recordId: string }
  /** Put a held owned Record away (back into the collection; it leaves the world). */
  | { type: "stowOwned" }
  // Deck playback
  | { type: "play"; trackIndex?: number }
  | { type: "nextTrack"; trackCount: number }
  | { type: "stop" }
  // Purchase at the cashier
  | { type: "purchaseStart" }
  /** `balance`: the re-read wallet balance, or null when it could not be read (keeps the known one). */
  | { type: "purchaseSuccess"; owned: OwnedRecord; digest: string; balance: bigint | null; amount: bigint }
  | { type: "purchaseFail"; error: string }
  // Sell to a street buyer
  | { type: "sellStart"; npcId: string }
  | { type: "sellSuccess"; paid: bigint; digest: string; balance: bigint | null }
  | { type: "sellFail"; error: string }
  // Withdraw FakeUSD at the street ATM
  | { type: "withdrawStart" }
  | { type: "withdrawSuccess"; digest: string; amount: bigint; balance: bigint | null }
  | { type: "withdrawFail"; error: string }
  /** The buyer came back to their spot (repeatable demo): their record is stock again. */
  | { type: "buyerReturned"; npcId: string }
  // Reads (optional pending UI for catalog / wallet / collection loads)
  | { type: "loadStart"; kind: LoadKind }
  | { type: "loadFail"; kind: LoadKind; error: string }
  /** `prices`: shop price per shopRecordId (for the "short on FakeUSD" objective). */
  | { type: "catalogLoaded"; prices?: Record<string, bigint> }
  | { type: "collectionLoaded"; owned: OwnedRecord[] }
  | { type: "walletLoaded"; balance: bigint }
  // World
  | { type: "smash"; carId: string }
  | { type: "setZone"; zone: Zone }
  | { type: "dismissError" }
  /** Exit beat: head home with Inicio (only after a sale, nothing pending, once). */
  | { type: "goHome" }
  | { type: "reset" };

export const initialState = (): GameState => ({
  hand: null,
  deck: null,
  playing: null,
  owned: [],
  sold: [],
  buyerAway: null,
  smashedCars: [],
  listened: [],
  balance: null,
  prices: {},
  op: null,
  zone: "street",
  lastReceipt: null,
  wentHome: false,
});

// ---------------------------------------------------------------- selectors

export type RecordPlace = "shelf" | "hand" | "deck" | "npc";

/** Where the single physical object for a release is. See the header comment. */
export function recordPlace(state: GameState, shopRecordId: string): RecordPlace {
  if (state.hand?.shopRecordId === shopRecordId) return "hand";
  if (state.deck?.shopRecordId === shopRecordId) return "deck";
  if (state.buyerAway?.shopRecordId === shopRecordId) return "npc";
  return "shelf";
}

export const isBusy = (state: GameState): boolean => state.op?.status === "pending";
export const heldIsOwned = (state: GameState): boolean => state.hand?.recordId != null;
export const heldIsUnpaid = (state: GameState): boolean =>
  state.hand !== null && state.hand.recordId === null;
/** False while carrying unpaid stock (the doorway blocks you). */
export const canLeaveShop = (state: GameState): boolean => !heldIsUnpaid(state);
export const isCarSmashed = (state: GameState, carId: string): boolean =>
  state.smashedCars.includes(carId);
export const ownedRecord = (state: GameState, recordId: string): OwnedRecord | undefined =>
  state.owned.find((r) => r.recordId === recordId);
/** The OwnedRecord the player is holding, if any. */
export const heldOwnedRecord = (state: GameState): OwnedRecord | undefined =>
  state.hand?.recordId ? ownedRecord(state, state.hand.recordId) : undefined;
/** True while a purchase/sell is in flight and the held record must not move. */
export const handLocked = (state: GameState): boolean =>
  isBusy(state) && (state.op?.kind === "purchase" || state.op?.kind === "sell");

/** The cheapest shop price, or null before the catalog loads. */
export function cheapestPrice(state: GameState): bigint | null {
  let min: bigint | null = null;
  for (const price of Object.values(state.prices)) if (min === null || price < min) min = price;
  return min;
}

export function canPick(state: GameState, shopRecordId: string): boolean {
  return (
    !handLocked(state) &&
    !heldIsOwned(state) &&
    recordPlace(state, shopRecordId) === "shelf"
  );
}

/** May the player head home (exit beat)? After a sale, nothing pending, not already home. */
export const canGoHome = (state: GameState): boolean => state.sold.length > 0 && !isBusy(state) && !state.wentHome;

/** May a new op start? (Nothing pending; a previous error may be replaced.) */
const canStartOp = (state: GameState): boolean => !isBusy(state);

// --------------------------------------------------------------- transition

/** Result of one transition: the next state, or the same object plus why it was refused. */
export interface StepResult {
  state: GameState;
  /** null = accepted (or a harmless no-op); a reason = illegal in this state. */
  rejected: string | null;
}

/** Apply an action. Illegal actions are a no-op (same object back). Never throws. */
export function transition(state: GameState, action: GameAction): GameState {
  return step(state, action).state;
}

/** The single transition function: next state, or the same state plus the reason it was refused. */
export function step(state: GameState, action: GameAction): StepResult {
  try {
    return stepUnsafe(state, action);
  } catch (error) {
    // Defensive: a malformed action (e.g. from the console) must never crash the game.
    return { state, rejected: `threw: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const ok = (state: GameState): StepResult => ({ state, rejected: null });
const no = (state: GameState, reason: string): StepResult => ({ state, rejected: reason });

/** A new balance from a chain result: null or negative (impossible) keeps the known one. */
const nextBalance = (state: GameState, balance: bigint | null): bigint | null =>
  typeof balance === "bigint" && balance >= 0n ? balance : state.balance;

/**
 * Move the record(s) between hand and deck. A purchase / sell error describes the record
 * that was in the hand, so it is cleared once the hand changes (no Retry on the wrong record).
 */
function moveRecords(state: GameState, patch: Pick<Partial<GameState>, "hand" | "deck" | "playing">): GameState {
  const next = { ...state, ...patch };
  if (next.op?.status === "error" && (next.op.kind === "purchase" || next.op.kind === "sell")) next.op = null;
  return next;
}

const LOCKED = "hand locked: a purchase or sale is in flight";

function stepUnsafe(state: GameState, action: GameAction): StepResult {
  switch (action.type) {
    case "pick": {
      if (handLocked(state)) return no(state, LOCKED);
      if (heldIsOwned(state)) return no(state, "hands full (holding an owned Record)");
      const place = recordPlace(state, action.shopRecordId);
      if (place !== "shelf") return no(state, `that release is not on the shelf (${place})`);
      // Holding unpaid stock? It goes back to its shelf (swap).
      return ok(moveRecords(state, { hand: { shopRecordId: action.shopRecordId, recordId: null } }));
    }

    case "putBack":
      if (handLocked(state)) return no(state, LOCKED);
      if (!heldIsUnpaid(state)) return no(state, "not holding unpaid stock");
      return ok(moveRecords(state, { hand: null }));

    case "placeOnDeck":
      if (handLocked(state)) return no(state, LOCKED);
      if (!state.hand) return no(state, "nothing in hand");
      if (state.deck) return no(state, "the deck is occupied");
      return ok(moveRecords(state, { deck: state.hand, hand: null, playing: null }));

    case "takeFromDeck":
      if (handLocked(state)) return no(state, LOCKED);
      if (!state.deck) return no(state, "the deck is empty");
      if (state.hand) return no(state, "hands full");
      return ok(moveRecords(state, { hand: state.deck, deck: null, playing: null }));

    case "swapWithDeck":
      if (handLocked(state)) return no(state, LOCKED);
      if (!state.deck || !state.hand) return no(state, "swap needs a record in hand and one on the deck");
      return ok(moveRecords(state, { hand: state.deck, deck: state.hand, playing: null }));

    case "holdOwned": {
      if (handLocked(state)) return no(state, LOCKED);
      const record = ownedRecord(state, action.recordId);
      if (!record) return no(state, "not an owned Record");
      if (state.hand?.recordId != null) return no(state, "already holding an owned Record");
      if (state.deck?.recordId === action.recordId) return no(state, "that Record is on the deck");
      // One physical object per release: can't conjure it while that release is on the deck
      // or walking away with the collector.
      if (state.deck?.shopRecordId === record.shopRecordId) return no(state, "that release is on the deck");
      if (state.buyerAway?.shopRecordId === record.shopRecordId) return no(state, "that release is with the collector");
      return ok(moveRecords(state, { hand: { shopRecordId: record.shopRecordId, recordId: record.recordId } }));
    }

    case "stowOwned":
      if (handLocked(state)) return no(state, LOCKED);
      if (!heldIsOwned(state)) return no(state, "not holding an owned Record");
      return ok(moveRecords(state, { hand: null }));

    case "play": {
      if (!state.deck) return no(state, "the deck is empty");
      const id = state.deck.shopRecordId;
      return ok({
        ...state,
        playing: { trackIndex: Math.max(0, Math.floor(action.trackIndex ?? 0) || 0) },
        listened: state.listened.includes(id) ? state.listened : [...state.listened, id],
      });
    }

    case "nextTrack":
      if (!state.playing) return no(state, "nothing is playing");
      if (!(action.trackCount >= 1)) return no(state, "no tracks");
      return ok({
        ...state,
        playing: { trackIndex: (state.playing.trackIndex + 1) % Math.floor(action.trackCount) },
      });

    case "stop":
      return ok(state.playing ? { ...state, playing: null } : state);

    case "purchaseStart":
      if (!canStartOp(state)) return no(state, `busy: ${state.op?.kind} pending`);
      if (!state.hand || state.hand.recordId !== null) return no(state, "not holding unpaid stock");
      return ok({
        ...state,
        op: { kind: "purchase", status: "pending", targetId: state.hand.shopRecordId },
      });

    case "purchaseSuccess": {
      if (!isPending(state, "purchase")) return no(state, "no purchase pending");
      if (!state.hand || state.hand.recordId !== null) return no(state, "not holding unpaid stock");
      if (state.hand.shopRecordId !== action.owned.shopRecordId) return no(state, "the Record bought is not the one in hand");
      if (state.sold.some((r) => r.recordId === action.owned.recordId)) return no(state, "that Record was sold this session");
      return ok({
        ...state,
        hand: { shopRecordId: action.owned.shopRecordId, recordId: action.owned.recordId },
        owned: [action.owned, ...state.owned.filter((r) => r.recordId !== action.owned.recordId)],
        balance: nextBalance(state, action.balance),
        op: null,
        lastReceipt: {
          kind: "purchase",
          shopRecordId: action.owned.shopRecordId,
          recordId: action.owned.recordId,
          digest: action.digest,
          amount: action.amount,
        },
      });
    }

    case "purchaseFail":
      if (!isPending(state, "purchase")) return no(state, "no purchase pending");
      return ok({ ...state, op: { kind: "purchase", status: "error", error: action.error, targetId: state.op?.targetId } });

    case "sellStart":
      if (!canStartOp(state)) return no(state, `busy: ${state.op?.kind} pending`);
      if (!heldIsOwned(state)) return no(state, "not holding an owned Record");
      if (state.buyerAway?.npcId === action.npcId) return no(state, "that buyer is away");
      return ok({ ...state, op: { kind: "sell", status: "pending", targetId: action.npcId } });

    case "sellSuccess": {
      if (!isPending(state, "sell")) return no(state, "no sale pending");
      if (!state.hand || state.hand.recordId === null) return no(state, "not holding an owned Record");
      const { shopRecordId, recordId } = state.hand;
      const npcId = state.op?.targetId ?? "buyer";
      return ok({
        ...state,
        hand: null,
        owned: state.owned.filter((r) => r.recordId !== recordId),
        sold: [...state.sold, { recordId, shopRecordId, npcId, paid: action.paid }],
        buyerAway: { npcId, shopRecordId },
        balance: nextBalance(state, action.balance),
        op: null,
        lastReceipt: { kind: "sell", shopRecordId, recordId, digest: action.digest, amount: action.paid },
      });
    }

    case "sellFail":
      if (!isPending(state, "sell")) return no(state, "no sale pending");
      return ok({ ...state, op: { kind: "sell", status: "error", error: action.error, targetId: state.op?.targetId } });

    case "withdrawStart":
      if (!canStartOp(state)) return no(state, `busy: ${state.op?.kind} pending`);
      return ok({ ...state, op: { kind: "withdraw", status: "pending" } });

    case "withdrawSuccess":
      if (!isPending(state, "withdraw")) return no(state, "no withdrawal pending");
      return ok({
        ...state,
        balance: nextBalance(state, action.balance),
        op: null,
        lastReceipt: { kind: "withdraw", digest: action.digest, amount: action.amount },
      });

    case "withdrawFail":
      if (!isPending(state, "withdraw")) return no(state, "no withdrawal pending");
      return ok({ ...state, op: { kind: "withdraw", status: "error", error: action.error } });

    case "buyerReturned":
      // The return timer and buyerReturnNow() can both fire: a second return is a harmless no-op.
      if (state.buyerAway?.npcId !== action.npcId) return ok(state);
      return ok({ ...state, buyerAway: null });

    case "loadStart":
      if (!canStartOp(state)) return no(state, `busy: ${state.op?.kind} pending`);
      return ok({ ...state, op: { kind: action.kind, status: "pending" } });

    case "loadFail":
      if (!isPending(state, action.kind)) return no(state, `no ${action.kind} read pending`);
      return ok({ ...state, op: { kind: action.kind, status: "error", error: action.error } });

    case "catalogLoaded": {
      const prices = action.prices ? { ...action.prices } : state.prices;
      if (!isPending(state, "catalog") && prices === state.prices) return ok(state);
      return ok({ ...state, prices, op: isPending(state, "catalog") ? null : state.op });
    }

    case "collectionLoaded": {
      // Chain reads can lag a sale or race a purchase. Never resurrect a Record sold this
      // session, and never drop the one in your hand / on the deck (the HUD would read
      // UNPAID and the sale could not start). The read is truth for everything else.
      const sold = new Set(state.sold.map((r) => r.recordId));
      const seen = new Set<string>();
      const owned = action.owned.filter((r) => !sold.has(r.recordId) && !seen.has(r.recordId) && !!seen.add(r.recordId));
      for (const item of [state.deck, state.hand]) {
        if (!item?.recordId || owned.some((r) => r.recordId === item.recordId)) continue;
        const known = ownedRecord(state, item.recordId);
        if (known) owned.unshift(known);
      }
      return ok({
        ...state,
        owned,
        op: isPending(state, "collection") ? null : state.op,
      });
    }

    case "walletLoaded":
      if (typeof action.balance !== "bigint" || action.balance < 0n) return no(state, "not a balance");
      return ok({
        ...state,
        balance: action.balance,
        op: isPending(state, "wallet") ? null : state.op,
      });

    case "smash":
      if (!state.hand) return no(state, "nothing in hand to swing");
      // The record mid-sale (or mid-purchase) stays put: no swinging it at a car.
      if (handLocked(state)) return no(state, LOCKED);
      if (isCarSmashed(state, action.carId)) return no(state, "that car is already smashed");
      return ok({ ...state, smashedCars: [...state.smashedCars, action.carId] });

    case "setZone":
      if (action.zone !== "street" && action.zone !== "shop") return no(state, "unknown zone");
      return ok(state.zone === action.zone ? state : { ...state, zone: action.zone });

    case "dismissError":
      // Error dialogs dismiss on close; after a Retry started there is nothing to dismiss.
      return ok(state.op?.status === "error" ? { ...state, op: null } : state);

    case "goHome":
      if (state.wentHome) return no(state, "already home");
      if (state.sold.length === 0) return no(state, "nothing sold yet");
      if (isBusy(state)) return no(state, `busy: ${state.op?.kind} pending`);
      return ok({ ...state, wentHome: true });

    case "reset":
      return ok(initialState());

    default: {
      const unknown: never = action;
      return no(state, `unknown action ${JSON.stringify((unknown as { type?: unknown }).type)}`);
    }
  }
}

function isPending(state: GameState, kind: OpKind): boolean {
  return state.op?.kind === kind && state.op.status === "pending";
}

// --------------------------------------------------------------- invariants

/**
 * Invariants every reachable state satisfies (docs/STATE-MODEL.md). Returns the broken
 * ones (empty = fine). Pure; the controller checks it after each transition in dev and the
 * unit tests check it for every state x action.
 */
export function invariantViolations(s: GameState): string[] {
  const out: string[] = [];
  if (s.playing && !s.deck) out.push("playing without a record on the deck");
  const places = [s.hand?.shopRecordId, s.deck?.shopRecordId, s.buyerAway?.shopRecordId].filter((x): x is string => !!x);
  if (new Set(places).size !== places.length) out.push("one release in two places (hand / deck / collector)");
  for (const [where, item] of [["hand", s.hand], ["deck", s.deck]] as const) {
    if (!item?.recordId) continue;
    const record = ownedRecord(s, item.recordId);
    if (!record) out.push(`${where} holds a Record that is not owned`);
    else if (record.shopRecordId !== item.shopRecordId) out.push(`${where} Record belongs to another release`);
  }
  if (s.hand?.recordId && s.hand.recordId === s.deck?.recordId) out.push("the same Record in hand and on the deck");
  const ids = s.owned.map((r) => r.recordId);
  if (new Set(ids).size !== ids.length) out.push("duplicate owned Record");
  for (const sale of s.sold) if (ids.includes(sale.recordId)) out.push("a sold Record is still owned");
  if (s.op?.status === "pending" && s.op.kind === "purchase" && (!heldIsUnpaid(s) || s.op.targetId !== s.hand?.shopRecordId))
    out.push("purchase pending without that unpaid record in hand");
  if (s.op?.status === "pending" && s.op.kind === "sell" && !heldIsOwned(s)) out.push("sale pending without an owned Record in hand");
  if (s.op?.status === "error" && !s.op.error) out.push("error op without a message");
  if (s.balance !== null && s.balance < 0n) out.push("negative balance");
  if (s.wentHome && s.sold.length === 0) out.push("went home before any sale");
  if (new Set(s.smashedCars).size !== s.smashedCars.length) out.push("car smashed twice");
  return out;
}
