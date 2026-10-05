/**
 * Street flow: smashing a parked car and selling to the collector (steps 5-6).
 *
 *   E on a car (holding a record) → dispatch smash → world.smashCar() → "STILL MINT"
 *   E on the collector → offer (1.5× shop price, npc-buyers.ts) → Sell
 *     → dispatch sellStart → await adapter.sellToNpc() → sellSuccess (render() makes
 *       the collector walk off with the record) | sellFail → message + Retry
 *   ~20 s after a sale the collector comes back (buyerReturned) so a presenter can
 *   rerun the sale without reloading.
 *
 * Owns: the smash sequence, the sell dialogs, the collector's status bubble and the
 * return timer.
 * Must not: decide legality (state.ts) or touch the chain except via the adapter.
 */
import * as sfx from "../../audio/sfx";
import { errorBody, lineItems, paragraph, pendingBody, recordStrip } from "../../ui/dialogs";
import { COLLECTOR, buyerFor } from "../npc-buyers";
import { heldOwnedRecord } from "../state";
import { message, type FlowContext } from "./context";

/** How long after a sale the collector walks back to their spot. */
export const BUYER_RETURN_DELAY_MS = 20_000;

export class StreetFlow {
  /** True while the swing animation plays (prompts and interactions pause). */
  smashing = false;
  private returnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: FlowContext) {}

  // ─────────────────────────────── smash ───────────────────────────────

  async smashCar(carId: string): Promise<void> {
    const { ctx } = this;
    const hand = ctx.state().hand;
    const held = hand ? ctx.catalog.get(hand.shopRecordId) : undefined;
    if (!held) {
      ctx.hud.toast("You need something heavy… like a 180g record.");
      return;
    }
    if (this.smashing || !ctx.dispatch({ type: "smash", carId })) return;
    this.smashing = true;
    ctx.renderPrompt();
    try {
      await ctx.world.smashCar(carId);
      sfx.glassSmash();
      sfx.recordThunk();
      sfx.carAlarm(6);
      ctx.world.setInteractableEnabled(carId, false);
      setTimeout(() => ctx.hud.missionToast("RECORD CONDITION: STILL MINT", "heavyweight 180g vinyl", "good", 5500), 350);
    } finally {
      this.smashing = false;
      ctx.renderPrompt();
    }
  }

  // ─────────────────────────────── sell ───────────────────────────────

  /** E on the collector. */
  openBuyer(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "sell" && s.op.status === "pending") return this.showSellPending();
    if (s.op?.kind === "sell" && s.op.status === "error") return this.showSellError(s.op.error ?? "Something went wrong.");
    const owned = heldOwnedRecord(s);
    const r = owned ? ctx.catalog.get(owned.shopRecordId) : undefined;
    if (!owned || !r) {
      const line = s.owned.length
        ? "Got any wax? Get one of your records out (press C) and I'll make you an offer."
        : "Got any wax? Come back with a record, I pay above shop price.";
      ctx.hud.toast(line, { tone: "speech", speaker: COLLECTOR.name });
      return;
    }
    const npc = buyerFor(COLLECTOR, r.price.amount);
    ctx.dialogs.show({
      key: "sell",
      eyebrow: COLLECTOR.name.toUpperCase(),
      title: `Sell ${r.title} for ${ctx.money(npc.offer)}?`,
      body: [
        recordStrip(r.coverUrl, r.title, r.artist, `#${owned.serial}/${owned.maxSupply}`, "Condition: still mint"),
        lineItems([
          ["You paid", ctx.money(r.price.amount)],
          ["Collector offers", ctx.money(npc.offer)],
          ["Profit", `+${ctx.money(npc.offer - r.price.amount)}`],
        ]),
        paragraph("Hand the record over and the collector pays you in FakeUSD on the spot."),
      ],
      actions: [
        { id: "sell", kind: "primary", label: `Sell for ${ctx.money(npc.offer)}`, run: () => void this.sell() },
        { id: "keep", label: "Keep it", run: () => ctx.dialogs.close() },
      ],
    });
  }

  /** Sell the held owned Record to the collector. Safe to call again as Retry. */
  async sell(): Promise<void> {
    const { ctx } = this;
    const owned = heldOwnedRecord(ctx.state());
    const record = owned ? ctx.catalog.get(owned.shopRecordId) : undefined;
    if (!owned || !record) return;
    const npc = buyerFor(COLLECTOR, record.price.amount);
    if (!ctx.dispatch({ type: "sellStart", npcId: npc.id })) return;
    ctx.world.setBuyerStatus(npc.id, "thinking");
    this.showSellPending();
    try {
      const result = await ctx.adapter.sellToNpc(owned.recordId, npc);
      const wallet = await ctx.refreshWallet(false).catch(() => null);
      const balance = wallet?.fakeUsd ?? (ctx.state().balance ?? 0n) + result.paid;
      // sellSuccess moves the record to "npc" → render() calls world.buyerLeave().
      ctx.dispatch({ type: "sellSuccess", paid: result.paid, digest: result.digest, balance });
      ctx.world.setBuyerStatus(npc.id, "happy");
      this.scheduleBuyerReturn(npc.id);
      if (ctx.dialogs.openKey === "sell") ctx.dialogs.close();
      sfx.cashRegister();
      ctx.hud.missionToast("SOLD", `+${ctx.money(result.paid)} · ${record.title}`, "good", 5500);
      ctx.hud.toast(`Sold ${record.title}`, {
        tone: "good",
        link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "View receipt ↗" },
        durationMs: 12000,
      });
      void ctx.refreshCollection().catch(() => {});
    } catch (error) {
      ctx.dispatch({ type: "sellFail", error: message(error) });
      sfx.error();
      ctx.world.setBuyerStatus(npc.id, "error");
      if (ctx.dialogs.openKey === "sell") this.showSellError(message(error));
      else ctx.hud.toast(`Sale failed: ${message(error)}`, { tone: "bad" });
    }
  }

  // ─────────────────────────────── collector returns ───────────────────────────────

  private scheduleBuyerReturn(npcId: string, delayMs = BUYER_RETURN_DELAY_MS): void {
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    this.returnTimer = setTimeout(() => this.buyerReturn(npcId), delayMs);
  }

  /**
   * The collector comes back for another round (also `__game.buyerReturnNow()`):
   * the sold copy is back on the shelf straight away, and the collector can be
   * talked to again once they're standing on their spot.
   */
  buyerReturn(npcId: string = COLLECTOR.id): void {
    const { ctx } = this;
    if (this.returnTimer !== null) clearTimeout(this.returnTimer);
    this.returnTimer = null;
    if (!ctx.dispatch({ type: "buyerReturned", npcId })) return;
    void ctx.world.buyerReturn(npcId).then(() => {
      ctx.world.setBuyerStatus(npcId, "idle");
      ctx.world.setInteractableEnabled(npcId, true);
    });
  }

  private showSellPending(): void {
    const { ctx } = this;
    const owned = heldOwnedRecord(ctx.state());
    ctx.dialogs.show({
      key: "sell",
      tone: "pending",
      eyebrow: COLLECTOR.name.toUpperCase(),
      title: "The collector inspects the grooves…",
      body: [
        owned ? recordStrip(owned.coverUrl, owned.title, owned.artist, `#${owned.serial}/${owned.maxSupply}`) : null,
        pendingBody("Closing the deal", "The record goes to the collector, the FakeUSD comes to you."),
      ],
      actions: [{ id: "hide", label: "Close (keeps processing)", run: () => ctx.dialogs.close() }],
    });
  }

  private showSellError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "sell",
      tone: "error",
      eyebrow: "SALE FAILED",
      title: "The deal fell through.",
      body: errorBody(error, "The collector is still keen. Give it another go."),
      actions: [
        { id: "retry", kind: "primary", label: "Retry", run: () => void this.sell() },
        { id: "keep", label: "Keep it", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        if (ctx.dispatch({ type: "dismissError" })) ctx.world.setBuyerStatus(COLLECTOR.id, "idle");
      },
    });
  }
}
