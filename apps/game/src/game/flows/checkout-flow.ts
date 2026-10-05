/**
 * Checkout flow: buying the held record at the counter (step 4 of the loop).
 * Read this next to src/miso/adapter.ts when writing the TestnetAdapter: it is the
 * only caller of `adapter.purchase()`.
 *
 *   openCashier → "Ring it up?" → Pay
 *     → dispatch purchaseStart → pending screen ("Processing on Sui…")
 *     → await adapter.purchase(record)        (resolves after finality)
 *     → re-read wallet + owned Records        (chain truth: balance, serial)
 *     → dispatch purchaseSuccess → receipt (Record id, tx digest, explorer links)
 *   or → dispatch purchaseFail → the adapter's friendly message + Retry / Cancel
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
          recordStrip(r.coverUrl, r.title, r.artist, `#${owned.serial}/${owned.maxSupply}`, `Record ${shortId(owned.recordId)}`),
          paragraph("That one's already in your wallet. Go on, take it outside."),
        ],
        actions: [{ id: "ok", kind: "primary", label: "Cheers", run: () => ctx.dialogs.close() }],
      });
      return;
    }
    const balance = s.balance;
    const price = r.price.amount;
    const short = balance !== null && balance < price;
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
        paragraph(
          short
            ? "Not enough FakeUSD for this one. Put it back and pick something cheaper."
            : `Paid in FakeUSD on ${ctx.networkName()}. A Record object is minted straight to your wallet.`,
          short ? "dlg-p warn" : "dlg-p",
        ),
      ],
      actions: [
        { id: "pay", kind: "primary", label: `Pay ${ctx.money(price)}`, disabled: short, run: () => void this.purchase() },
        { id: "cancel", label: "Not yet", run: () => ctx.dialogs.close() },
      ],
    });
  }

  /** Buy the held unpaid record. Safe to call again as Retry after a failure. */
  async purchase(): Promise<void> {
    const { ctx } = this;
    const hand = ctx.state().hand;
    const record = hand ? ctx.catalog.get(hand.shopRecordId) : undefined;
    if (!record || !ctx.dispatch({ type: "purchaseStart" })) return;
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
        ctx.hud.toast(`Bought ${record.title} · Record ${shortId(mine.recordId)}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "Receipt ↗" },
          durationMs: 8000,
        });
      }
    } catch (error) {
      ctx.dispatch({ type: "purchaseFail", error: message(error) });
      sfx.error();
      ctx.world.setCashierStatus("error");
      if (ctx.dialogs.openKey === "purchase") this.showPurchaseError(message(error));
      else ctx.hud.toast(`Purchase failed: ${message(error)}`, { tone: "bad" });
    }
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
        pendingBody("Processing on Sui", `Minting your Record on ${ctx.networkName()}. You can close this; the counter keeps working.`),
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
          "Minted to your wallet.",
          [
            { label: "Record", value: shortId(owned.recordId, 6, 6), copy: owned.recordId, href: ctx.adapter.explorerObjectUrl(owned.recordId), linkLabel: "Object ↗" },
            { label: "Tx", value: shortId(digest, 6, 6), copy: digest, href: ctx.adapter.explorerTxUrl(digest), linkLabel: "Tx ↗" },
            { label: "Paid", value: ctx.money(r.price.amount) },
            { label: "Balance", value: ctx.money(balance) },
          ],
          ctx.adapter.network === "mock" ? "Mock chain: ids are fake, explorer links won't resolve." : undefined,
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
      eyebrow: "TRANSACTION FAILED",
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
