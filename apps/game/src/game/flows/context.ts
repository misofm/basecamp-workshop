/**
 * FlowContext: the small, explicit slice of the GameController that the per-station
 * flows (shop, checkout, street, collection) are allowed to use.
 *
 * Owns: the interface itself plus tiny shared helpers (error text).
 * Must not: grow into "the whole controller". If a flow needs something new, add one
 * narrowly named member here and wire it in GameController's constructor, so a reader
 * can see at a glance what a flow can touch.
 */
import type { MisoAdapter } from "../../miso/adapter";
import type { OwnedRecord, ShopRecord, Wallet } from "../../miso/types";
import type { WorldApi } from "../../world/api";
import type { Hud } from "../../ui/hud";
import type { Dialogs } from "../../ui/dialogs";
import type { GameAction, GameState } from "../state";

export interface FlowContext {
  readonly world: WorldApi;
  readonly adapter: MisoAdapter;
  readonly hud: Hud;
  readonly dialogs: Dialogs;
  /** Shop catalog by ShopRecord.id (loaded at boot; `minted` is bumped after a purchase). */
  readonly catalog: ReadonlyMap<string, ShopRecord>;

  /** The current state (always read fresh: it changes across awaits). */
  state(): GameState;
  /** Apply an action; false if the state machine refused it. Re-renders on success. */
  dispatch(action: GameAction): boolean;
  /** Re-read the wallet from the adapter; updates the balance unless told not to. */
  refreshWallet(dispatchBalance?: boolean): Promise<Wallet>;
  /** Re-read owned Records from the adapter into state.owned. */
  refreshCollection(): Promise<OwnedRecord[]>;
  /** Re-evaluate the HUD's "E · …" prompt (e.g. while a smash animation runs). */
  renderPrompt(): void;

  /** "12.50 FUSD" */
  money(amount: bigint): string;
}

/** A rejection's player-safe message. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
