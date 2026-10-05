/**
 * Checkout flow: buying the held record at the counter (step 4 of the loop).
 * Read this next to src/miso/adapter.ts when writing the TestnetAdapter: it is the
 * only caller of `adapter.purchase()`.
 *
 *   openCashier → "Ring it up?" → Pay
 *     → dispatch purchaseStart → pending screen ("Ringing it up")
 *     → await adapter.purchase(record)        (resolves after finality)
 *     → re-read wallet + owned Records        (chain truth: balance, serial)
 *     → dispatch purchaseSuccess → receipt ("View record ↗" / "Receipt no." + "View receipt ↗")
 *   or → dispatch purchaseFail → the adapter's friendly message + Retry / Cancel
 *   Balance known and below the price? No chain call at all: "Not enough FakeUSD —
 *   the ATM outside dispenses cash." (never a silent mint).
 *
 * Owns: the counter dialogs and the clerk's speech bubble status.
 * Must not: decide legality (state.ts does) or know any chain detail beyond the
 * MisoAdapter interface.
 */
import { shortId } from "../../miso/format";
import type { OwnedRecord, ShopRecord } from "../../miso/types";
import * as sfx from "../../audio/sfx";
import { errorBody, lineItems, paragraph, pendingBody, receiptBody, recordStrip } from "../../ui/dialogs";
import { heldOwnedRecord } from "../state";
import { message, type FlowContext } from "./context";

/** Shown when the player can't afford the held record (the ATM is outside). */
export const NOT_ENOUGH_FAKEUSD = "Not enough FakeUSD — the ATM outside dispenses cash.";
const ATM_HINT = "The ATM outside dispenses cash.";

/** Point an adapter's "Not enough FakeUSD" rejection at the ATM (once). */
export function withAtmHint(error: string): string {
  if (!/not enough fakeusd/i.test(error) || /\bATM\b/.test(error)) return error;
  return `${error.trimEnd()} ${ATM_HINT}`;
}

export class CheckoutFlow {
  constructor(private readonly ctx: FlowContext) {}

  /** E at the counter. */
  openCashier(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "purchase" && s.op.status === "pending") return this.showPurchasePending();
    if (s.op?.kind === "purchase" && s.op.status === "error") return this.showPurchaseError(s.op.error ?? "Something went wrong.");
    if (!s.hand) {
      const line = s.deck
        ? "Your record's still on the deck. Grab it and bring it here."
        : "Evening. Bring me a record from the crates and I'll ring it up.";
      ctx.hud.toast(line, { tone: "speech", speaker: "Clerk" });
      return;
    }
    const r = ctx.catalog.get(s.hand.shopRecordId);
    if (!r) return;
    const owned = heldOwnedRecord(s);
    if (owned) {
      ctx.dialogs.show({
        key: "purchase",
        eyebrow: "AT THE COUNTER",
        title: "Already yours.",
        body: [
          recordStrip(r.coverUrl, r.title, r.artist, `#${owned.serial}/${owned.maxSupply}`, "Paid for"),
          paragraph("That one's already yours. Go on, take it outside."),
        ],
        actions: [{ id: "ok", kind: "primary", label: "Cheers", run: () => ctx.dialogs.close() }],
      });
      return;
    }
    const balance = s.balance;
    const price = r.price.amount;
    if (balance !== null && balance < price) return this.showNotEnough(r, balance);
    ctx.dialogs.show({
      key: "purchase",
      eyebrow: "AT THE COUNTER",
      title: "Ring it up?",
      body: [
        recordStrip(r.coverUrl, r.title, r.artist, ctx.money(price), `${r.edition} · you'd get #${r.minted + 1} of ${r.maxSupply}`),
        lineItems([
          ["Your balance", balance === null ? "…" : ctx.money(balance)],
          ["After purchase", balance === null ? "…" : ctx.money(balance - price)],
        ]),
        paragraph("Paid in FakeUSD. It's yours the moment the till rings."),
      ],
      actions: [
        { id: "pay", kind: "primary", label: `Pay ${ctx.money(price)}`, run: () => void this.purchase() },
        { id: "cancel", label: "Not yet", run: () => ctx.dialogs.close() },
      ],
    });
  }

  /** Buy the held unpaid record. Safe to call again as Retry after a failure. */
  async purchase(): Promise<void> {
    const { ctx } = this;
    const hand = ctx.state().hand;
    const record = hand ? ctx.catalog.get(hand.shopRecordId) : undefined;
    if (!record) return;
    const balance = ctx.state().balance;
    if (balance !== null && balance < record.price.amount) {
      // Can't afford it: don't even ask the chain.
      this.showNotEnough(record, balance);
      return;
    }
    if (!ctx.dispatch({ type: "purchaseStart" })) return;
    ctx.world.setCashierStatus("processing");
    this.showPurchasePending();
    try {
      const result = await ctx.adapter.purchase(record);
      // Re-read chain truth: new balance + the minted Record (serial etc.).
      const [wallet, owned] = await Promise.all([ctx.refreshWallet(false).catch(() => null), ctx.adapter.listOwnedRecords().catch(() => null)]);
      const mine: OwnedRecord = owned?.find((o) => o.recordId === result.recordId) ?? {
        recordId: result.recordId,
        shopRecordId: record.id,
        title: record.title,
        artist: record.artist,
        coverUrl: record.coverUrl,
        serial: record.minted + 1,
        maxSupply: record.maxSupply,
        acquiredAt: Date.now(),
      };
      record.minted = Math.max(record.minted, mine.serial);
      const balance = wallet?.fakeUsd ?? (ctx.state().balance ?? 0n) - record.price.amount;
      ctx.dispatch({ type: "purchaseSuccess", owned: mine, digest: result.digest, balance, amount: record.price.amount });
      if (owned) ctx.dispatch({ type: "collectionLoaded", owned });
      sfx.cashRegister();
      setTimeout(() => sfx.purchaseSuccess(), 450);
      ctx.world.setCashierStatus("success");
      setTimeout(() => ctx.world.setCashierStatus("idle"), 4000);
      if (!this.showPurchaseReceipt(record, mine, result.digest, balance)) {
        ctx.hud.toast(`Bought ${record.title}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "View receipt ↗" },
          durationMs: 8000,
        });
      }
    } catch (error) {
      const text = withAtmHint(message(error));
      ctx.dispatch({ type: "purchaseFail", error: text });
      sfx.error();
      ctx.world.setCashierStatus("error");
      if (ctx.dialogs.openKey === "purchase") this.showPurchaseError(text);
      else ctx.hud.toast(`Purchase failed: ${text}`, { tone: "bad" });
    }
  }

  /** The balance can't cover the held record: point at the ATM, no chain call. */
  private showNotEnough(r: ShopRecord, balance: bigint): void {
    const { ctx } = this;
    sfx.error();
    ctx.dialogs.show({
      key: "purchase",
      tone: "error",
      eyebrow: "AT THE COUNTER",
      title: "Card declined.",
      body: [
        recordStrip(r.coverUrl, r.title, r.artist, ctx.money(r.price.amount)),
        lineItems([
          ["Your balance", ctx.money(balance)],
          ["Price", ctx.money(r.price.amount)],
        ]),
        errorBody(NOT_ENOUGH_FAKEUSD, "Nothing was charged. Put the record back, grab some FakeUSD and come back."),
      ],
      actions: [{ id: "ok", kind: "primary", label: "OK", run: () => ctx.dialogs.close() }],
    });
  }

  private showPurchasePending(): void {
    const { ctx } = this;
    const hand = ctx.state().hand;
    const r = hand ? ctx.catalog.get(hand.shopRecordId) : undefined;
    ctx.dialogs.show({
      key: "purchase",
      tone: "pending",
      eyebrow: "AT THE COUNTER",
      title: "Ringing it up…",
      body: [
        r ? recordStrip(r.coverUrl, r.title, r.artist, ctx.money(r.price.amount)) : null,
        pendingBody("Ringing it up", "The clerk's putting your payment through. You can close this; the counter keeps working."),
      ],
      actions: [{ id: "hide", label: "Close (keeps processing)", run: () => ctx.dialogs.close() }],
    });
  }

  /** Returns false if the purchase screen was closed meanwhile. */
  private showPurchaseReceipt(r: ShopRecord, owned: OwnedRecord, digest: string, balance: bigint): boolean {
    const { ctx } = this;
    if (ctx.dialogs.openKey !== "purchase") return false;
    ctx.dialogs.show({
      key: "purchase",
      tone: "success",
      eyebrow: "PAID · RECEIPT",
      title: "It's yours.",
      body: [
        recordStrip(r.coverUrl, r.title, r.artist, `#${owned.serial}/${owned.maxSupply}`, r.edition),
        receiptBody(
          "Paid in full. Bag's yours.",
          [
            { label: "Record", value: `#${owned.serial} of ${owned.maxSupply}`, href: ctx.adapter.explorerObjectUrl(owned.recordId), linkLabel: "View record ↗", linkId: "record" },
            { label: "Paid", value: ctx.money(r.price.amount) },
            { label: "Balance", value: ctx.money(balance) },
            { label: "Receipt no.", value: shortId(digest), href: ctx.adapter.explorerTxUrl(digest), linkLabel: "View receipt ↗", linkId: "tx" },
          ],
          ctx.adapter.network === "mock" ? "Offline demo: the record and receipt links are just for show." : undefined,
        ),
      ],
      actions: [{ id: "done", kind: "primary", label: "Take it outside", run: () => ctx.dialogs.close() }],
    });
    return true;
  }

  private showPurchaseError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "purchase",
      tone: "error",
      eyebrow: "PAYMENT FAILED",
      title: "The register jammed.",
      body: errorBody(error, "Nothing was charged. The record is still in your hands."),
      actions: [
        { id: "retry", kind: "primary", label: "Retry", run: () => void this.purchase() },
        { id: "cancel", label: "Cancel", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        if (ctx.dispatch({ type: "dismissError" })) ctx.world.setCashierStatus("idle");
      },
    });
  }
}
