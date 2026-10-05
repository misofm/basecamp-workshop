/**
 * Shop flow: browsing the crates and the listening deck (steps 2-3 of the loop).
 *
 * Owns: the record menu (pick up / swap / sold out), the "in your hands" inspect
 * screen (put back / put away) and the deck menu (place, drop the needle, next
 * track, lift, take back, swap). Each button dispatches one state action.
 * Must not: call the adapter or start audio directly. Playback follows
 * `state.playing` via the controller's render() → RecordDeck.
 */
import type { ShopRecord } from "../../miso/types";
import * as sfx from "../../audio/sfx";
import { paragraph, recordBody, recordStrip, type DialogAction, type RecordView } from "../../ui/dialogs";
import { canPick, handLocked, heldIsOwned, heldOwnedRecord, recordPlace } from "../state";
import type { FlowContext } from "./context";

export class ShopFlow {
  constructor(private readonly ctx: FlowContext) {}

  /** E on a record in a genre section. */
  openRecord(id: string): void {
    const { ctx } = this;
    const s = ctx.state();
    const r = ctx.catalog.get(id);
    if (!r) return;
    if (s.hand?.shopRecordId === id) return this.openInspect();
    const place = recordPlace(s, id);
    const soldOut = r.minted >= r.maxSupply;
    const held = s.hand ? ctx.catalog.get(s.hand.shopRecordId) : undefined;
    const actions: DialogAction[] = [];
    if (place === "deck") {
      actions.push({ id: "pick", label: "It's on the listening deck", disabled: true, run: () => {} });
    } else if (heldIsOwned(s)) {
      actions.push({ id: "pick", label: "Hands full", detail: `holding ${held?.title ?? "a record"}`, disabled: true, run: () => {} });
    } else if (soldOut) {
      actions.push({ id: "pick", label: "Sold out", disabled: true, run: () => {} });
    } else if (canPick(s, id)) {
      actions.push({
        id: "pick",
        kind: "primary",
        label: held ? `Swap for this one` : "Pick up",
        detail: held ? `${held.title} goes back` : "take it to the deck",
        run: () => {
          if (ctx.dispatch({ type: "pick", shopRecordId: id })) sfx.pickup();
          ctx.dialogs.close();
        },
      });
    }
    actions.push({ id: "close", label: "Put back · keep digging", run: () => ctx.dialogs.close() });
    ctx.dialogs.show({
      key: "record",
      wide: true,
      eyebrow: `FROM THE CRATES · ${r.section}`,
      title: r.title,
      body: recordBody(this.recordView(r)),
      actions,
    });
  }

  /** The record in your hands (I, or E on its own shelf). */
  openInspect(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (!s.hand) return;
    const r = ctx.catalog.get(s.hand.shopRecordId);
    if (!r) return;
    const owned = heldOwnedRecord(s);
    const actions: DialogAction[] = [];
    if (owned) {
      actions.push({
        id: "stow",
        label: "Put it away",
        detail: "back to your collection",
        disabled: handLocked(s),
        run: () => {
          ctx.dispatch({ type: "stowOwned" });
          ctx.dialogs.close();
        },
      });
    } else {
      actions.push({
        id: "putback",
        label: "Put it back on the shelf",
        disabled: handLocked(s),
        run: () => {
          ctx.dispatch({ type: "putBack" });
          ctx.dialogs.close();
        },
      });
    }
    actions.unshift({ id: "close", kind: "primary", label: "Keep holding it", run: () => ctx.dialogs.close() });
    ctx.dialogs.show({
      key: "inspect",
      wide: true,
      eyebrow: owned ? "IN YOUR HANDS · OWNED" : "IN YOUR HANDS · UNPAID",
      title: r.title,
      body: recordBody(this.recordView(r, owned ? `OWNED · #${owned.serial}/${owned.maxSupply}` : "UNPAID · pay at the counter")),
      actions,
    });
  }

  /** E at the listening station. Re-opened after each step so the menu stays current. */
  openDeck(): void {
    const { ctx } = this;
    const s = ctx.state();
    const onDeck = s.deck ? ctx.catalog.get(s.deck.shopRecordId) : undefined;
    const held = s.hand ? ctx.catalog.get(s.hand.shopRecordId) : undefined;
    const body: Node[] = [];
    if (onDeck) {
      const track = s.playing ? onDeck.tracks[s.playing.trackIndex] : undefined;
      body.push(
        recordStrip(
          onDeck.coverUrl,
          onDeck.title,
          onDeck.artist,
          s.playing ? "PLAYING" : "ON THE PLATTER",
          track ? `Track ${s.playing!.trackIndex + 1}/${onDeck.tracks.length} · ${track.title}` : `${onDeck.tracks.length} tracks · 30-second previews`,
        ),
      );
    } else body.push(paragraph(held ? "The platter's empty. Put your record on." : "The platter's empty. Bring a record over from the crates."));
    if (held && onDeck) body.push(recordStrip(held.coverUrl, held.title, held.artist, "IN HAND"));

    const actions: DialogAction[] = [];
    if (!onDeck && held) {
      actions.push({
        id: "place",
        kind: "primary",
        label: `Put ${held.title} on the deck`,
        run: () => {
          if (ctx.dispatch({ type: "placeOnDeck" })) sfx.recordThunk();
          this.openDeck();
        },
      });
    }
    if (onDeck && !s.playing) {
      actions.push({
        id: "play",
        kind: "primary",
        label: "Drop the needle",
        detail: "30 s preview",
        run: () => {
          ctx.dispatch({ type: "play" });
          ctx.dialogs.close();
        },
      });
    }
    if (onDeck && s.playing) {
      actions.push({
        id: "next",
        kind: "primary",
        label: "Next track",
        detail: "N",
        run: () => {
          ctx.dispatch({ type: "nextTrack", trackCount: onDeck.tracks.length });
          this.openDeck();
        },
      });
      actions.push({
        id: "stop",
        label: "Lift the needle",
        run: () => {
          ctx.dispatch({ type: "stop" });
          this.openDeck();
        },
      });
    }
    if (onDeck && !held) {
      actions.push({
        id: "take",
        label: "Take it back",
        detail: "stops the music",
        run: () => {
          if (ctx.dispatch({ type: "takeFromDeck" })) sfx.pickup();
          ctx.dialogs.close();
        },
      });
    }
    if (onDeck && held) {
      actions.push({
        id: "swap",
        label: `Swap with ${held.title}`,
        run: () => {
          if (ctx.dispatch({ type: "swapWithDeck" })) sfx.recordThunk();
          ctx.dialogs.close();
        },
      });
    }
    actions.push({ id: "close", label: "Walk away", run: () => ctx.dialogs.close() });
    ctx.dialogs.show({ key: "deck", eyebrow: "LISTENING STATION · DECK 01", title: onDeck ? (s.playing ? "Now spinning." : "Ready to spin.") : "The listening deck.", body, actions });
  }

  private recordView(r: ShopRecord, status?: string): RecordView {
    return {
      title: r.title,
      artist: r.artist,
      genre: r.genre,
      year: r.year,
      label: r.label,
      description: r.description,
      coverUrl: r.coverUrl,
      palette: r.palette,
      priceText: this.ctx.money(r.price.amount),
      edition: r.edition,
      minted: r.minted,
      maxSupply: r.maxSupply,
      status,
    };
  }
}
