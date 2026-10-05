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
 * ## Rules
 * - `transition` returns the SAME state object for an illegal action, so the
 *   controller can detect refusal with `next === state`.
 * - Only one op at a time: starting any op while one is pending is refused.
 *   An op in "error" status may be replaced by a new op (retry) or dismissed.
 * - While a purchase or sell is pending, the held record is locked (no pick,
 *   put back, deck moves or holdOwned).
 */
import type { OwnedRecord } from "../miso/types";

export interface HeldItem {
  shopRecordId: string;
  /** null = unpaid shop stock; set = an owned on-chain Record id. */
  recordId: string | null;
}

export type OpKind = "catalog" | "wallet" | "purchase" | "sell" | "collection";

export interface PendingOp {
  kind: OpKind;
  status: "pending" | "error";
  error?: string;
  /** purchase: shopRecordId; sell: npcId. */
  targetId?: string;
}

export interface SoldRecord {
  recordId: string;
  shopRecordId: string;
  npcId: string;
  paid: bigint;
}

export interface Receipt {
  kind: "purchase" | "sell";
  shopRecordId: string;
  recordId: string;
  digest: string;
  amount: bigint;
}

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
  op: PendingOp | null;
  zone: Zone;
  lastReceipt: Receipt | null;
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
  | { type: "purchaseSuccess"; owned: OwnedRecord; digest: string; balance: bigint; amount: bigint }
  | { type: "purchaseFail"; error: string }
  // Sell to a street buyer
  | { type: "sellStart"; npcId: string }
  | { type: "sellSuccess"; paid: bigint; digest: string; balance: bigint }
  | { type: "sellFail"; error: string }
  /** The buyer came back to their spot (repeatable demo): their record is stock again. */
  | { type: "buyerReturned"; npcId: string }
  // Reads (optional pending UI for catalog / wallet / collection loads)
  | { type: "loadStart"; kind: LoadKind }
  | { type: "loadFail"; kind: LoadKind; error: string }
  | { type: "catalogLoaded" }
  | { type: "collectionLoaded"; owned: OwnedRecord[] }
  | { type: "walletLoaded"; balance: bigint }
  // World
  | { type: "smash"; carId: string }
  | { type: "setZone"; zone: Zone }
  | { type: "dismissError" }
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
  op: null,
  zone: "street",
  lastReceipt: null,
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

export function canPick(state: GameState, shopRecordId: string): boolean {
  return (
    !handLocked(state) &&
    !heldIsOwned(state) &&
    recordPlace(state, shopRecordId) === "shelf"
  );
}

/** May a new op start? (Nothing pending; a previous error may be replaced.) */
const canStartOp = (state: GameState): boolean => !isBusy(state);

// --------------------------------------------------------------- transition

export function transition(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "pick": {
      if (!canPick(state, action.shopRecordId)) return state;
      // Holding unpaid stock? It goes back to its shelf (swap).
      return { ...state, hand: { shopRecordId: action.shopRecordId, recordId: null } };
    }

    case "putBack":
      if (handLocked(state) || !heldIsUnpaid(state)) return state;
      return { ...state, hand: null };

    case "placeOnDeck":
      if (handLocked(state) || !state.hand || state.deck) return state;
      return { ...state, deck: state.hand, hand: null, playing: null };

    case "takeFromDeck":
      if (handLocked(state) || !state.deck || state.hand) return state;
      return { ...state, hand: state.deck, deck: null, playing: null };

    case "swapWithDeck":
      if (handLocked(state) || !state.deck || !state.hand) return state;
      return { ...state, hand: state.deck, deck: state.hand, playing: null };

    case "holdOwned": {
      if (handLocked(state)) return state;
      const record = ownedRecord(state, action.recordId);
      if (!record) return state;
      if (state.hand?.recordId != null) return state; // already holding an owned record
      if (state.deck?.recordId === action.recordId) return state; // it's on the deck
      // One physical object per release: can't conjure it while that release is on the deck.
      if (state.deck?.shopRecordId === record.shopRecordId) return state;
      return { ...state, hand: { shopRecordId: record.shopRecordId, recordId: record.recordId } };
    }

    case "stowOwned":
      if (handLocked(state) || !heldIsOwned(state)) return state;
      return { ...state, hand: null };

    case "play": {
      if (!state.deck) return state;
      const id = state.deck.shopRecordId;
      return {
        ...state,
        playing: { trackIndex: Math.max(0, action.trackIndex ?? 0) },
        listened: state.listened.includes(id) ? state.listened : [...state.listened, id],
      };
    }

    case "nextTrack":
      if (!state.playing || action.trackCount < 1) return state;
      return {
        ...state,
        playing: { trackIndex: (state.playing.trackIndex + 1) % action.trackCount },
      };

    case "stop":
      return state.playing ? { ...state, playing: null } : state;

    case "purchaseStart":
      if (!canStartOp(state) || !heldIsUnpaid(state)) return state;
      return {
        ...state,
        op: { kind: "purchase", status: "pending", targetId: state.hand!.shopRecordId },
      };

    case "purchaseSuccess": {
      if (!isPending(state, "purchase") || !heldIsUnpaid(state)) return state;
      if (state.hand!.shopRecordId !== action.owned.shopRecordId) return state;
      return {
        ...state,
        hand: { shopRecordId: action.owned.shopRecordId, recordId: action.owned.recordId },
        owned: [action.owned, ...state.owned.filter((r) => r.recordId !== action.owned.recordId)],
        balance: action.balance,
        op: null,
        lastReceipt: {
          kind: "purchase",
          shopRecordId: action.owned.shopRecordId,
          recordId: action.owned.recordId,
          digest: action.digest,
          amount: action.amount,
        },
      };
    }

    case "purchaseFail":
      if (!isPending(state, "purchase")) return state;
      return { ...state, op: { ...state.op!, status: "error", error: action.error } };

    case "sellStart":
      if (!canStartOp(state) || !heldIsOwned(state)) return state;
      return { ...state, op: { kind: "sell", status: "pending", targetId: action.npcId } };

    case "sellSuccess": {
      if (!isPending(state, "sell") || !heldIsOwned(state)) return state;
      const { shopRecordId, recordId } = state.hand as { shopRecordId: string; recordId: string };
      const npcId = state.op!.targetId ?? "buyer";
      return {
        ...state,
        hand: null,
        owned: state.owned.filter((r) => r.recordId !== recordId),
        sold: [...state.sold, { recordId, shopRecordId, npcId, paid: action.paid }],
        buyerAway: { npcId, shopRecordId },
        balance: action.balance,
        op: null,
        lastReceipt: { kind: "sell", shopRecordId, recordId, digest: action.digest, amount: action.paid },
      };
    }

    case "sellFail":
      if (!isPending(state, "sell")) return state;
      return { ...state, op: { ...state.op!, status: "error", error: action.error } };

    case "buyerReturned":
      if (state.buyerAway?.npcId !== action.npcId) return state;
      return { ...state, buyerAway: null };

    case "loadStart":
      if (!canStartOp(state)) return state;
      return { ...state, op: { kind: action.kind, status: "pending" } };

    case "loadFail":
      if (!isPending(state, action.kind)) return state;
      return { ...state, op: { kind: action.kind, status: "error", error: action.error } };

    case "catalogLoaded":
      return isPending(state, "catalog") ? { ...state, op: null } : state;

    case "collectionLoaded":
      return {
        ...state,
        owned: action.owned,
        op: isPending(state, "collection") ? null : state.op,
      };

    case "walletLoaded":
      return {
        ...state,
        balance: action.balance,
        op: isPending(state, "wallet") ? null : state.op,
      };

    case "smash":
      if (!state.hand || isCarSmashed(state, action.carId)) return state;
      return { ...state, smashedCars: [...state.smashedCars, action.carId] };

    case "setZone":
      return state.zone === action.zone ? state : { ...state, zone: action.zone };

    case "dismissError":
      return state.op?.status === "error" ? { ...state, op: null } : state;

    case "reset":
      return initialState();
  }
}

function isPending(state: GameState, kind: OpKind): boolean {
  return state.op?.kind === kind && state.op.status === "pending";
}
