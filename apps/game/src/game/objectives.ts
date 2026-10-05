/**
 * Mission text for the HUD, GTA style. PURE: derived from GameState only.
 *
 * Owns: the demo's suggested order and its copy:
 *   enter Saisei Records -> pick a record -> preview on the deck -> pay Jazz at the
 *   counter -> head outside -> smash the dead Triangle sedan -> sell to Stonks ->
 *   head home with Inicio (exit beat) -> home.
 * Short on FakeUSD (empty-handed, or holding unpaid stock you can't afford)? The
 * ATM in TriMart's vestibule, next door, comes first.
 * Must not: change state or know positions. `target` is an interactable id
 * (or kind prefix) the controller resolves to a waypoint via the world:
 *   "shop-door" | "deck" | "cashier" | "car" (nearest unsmashed) | "buyer" | "atm" |
 *   "home" (the hotel side door, world.anchors.homeDoor) | null.
 */
import { canGoHome, cheapestPrice, heldIsOwned, heldIsUnpaid, type GameState } from "./state";

export type ObjectiveTarget = "shop-door" | "deck" | "cashier" | "car" | "buyer" | "atm" | "home";

export interface Objective {
  text: string;
  target: ObjectiveTarget | null;
}

export function objective(state: GameState): Objective {
  const op = state.op;
  if (op?.status === "pending" && op.kind === "purchase")
    return { text: "Wait. Jazz is ringing it up.", target: "cashier" };
  if (op?.status === "pending" && op.kind === "sell")
    return { text: "Stonks is checking the wax.", target: "buyer" };
  if (op?.status === "pending" && op.kind === "withdraw")
    return { text: "Wait for the ATM.", target: "atm" };

  if (shortOnFakeUsd(state)) {
    // Unpaid stock can't leave the shop (the doorway blocks it), so put it back first.
    if (heldIsUnpaid(state))
      return { text: "Put it back. Hit the ATM.", target: null };
    return { text: "Get cash at the ATM.", target: "atm" };
  }

  // Empty-handed after a sale. (Pick up another record and the steps start over:
  // Stonks comes back for a rerun of the demo.) Then the exit beat: head home.
  if (state.sold.length > 0 && !state.hand && !state.deck) {
    if (state.wentHome) return { text: "Home. Press H to reset.", target: null };
    if (canGoHome(state))
      return { text: "Head home with Inicio.", target: "home" };
    return { text: "Job done. Check your records.", target: null };
  }

  // Holding a paid-for Record: take it outside, smash, sell.
  if (heldIsOwned(state)) {
    if (state.zone === "shop") return { text: "Take it outside.", target: "shop-door" };
    if (state.smashedCars.length === 0)
      return { text: "Smash the dead sedan.", target: "car" };
    return { text: "Sell to Stonks.", target: "buyer" };
  }

  // On the deck (paid or not).
  if (state.deck && !state.hand) {
    if (state.playing) return { text: "Like it? Take it off.", target: "deck" };
    if (!state.listened.includes(state.deck.shopRecordId))
      return { text: "Drop the needle.", target: "deck" };
    return { text: "Grab the record.", target: "deck" };
  }

  if (heldIsUnpaid(state)) {
    if (!state.listened.includes(state.hand!.shopRecordId))
      return { text: "Spin it on the deck.", target: "deck" };
    return { text: "Pay Jazz.", target: "cashier" };
  }

  // Empty hands.
  if (state.owned.length > 0)
    return { text: "Hold one of your records.", target: null };
  if (state.zone === "street") return { text: "Find a record.", target: "shop-door" };
  return { text: "Pick a record.", target: null };
}

/**
 * True when the known balance can't cover what the player would buy next: the held
 * unpaid record's price, or (empty-handed, nothing on the deck) the cheapest record.
 * False while the balance or the prices are still unknown.
 */
export function shortOnFakeUsd(state: GameState): boolean {
  if (state.balance === null) return false;
  if (heldIsUnpaid(state)) {
    const price = state.prices[state.hand!.shopRecordId];
    return price !== undefined && state.balance < price;
  }
  if (state.hand || state.deck) return false;
  const cheapest = cheapestPrice(state);
  return cheapest !== null && state.balance < cheapest;
}
