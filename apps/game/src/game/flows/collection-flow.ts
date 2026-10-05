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
import { handLocked, heldIsOwned } from "../state";
import { message, type FlowContext } from "./context";

export class CollectionFlow {
  constructor(private readonly ctx: FlowContext) {}

  openCollection(): void {
    const { ctx } = this;
    const show = (body: HTMLElement, actions: DialogAction[] = [{ id: "close", label: "Close", run: () => ctx.dialogs.close() }]) =>
      ctx.dialogs.show({ key: "collection", wide: true, eyebrow: "YOUR RECORDS", title: "Your collection.", body, actions });
    show(collectionBody({ kind: "loading" }));
    ctx
      .refreshCollection()
      .then(() => {
        if (ctx.dialogs.openKey === "collection") this.renderCollection();
      })
      .catch((error: unknown) => {
        if (ctx.dialogs.openKey !== "collection") return;
        show(collectionBody({ kind: "error", message: message(error) }), [
          { id: "retry", kind: "primary", label: "Retry", run: () => this.openCollection() },
          { id: "close", label: "Close", run: () => ctx.dialogs.close() },
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
        serialText: `#${o.serial} / ${o.maxSupply}`,
        explorerUrl: ctx.adapter.explorerObjectUrl(o.recordId),
        actionLabel: inHand ? "Put away" : onDeck ? "On the deck" : "Hold",
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
            ctx.hud.toast(`Holding ${o.title} #${o.serial}`);
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
      wide: true,
      eyebrow: "YOUR RECORDS",
      title: items.length ? `Your collection · ${items.length}` : "Your collection.",
      body: collectionBody({ kind: "ready", items, sold }),
      actions: [{ id: "close", label: "Close", run: () => ctx.dialogs.close() }],
    });
  }

  openHelp(): void {
    const { ctx } = this;
    const mock = ctx.adapter.network === "mock";
    ctx.dialogs.show({
      key: "help",
      wide: true,
      eyebrow: "HOW TO PLAY",
      title: "Buy it. Smash with it. Flip it.",
      body: helpBody(),
      actions: [
        { id: "ok", kind: "primary", label: "Let's dig", run: () => ctx.dialogs.close() },
        {
          id: "reset",
          label: "Reset demo (reload page)",
          // Reload keeps the URL (and its ?chain=…&latency=… params). The mock chain
          // lives in memory, so a reload is a fresh wallet; testnet state is on chain.
          detail: mock ? "starts over with 100 FUSD" : "restarts the game; your records stay yours",
          run: () => window.location.reload(),
        },
      ],
    });
  }
}
