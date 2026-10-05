/**
 * Checkout flow: buying the held record at the counter (step 4 of the loop).
 * Read this next to src/miso/adapter.ts when writing the TestnetAdapter: it is the
 * only caller of `adapter.purchase()`.
 *
 *   openCashier → "Ring it up?" → Pay
 *     → dispatch purchaseStart → pending screen ("Ringing it up")
 *     → await adapter.purchase(record)        (resolves after finality)
 *     → re-read wallet + owned Records        (chain truth: balance, serial)
 *     → dispatch purchaseSuccess → receipt ("View receipt ↗")
 *   or → dispatch purchaseFail → the adapter's friendly message + Retry / Cancel
 *   Balance known and below the price? No chain call at all: "Jazz frowns: short on cash."
 *   (never a silent mint).
 *
 * Owns: the counter dialogs (Jazz runs the counter at Saisei Records) and the
 * clerk's speech bubble status.
 * Must not: decide legality (state.ts does) or know any chain detail beyond the
 * MisoAdapter interface.
 */
import type { OwnedRecord, ShopRecord } from "../../miso/types";
import * as sfx from "../../audio/sfx";
import { errorBody, paragraph, pendingBody, receiptLink, recordLine } from "../../ui/dialogs";
import { heldOwnedRecord } from "../state";
import { message, type FlowContext } from "./context";

export class CheckoutFlow {
  constructor(private readonly ctx: FlowContext) {}

  /** E at the counter. */
  openCashier(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "purchase" && s.op.status === "pending") return this.showPurchasePending();
    if (s.op?.kind === "purchase" && s.op.status === "error") return this.showPurchaseError(s.op.error ?? "Register jammed. Try again.");
    if (!s.hand) {
      const line = s.deck
        ? "Your record's still on the deck. Grab it and bring it here."
        : "Saisei. Means playback. Also means starting over. Bring me a record from the crates.";
      ctx.hud.toast(line, { tone: "speech", speaker: "Jazz" });
      return;
    }
    const r = ctx.catalog.get(s.hand.shopRecordId);
    if (!r) return;
    const owned = heldOwnedRecord(s);
    if (owned) {
      ctx.dialogs.show({
        key: "purchase",
        skin: "paper",
        title: "Already yours",
        body: paragraph("Take it outside."),
        actions: [{ id: "ok", kind: "primary", key: "E", label: "OK", run: () => ctx.dialogs.close() }],
      });
      return;
    }
    const balance = s.balance;
    const price = r.price.amount;
    if (balance !== null && balance < price) return this.showNotEnough();
    const plain = (n: bigint) => ctx.money(n).replace(/\s*FUSD$/, "");
    ctx.dialogs.show({
      key: "purchase",
      skin: "amber",
      title: r.title,
      body: paragraph(balance === null ? ctx.money(price) : `${ctx.money(price)} · you'll have ${plain(balance - price)}`),
      actions: [
        { id: "pay", kind: "primary", key: "E", label: "Pay", run: () => void this.purchase() },
        { id: "cancel", key: "Esc", label: "Not yet", run: () => ctx.dialogs.close() },
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
      this.showNotEnough();
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
      if (!this.showPurchaseReceipt(record, mine, result.digest)) {
        ctx.hud.toast(`Bought ${record.title}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "View receipt ↗" },
          durationMs: 8000,
        });
      }
    } catch (error) {
      const text = message(error);
      ctx.dispatch({ type: "purchaseFail", error: text });
      sfx.error();
      ctx.world.setCashierStatus("error");
      if (ctx.dialogs.openKey === "purchase") this.showPurchaseError(text);
      else ctx.hud.toast(text, { tone: "bad" });
    }
  }

  /** The balance can't cover the held record: Jazz says so, no chain call. */
  private showNotEnough(): void {
    const { ctx } = this;
    sfx.error();
    ctx.dialogs.show({
      key: "purchase",
      skin: "paper",
      tone: "error",
      title: "Short on cash",
      body: errorBody("Jazz frowns: short on cash."),
      actions: [{ id: "ok", kind: "primary", key: "E", label: "OK", run: () => ctx.dialogs.close() }],
    });
  }

  private showPurchasePending(): void {
    this.ctx.dialogs.show({ key: "purchase", skin: "amber", tone: "pending", title: "PROCESSING", body: pendingBody() });
  }

  /** Returns false if the purchase screen was closed meanwhile. */
  private showPurchaseReceipt(r: ShopRecord, owned: OwnedRecord, digest: string): boolean {
    const { ctx } = this;
    if (ctx.dialogs.openKey !== "purchase") return false;
    ctx.dialogs.show({
      key: "purchase",
      skin: "paper",
      tone: "success",
      title: "PAID",
      stamp: { jp: "領収", en: "PAID" },
      body: [
        recordLine(r.coverUrl, `${r.title} · #${owned.serial}/${owned.maxSupply} · ${ctx.money(r.price.amount)}`),
        receiptLink({ href: ctx.adapter.explorerTxUrl(digest) }),
      ],
      actions: [{ id: "done", kind: "primary", key: "E", label: "Take it outside", run: () => ctx.dialogs.close() }],
    });
    return true;
  }

  private showPurchaseError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "purchase",
      skin: "amber",
      tone: "error",
      title: "ERROR",
      body: errorBody(error),
      actions: [
        { id: "retry", kind: "primary", key: "E", label: "Retry", run: () => void this.purchase() },
        { id: "cancel", key: "Esc", label: "Back", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        if (ctx.dispatch({ type: "dismissError" })) ctx.world.setCashierStatus("idle");
      },
    });
  }
}
