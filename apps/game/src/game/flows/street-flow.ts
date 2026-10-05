/**
 * Street flow: smashing the dead Triangle sedan ("car:0") and selling to Stonks, the
 * collector at his BUYING table across the street (steps 5-6).
 *
 *   E on a car (holding a record) → dispatch smash → world.smashCar() → "STILL MINT"
 *   E on the collector → offer (1.5× shop price, npc-buyers.ts) → Sell
 *     → dispatch sellStart → chain.sellToNpc() → sellSuccess (render() makes
 *       the collector walk off with the record) | sellFail → message + Retry
 *   ~20 s after a sale the collector comes back (buyerReturned) so a presenter can
 *   rerun the sale without reloading.
 *
 * Owns: the smash sequence, the sell dialogs, the collector's status bubble and the
 * return timer.
 * Must not: decide legality (state.ts) or touch the chain except via ctx.chain.
 */
import { Effect } from "effect";
import * as sfx from "../../audio/sfx";
import { errorBody, paragraph, pendingBody, receiptLink } from "../../ui/dialogs";
import { COLLECTOR, buyerFor } from "../npc-buyers";
import { handLocked, heldOwnedRecord } from "../state";
import { transaction, type FlowContext } from "./context";

/** What the collector says when the sale broke on our side (a bug, not the chain). */
const DEAL_FELL_THROUGH = "Deal fell through. You still own it.";

/** How long after a sale the collector walks back to their spot. */
export const BUYER_RETURN_DELAY_MS = 20_000;

export class StreetFlow {
  /** True while the swing animation plays (prompts and interactions pause). */
  smashing = false;
  private returnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: FlowContext) {}

  // ─────────────────────────────── smash ───────────────────────────────

  smashCar(carId: string): Promise<void> {
    return this.ctx.run("smashCar", this.smashCarEffect(carId));
  }

  private smashCarEffect(carId: string): Effect.Effect<void> {
    const { ctx } = this;
    return Effect.suspend(() => {
      const hand = ctx.state().hand;
      const held = hand ? ctx.catalog.get(hand.shopRecordId) : undefined;
      if (!held) {
        ctx.hud.toast("Need something heavy.");
        return Effect.void;
      }
      if (this.smashing) return Effect.void;
      if (handLocked(ctx.state())) {
        // The record is mid-sale: Stonks is looking at it. No swinging it at a car now.
        ctx.hud.toast("One thing at a time.", { tone: "bad" });
        return Effect.void;
      }
      if (!ctx.dispatch({ type: "smash", carId })) return Effect.void;
      this.smashing = true;
      ctx.renderPrompt();
      return Effect.promise(() => ctx.world.smashCar(carId)).pipe(
        Effect.map(() => {
          sfx.glassSmash();
          sfx.recordThunk();
          sfx.carAlarm(6);
          ctx.world.setInteractableEnabled(carId, false);
          setTimeout(() => ctx.hud.missionToast("RECORD CONDITION: STILL MINT", "", "good", 5500), 350);
        }),
        Effect.ensuring(
          Effect.sync(() => {
            this.smashing = false;
            ctx.renderPrompt();
          }),
        ),
      );
    });
  }

  // ─────────────────────────────── sell ───────────────────────────────

  /** E on the collector. */
  openBuyer(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "sell" && s.op.status === "pending") return this.showSellPending();
    if (s.op?.kind === "sell" && s.op.status === "error") return this.showSellError(s.op.error);
    if (s.op?.status === "pending") {
      // A purchase or ATM withdrawal is in flight: Sell would be refused, so don't offer it.
      ctx.hud.toast("One thing at a time.", { tone: "bad" });
      return;
    }
    const owned = heldOwnedRecord(s);
    const r = owned ? ctx.catalog.get(owned.shopRecordId) : undefined;
    if (!owned || !r) {
      const line = s.owned.length
        ? "Got wax? Press C. Hold one up."
        : "Records! No one's making more. Bring me one. I pay above shop price.";
      ctx.hud.toast(line, { tone: "speech", speaker: COLLECTOR.name });
      return;
    }
    const npc = buyerFor(COLLECTOR, r.price.amount);
    ctx.dialogs.show({
      key: "sell",
      skin: "paper",
      title: "Stonks wants it",
      body: [paragraph(ctx.money(npc.offer), "dlg-p amount"), paragraph(`for ${r.title}`)],
      actions: [
        { id: "sell", kind: "primary", key: "E", label: "Sell", run: () => void this.sell() },
        { id: "keep", key: "Esc", label: "Keep", run: () => ctx.dialogs.close() },
      ],
    });
  }

  /** Sell the held owned Record to the collector. Safe to call again as Retry. */
  sell(): Promise<void> {
    return this.ctx.run("sell", this.sellEffect());
  }

  /** The sale program (starts synchronously: sellStart + pending screen happen inside the key press). */
  private sellEffect(): Effect.Effect<void> {
    const { ctx } = this;
    return Effect.suspend(() => {
      const owned = heldOwnedRecord(ctx.state());
      const record = owned ? ctx.catalog.get(owned.shopRecordId) : undefined;
      if (!owned || !record) return Effect.void;
      const npc = buyerFor(COLLECTOR, record.price.amount);
      if (!ctx.dispatch({ type: "sellStart", npcId: npc.id })) return Effect.void;
      ctx.world.setBuyerStatus(npc.id, "thinking");
      this.showSellPending();
      return transaction(
        ctx,
        {
          name: "sell",
          kind: "sell",
          jammed: DEAL_FELL_THROUGH,
          failAction: (error) => ({ type: "sellFail", error }),
          onFail: (text) => {
            ctx.dispatch({ type: "sellFail", error: text });
            // Half a sale may have landed (record transferred, payout not): re-read chain truth.
            // state.ts keeps the held record in hand so Retry can finish it.
            void ctx.run("refreshWallet", Effect.ignore(ctx.refreshWallet()));
            void ctx.run("refreshCollection", Effect.ignore(ctx.refreshCollection()));
            sfx.error();
            ctx.world.setBuyerStatus(npc.id, "error");
            if (ctx.dialogs.openKey === "sell") this.showSellError(text);
            else ctx.hud.toast(text, { tone: "bad" });
          },
        },
        Effect.gen({ self: this }, function* () {
          const result = yield* ctx.chain.sellToNpc(owned.recordId, npc);
          const wallet = yield* ctx.refreshWallet(false).pipe(Effect.orElseSucceed(() => null));
          const known = ctx.state().balance;
          const balance = wallet?.fakeUsd ?? (known === null ? null : known + result.paid);
          // sellSuccess moves the record to "npc" → render() calls world.buyerLeave().
          ctx.dispatch({ type: "sellSuccess", paid: result.paid, digest: result.digest, balance });
          ctx.world.setBuyerStatus(npc.id, "happy");
          this.scheduleBuyerReturn(npc.id);
          sfx.cashRegister();
          if (ctx.dialogs.openKey === "sell") {
            ctx.dialogs.show({
              key: "sell",
              skin: "paper",
              tone: "success",
              title: "SOLD",
              stamp: { jp: "済", en: "SOLD" },
              body: [paragraph(`+${ctx.money(result.paid)}`, "dlg-p amount"), receiptLink({ href: ctx.chain.explorerTxUrl(result.digest) })],
              actions: [{ id: "done", kind: "primary", key: "E", label: "OK", run: () => ctx.dialogs.close() }],
            });
          } else {
            ctx.hud.toast(`Sold ${record.title}: +${ctx.money(result.paid)}`, {
              tone: "good",
              link: { href: ctx.chain.explorerTxUrl(result.digest), label: "View receipt ↗" },
              durationMs: 12000,
            });
          }
          void ctx.run("refreshCollection", Effect.ignore(ctx.refreshCollection()));
        }),
      );
    });
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
    ctx.dialogs.show({ key: "sell", skin: "paper", tone: "pending", title: "Stonks is looking", body: pendingBody() });
  }

  private showSellError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "sell",
      skin: "paper",
      tone: "error",
      title: "No deal",
      body: errorBody(error),
      actions: [
        { id: "retry", kind: "primary", key: "E", label: "Retry", run: () => void this.sell() },
        { id: "keep", key: "Esc", label: "Keep", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        if (ctx.dispatch({ type: "dismissError" })) ctx.world.setBuyerStatus(COLLECTOR.id, "idle");
      },
    });
  }
}
