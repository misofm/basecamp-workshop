/**
 * Mission text for the HUD, GTA style. PURE: derived from GameState only.
 *
 * Owns: the demo's suggested order and its copy:
 *   enter shop -> pick a record -> preview on the deck -> buy at the cashier ->
 *   head outside -> smash a parked car -> sell to the collector -> done.
 * Must not: change state or know positions. `target` is an interactable id
 * (or kind prefix) the controller resolves to a waypoint via the world:
 *   "shop-door" | "deck" | "cashier" | "car" (nearest unsmashed) | "buyer" | null.
 */
import { heldIsOwned, heldIsUnpaid, type GameState } from "./state";

export type ObjectiveTarget = "shop-door" | "deck" | "cashier" | "car" | "buyer";

export interface Objective {
  text: string;
  target: ObjectiveTarget | null;
}

export function objective(state: GameState): Objective {
  const op = state.op;
  if (op?.status === "pending" && op.kind === "purchase")
    return { text: "Hang tight. The register's ringing it up.", target: "cashier" };
  if (op?.status === "pending" && op.kind === "sell")
    return { text: "The collector's checking the wax…", target: "buyer" };

  // Empty-handed after a sale. (Pick up another record and the steps start over:
  // the collector comes back for a rerun of the demo.)
  if (state.sold.length > 0 && !state.hand && !state.deck)
    return { text: "Job done. Press C to see your collection.", target: null };

  // Holding a paid-for Record: take it outside, smash, sell.
  if (heldIsOwned(state)) {
    if (state.zone === "shop") return { text: "It's yours. Take it outside.", target: "shop-door" };
    if (state.smashedCars.length === 0)
      return { text: "Find a parked car. Smash it with the record.", target: "car" };
    return { text: "Still mint. Sell it to the collector.", target: "buyer" };
  }

  // On the deck (paid or not).
  if (state.deck && !state.hand) {
    if (state.playing) return { text: "Feeling it? Take it off the deck.", target: "deck" };
    if (!state.listened.includes(state.deck.shopRecordId))
      return { text: "Drop the needle. Play the preview.", target: "deck" };
    return { text: "Grab the record off the deck.", target: "deck" };
  }

  if (heldIsUnpaid(state)) {
    if (!state.listened.includes(state.hand!.shopRecordId))
      return { text: "Spin it on the listening deck.", target: "deck" };
    return { text: "Pay at the counter. No freebies.", target: "cashier" };
  }

  // Empty hands.
  if (state.owned.length > 0)
    return { text: "Press C and grab one of your records.", target: null };
  if (state.zone === "street") return { text: "Get to the record shop.", target: "shop-door" };
  return { text: "Dig through the crates. Pick a record.", target: null };
}
