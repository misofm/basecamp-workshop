/**
 * The cast: which Tamashi plays which role in the game. The ONE place to change it.
 *
 * Owns: token ids for the player, the cashier, the collector and the street crowd.
 * Must not: build anything. The cashier, collector and crowd picks are PLACEHOLDERS
 * until the story pass sets them; the player is Tamashi #95.
 */
import { TAMASHI_COUNT } from "./traits";

export interface Cast {
  /** The player character. */
  player: number;
  /** Behind the shop counter. Placeholder. */
  cashier: number;
  /** The collector on the sidewalk who buys your records. Placeholder. */
  collector: number;
  /**
   * Street crowd, in order of appearance. Walkers and idlers take ids from this list and
   * swap to the next unused one now and then (out of view), so over a session every id
   * in it shows up. Placeholder: everyone not cast above.
   */
  crowd: number[];
}

const PLAYER = 95;
const CASHIER = 7; // placeholder: tuxedo + bowtie, reads as staff
const COLLECTOR = 100; // placeholder: crowned "king of wax"

export const CAST: Cast = {
  player: PLAYER,
  cashier: CASHIER,
  collector: COLLECTOR,
  crowd: Array.from({ length: TAMASHI_COUNT }, (_, i) => i + 1).filter((id) => id !== PLAYER && id !== CASHIER && id !== COLLECTOR),
};
