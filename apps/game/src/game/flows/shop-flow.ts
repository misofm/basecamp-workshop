/**
 * Shop flow: browsing the crates and the listening deck (steps 2-3 of the loop).
 *
 * Owns: the record price tag (pick up / swap / sold out), the "in your hands" inspect
 * screen (put back / put away) and the deck menu (place, drop the needle, next
 * track, lift, take back, swap). Each button dispatches one state action.
 * Must not: call the adapter or start audio directly. Playback follows
 * `state.playing` via the controller's render() → RecordDeck.
 */
import type { ShopRecord } from "../../miso/types";
import * as sfx from "../../audio/sfx";
import { paragraph, recordBody, type DialogAction, type RecordView } from "../../ui/dialogs";
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
      actions.push({ id: "pick", label: "On the turntable", disabled: true, run: () => {} });
    } else if (heldIsOwned(s)) {
      actions.push({ id: "pick", label: "Hands full", disabled: true, run: () => {} });
    } else if (soldOut) {
      actions.push({ id: "pick", label: "Sold out", disabled: true, run: () => {} });
    } else if (canPick(s, id)) {
      actions.push({
        id: "pick",
        kind: "primary",
        key: "E",
        label: held ? "Swap" : "Pick up",
        run: () => {
          if (ctx.dispatch({ type: "pick", shopRecordId: id })) sfx.pickup();
          ctx.dialogs.close();
        },
      });
    }
    actions.push({ id: "close", key: "Esc", label: "Put back", run: () => ctx.dialogs.close() });
    ctx.dialogs.show({
      key: "record",
      skin: "tag",
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
    const actions: DialogAction[] = [{ id: "close", kind: "primary", key: "E", label: "Keep it", run: () => ctx.dialogs.close() }];
    if (owned) {
      actions.push({
        id: "stow",
        label: "Put away",
        disabled: handLocked(s),
        run: () => {
          ctx.dispatch({ type: "stowOwned" });
          ctx.dialogs.close();
        },
      });
    } else {
      actions.push({
        id: "putback",
        label: "Put back",
        disabled: handLocked(s),
        run: () => {
          ctx.dispatch({ type: "putBack" });
          ctx.dialogs.close();
        },
      });
    }
    ctx.dialogs.show({
      key: "inspect",
      skin: "tag",
      title: r.title,
      body: recordBody(this.recordView(r, owned ? `#${owned.serial}/${owned.maxSupply}` : undefined)),
      actions,
    });
  }

  /** E at the listening station. Re-opened after each step so the menu stays current. */
  openDeck(): void {
    const { ctx } = this;
    const s = ctx.state();
    const onDeck = s.deck ? ctx.catalog.get(s.deck.shopRecordId) : undefined;
    const held = s.hand ? ctx.catalog.get(s.hand.shopRecordId) : undefined;
    const track = onDeck && s.playing ? onDeck.tracks[s.playing.trackIndex] : undefined;
    const line = onDeck ? (track ? track.title : onDeck.title) : held ? "Empty platter." : "Bring a record.";

    const actions: DialogAction[] = [];
    if (!onDeck && held) {
      actions.push({
        id: "place",
        kind: "primary",
        key: "E",
        label: "Put it on",
        // The record being paid for stays in your hands until the till rings.
        disabled: handLocked(s),
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
        key: "E",
        label: "Drop the needle",
        run: () => {
          ctx.dispatch({ type: "play" });
          ctx.dialogs.close();
        },
      });
    }
    if (onDeck && s.playing) {
      actions.push({
        id: "next",
        key: "N",
        hotkey: "KeyN",
        label: "Next",
        run: () => {
          ctx.dispatch({ type: "nextTrack", trackCount: onDeck.tracks.length });
          this.openDeck();
        },
      });
      actions.push({
        id: "stop",
        kind: "primary",
        key: "E",
        label: "Lift needle",
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
        run: () => {
          if (ctx.dispatch({ type: "takeFromDeck" })) sfx.pickup();
          ctx.dialogs.close();
        },
      });
    }
    if (onDeck && held) {
      actions.push({
        id: "swap",
        label: "Swap",
        disabled: handLocked(s),
        run: () => {
          if (ctx.dispatch({ type: "swapWithDeck" })) sfx.recordThunk();
          ctx.dialogs.close();
        },
      });
    }
    actions.push({ id: "close", key: "Esc", label: "Back", run: () => ctx.dialogs.close() });
    ctx.dialogs.show({
      key: "deck",
      skin: "enamel",
      title: s.playing ? "Now playing" : "Turntable",
      body: paragraph(line),
      actions,
    });
  }

  private recordView(r: ShopRecord, owned?: string): RecordView {
    const soldOut = r.minted >= r.maxSupply;
    return {
      title: r.title,
      artist: r.artist,
      coverUrl: r.coverUrl,
      palette: r.palette,
      priceText: this.ctx.money(r.price.amount),
      edition: owned ?? (soldOut ? "sold out" : `#${r.minted + 1}/${r.maxSupply}`),
    };
  }
}
