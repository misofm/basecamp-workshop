/**
 * Collection flow: the C screen (your Records, read back from the chain, and sales
 * history) and the H help screen with its "Reset demo" button (step 7).
 *
 * Owns: re-reading owned Records via the context before showing them, the
 * Hold / Put away buttons, and the help dialog.
 * Must not: cache chain data of its own; `state.owned` is the single cache.
 */
import * as sfx from "../../audio/sfx";
import { collectionBody, helpBody, type CollectionItem, type DialogAction } from "../../ui/dialogs";
import { handLocked, heldIsOwned, isBusy } from "../state";
import { message, type FlowContext } from "./context";

export class CollectionFlow {
  constructor(private readonly ctx: FlowContext) {}

  openCollection(): void {
    const { ctx } = this;
    const show = (body: HTMLElement, actions: DialogAction[] = [{ id: "close", key: "Esc", label: "Close", run: () => ctx.dialogs.close() }]) =>
      ctx.dialogs.show({ key: "collection", skin: "green", wide: true, title: "MY RECORDS", body, actions });
    show(collectionBody({ kind: "loading" }));
    ctx
      .refreshCollection()
      .then(() => {
        if (ctx.dialogs.openKey === "collection") this.renderCollection();
      })
      .catch((error: unknown) => {
        if (ctx.dialogs.openKey !== "collection") return;
        show(collectionBody({ kind: "error", message: message(error) }), [
          { id: "retry", kind: "primary", key: "E", label: "Retry", run: () => this.openCollection() },
          { id: "close", key: "Esc", label: "Close", run: () => ctx.dialogs.close() },
        ]);
      });
  }

  /** Collection screen from the cached `state.owned` (already refreshed from chain). */
  private renderCollection(): void {
    const { ctx } = this;
    const s = ctx.state();
    const items: CollectionItem[] = s.owned.map((o) => {
      const inHand = s.hand?.recordId === o.recordId;
      const onDeck = s.deck?.shopRecordId === o.shopRecordId;
      return {
        recordId: o.recordId,
        title: o.title,
        artist: o.artist,
        coverUrl: o.coverUrl,
        serialText: `#${o.serial}`,
        actionLabel: inHand ? "Put away" : onDeck ? "On deck" : "Hold",
        actionDisabled: handLocked(s) || (onDeck && !inHand),
        onAction: () => {
          if (inHand) {
            ctx.dispatch({ type: "stowOwned" });
            this.renderCollection();
            return;
          }
          if (heldIsOwned(ctx.state())) ctx.dispatch({ type: "stowOwned" });
          if (ctx.dispatch({ type: "holdOwned", recordId: o.recordId })) {
            sfx.pickup();
            ctx.dialogs.close();
            ctx.hud.toast(`${o.title} #${o.serial}`);
          }
        },
      };
    });
    const sold = s.sold.map((x) => ({
      title: ctx.catalog.get(x.shopRecordId)?.title ?? x.shopRecordId,
      paidText: `+${ctx.money(x.paid)}`,
    }));
    ctx.dialogs.show({
      key: "collection",
      skin: "green",
      wide: true,
      title: "MY RECORDS",
      body: collectionBody({ kind: "ready", items, sold }),
      actions: [{ id: "close", key: "Esc", label: "Close", run: () => ctx.dialogs.close() }],
    });
  }

  openHelp(): void {
    const { ctx } = this;
    const op = ctx.state().op;
    // A reload mid-transaction would hide its outcome (on testnet it can still land):
    // Reset waits until the purchase / sale / withdrawal has settled.
    const txPending = isBusy(ctx.state()) && (op?.kind === "purchase" || op?.kind === "sell" || op?.kind === "withdraw");
    ctx.dialogs.show({
      key: "help",
      skin: "green",
      wide: true,
      title: "CONTROLS",
      body: helpBody(),
      actions: [
        { id: "ok", kind: "primary", key: "Esc", label: "Close", run: () => ctx.dialogs.close() },
        {
          id: "reset",
          label: "Reset demo",
          disabled: txPending,
          // Reload keeps the URL (and its ?chain=…&latency=… params). The mock chain
          // lives in memory, so a reload is a fresh wallet; testnet state is on chain.
          run: () => window.location.reload(),
        },
      ],
    });
  }
}
