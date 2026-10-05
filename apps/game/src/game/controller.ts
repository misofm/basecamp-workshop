/**
 * GameController: THE one place that glues the game together. Read this first.
 *
 *   world events ─► controller ─► transition(state, action) ─► render()
 *   (onInteract,       │                (pure, state.ts)          │
 *    onMove, onNear,   ├─► MisoAdapter   async chain calls        ├─► world: record places, exit wall,
 *    onZoneChange…)    │   (never awaited on the render loop)     │   deck spin, waypoint
 *                      └─► audio: deck preview, sfx, ambience     └─► ui: HUD, minimap, dialogs
 *
 * The loop, step by step (objectives.ts holds the mission text for each step):
 *   1. Spawn on the street → walk into the shop (door chime, ambience fades indoors).
 *   2. E on a record → record menu → "Pick up"            dispatch pick
 *   3. E on the deck → place / drop needle / next / lift   placeOnDeck, play … (RecordDeck streams 30 s)
 *   4. E at the cashier → summary → Pay                     purchaseStart → adapter.purchase()
 *        → purchaseSuccess (receipt: Record id + explorer links) | purchaseFail (Retry / Cancel)
 *      Unpaid stock can't leave: world.setExitBlocked(!canLeaveShop) + "Oi! Pay for that first."
 *   5. Outside, E on a parked car while holding the record   smash → world.smashCar() → "STILL MINT"
 *   6. E on the collector → offer (1.5× shop price)         sellStart → adapter.sellToNpc()
 *        → sellSuccess (buyer walks off with it, cash counts up) | sellFail (Retry)
 *   7. C → collection, read back from the chain via adapter.listOwnedRecords().
 *   Any time: E at the FakeUSD ATM outside → Withdraw 50 FUSD   withdrawStart → adapter.withdrawFakeUsd()
 *        → withdrawSuccess (receipt, cash counts up) | withdrawFail (Retry / Cancel)
 *   ~20 s after a sale the collector walks back (buyerReturned), so the loop can rerun.
 *
 * Where things live: this file is the core (wiring, boot, render(), world events,
 * keys, waypoint). The per-station screens and chain calls are in ./flows/, each
 * given a small FlowContext (flows/context.ts) instead of the whole controller:
 *   flows/shop-flow.ts        record menu, inspect, listening deck       (steps 2-3)
 *   flows/checkout-flow.ts    cashier: pay → pending → receipt | error   (step 4)
 *   flows/street-flow.ts      smash a car, sell to the collector, return (steps 5-6)
 *   flows/collection-flow.ts  C collection, H help + "Reset demo"        (step 7)
 *   flows/atm-flow.ts         the street ATM: withdraw FakeUSD from the faucet
 *
 * Rules this file follows:
 *  - Every adapter call: dispatch xStart → pending UI → await → xSuccess / xFail.
 *    Failures show the adapter's friendly message + Retry. After a purchase or sale
 *    the wallet and collection are re-read from the adapter (chain truth).
 *  - render() is the only place that pushes state into the world, audio and HUD.
 *  - The UI modules (src/ui/*) only draw what they are given; game rules live in
 *    state.ts, copy for missions in objectives.ts, offers in npc-buyers.ts.
 */
import type { MisoAdapter } from "../miso/adapter";
import { formatAmount } from "../miso/format";
import type { OwnedRecord, ShopRecord, Wallet } from "../miso/types";
import type { Interactable, RecordPlace as WorldPlace, WorldAnchors, WorldApi } from "../world/api";
import type { RecordDeck } from "../audio/deck";
import type { ShopAmbience } from "../audio/ambience";
import { isMuted, toggleMuted, unlockAudio } from "../audio/context";
import * as sfx from "../audio/sfx";
import type { Hud } from "../ui/hud";
import type { Minimap } from "../ui/minimap";
import type { Intro } from "../ui/intro";
import type { Dialogs } from "../ui/dialogs";
import { objective } from "./objectives";
import { COLLECTOR } from "./npc-buyers";
import {
  canLeaveShop,
  heldIsOwned,
  heldIsUnpaid,
  heldOwnedRecord,
  initialState,
  recordPlace,
  transition,
  type GameAction,
  type GameState,
} from "./state";
import { message, type FlowContext } from "./flows/context";
import { ShopFlow } from "./flows/shop-flow";
import { CheckoutFlow } from "./flows/checkout-flow";
import { StreetFlow } from "./flows/street-flow";
import { CollectionFlow } from "./flows/collection-flow";
import { AtmFlow } from "./flows/atm-flow";

/** Hide the waypoint once the player is this close to it (metres). */
const WAYPOINT_HIDE_DISTANCE = 2.5;
const FUSD_SYMBOL = "FUSD";

export interface ControllerDeps {
  world: WorldApi & { anchors: WorldAnchors };
  adapter: MisoAdapter;
  deck: RecordDeck;
  ambience: ShopAmbience;
  hud: Hud;
  minimap: Minimap;
  dialogs: Dialogs;
  intro: Intro;
}

export class GameController {
  /** Current game state (read-only from outside; change it with dispatch()). */
  state: GameState = initialState();
  /** The interactable the player is standing at (from world.onNear). */
  near: Interactable | null = null;
  started = false;

  private readonly world: ControllerDeps["world"];
  private readonly adapter: MisoAdapter;
  private readonly deck: RecordDeck;
  private readonly ambience: ShopAmbience;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly dialogs: Dialogs;
  private readonly intro: Intro;

  private catalog = new Map<string, ShopRecord>();
  private wallet: Wallet | null = null;
  private carIds: string[] = [];
  /** What the world currently shows for each record (so render() only sends changes). */
  private worldPlaces = new Map<string, WorldPlace>();
  /** "shopRecordId#track" currently sent to the RecordDeck, or null. */
  private audioKey: string | null = null;
  private deckSource: "hls" | "synth" | null = null;
  private waypointKey = "";
  private lastMove = { x: 0, z: 0, t: 0 };
  private outdoors = 1;
  private exitBlocked = false;

  // Per-station flows (./flows/*), sharing one FlowContext.
  private readonly shop: ShopFlow;
  private readonly checkout: CheckoutFlow;
  private readonly street: StreetFlow;
  private readonly collection: CollectionFlow;
  private readonly atm: AtmFlow;

  constructor(deps: ControllerDeps) {
    this.world = deps.world;
    this.adapter = deps.adapter;
    this.deck = deps.deck;
    this.ambience = deps.ambience;
    this.hud = deps.hud;
    this.minimap = deps.minimap;
    this.dialogs = deps.dialogs;
    this.intro = deps.intro;

    // What the flows may touch (see flows/context.ts).
    const ctx: FlowContext = {
      world: this.world,
      adapter: this.adapter,
      hud: this.hud,
      dialogs: this.dialogs,
      catalog: this.catalog,
      state: () => this.state,
      dispatch: (action) => this.dispatch(action),
      refreshWallet: (dispatchBalance) => this.refreshWallet(dispatchBalance),
      refreshCollection: () => this.refreshCollection(),
      renderPrompt: () => this.renderPrompt(),
      money: (amount) => this.money(amount),
    };
    this.shop = new ShopFlow(ctx);
    this.checkout = new CheckoutFlow(ctx);
    this.street = new StreetFlow(ctx);
    this.collection = new CollectionFlow(ctx);
    this.atm = new AtmFlow(ctx);

    // World events.
    this.world.onNear = (target) => {
      this.near = target;
      this.renderPrompt();
    };
    this.world.onInteract = (target) => this.interact(target);
    this.world.onMove = (x, z, heading) => this.onMove(x, z, heading);
    this.world.onZoneChange = (zone) => {
      this.dispatch({ type: "setZone", zone });
      if (zone === "shop") this.ambience.chime();
    };
    this.world.onExitBlockedBump = () => {
      this.hud.toast("Oi! Pay for that first.", { tone: "speech", speaker: "Clerk" });
      sfx.error();
    };

    // Deck audio events.
    this.deck.setSourcePosition(this.world.anchors.deck.x, this.world.anchors.deck.z);
    this.deck.onProgress = (elapsed, len) => this.hud.setProgress(elapsed, len);
    this.deck.onEnded = () => {
      this.dispatch({ type: "stop" });
      this.hud.toast("Preview over. Like it? Take it to the counter.");
    };
    this.deck.onError = (error) => {
      this.dispatch({ type: "stop" });
      this.hud.toast(error.message, { tone: "bad" });
    };

    // UI events.
    this.dialogs.onOpenChange = (open) => {
      this.world.setBlocked(open || this.intro.isOpen);
      this.renderPrompt();
    };
    this.dialogs.onNavigate = () => sfx.uiBlip();
    this.intro.onStart = () => this.start();
    window.addEventListener("keydown", (e) => this.onKey(e));

    this.world.setBlocked(true); // until the intro is dismissed
    this.carIds = this.world
      .mapSnapshot()
      .points.filter((p) => p.kind === "car")
      .map((p) => p.id);
    this.hud.setNetwork(this.adapter.network);
    this.render();
  }

  // ═══════════════════════════════ startup ═══════════════════════════════

  /** Load catalog, wallet and collection (in parallel) while the intro is showing. */
  async boot(): Promise<void> {
    const intro = this.intro;
    intro.setStatus("catalog", "Loading the crates…", "loading");
    intro.setStatus("wallet", "Counting your cash…", "loading");
    const catalog = this.adapter
      .loadShopCatalog()
      .then((records) => {
        for (const r of records) this.catalog.set(r.id, r);
        const prices: Record<string, bigint> = {};
        for (const r of records) prices[r.id] = r.price.amount;
        this.world.setShopRecords(
          records.map((r) => ({ id: r.id, title: r.title, artist: r.artist, section: r.section, coverUrl: r.coverUrl, palette: r.palette })),
        );
        this.dispatch({ type: "catalogLoaded", prices });
        intro.setStatus("catalog", `${records.length} records in the crates`, "ok");
      })
      .catch((error: unknown) => intro.setStatus("catalog", `Catalog: ${message(error)}`, "error"));
    const wallet = this.refreshWallet()
      .then((w) => intro.setStatus("wallet", `Cash: ${this.money(w.fakeUsd)}`, "ok"))
      .catch((error: unknown) => intro.setStatus("wallet", `Cash: ${message(error)}`, "error"));
    const collection = this.refreshCollection().catch(() => {});
    await Promise.all([catalog, wallet, collection]);
    document.documentElement.dataset.gameReady = "true";
  }

  /** Intro dismissed (a user gesture): unlock audio, start ambience, show the HUD. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    void unlockAudio().catch(() => {});
    void this.ambience.start().catch(() => {});
    this.hud.setVisible(true);
    this.world.setBlocked(this.dialogs.openKey !== null);
    this.render();
    this.hud.missionToast("MISO RECORDS", "after hours", "info", 2200);
  }

  // ═══════════════════════════════ state ═══════════════════════════════

  /** Apply an action. Returns false if the state machine refused it. */
  dispatch(action: GameAction): boolean {
    const next = transition(this.state, action);
    if (next === this.state) return false;
    this.state = next;
    this.render();
    return true;
  }

  /** Push the current state into world, audio and HUD. Cheap; only sends changes. */
  private render(): void {
    const s = this.state;

    // World: one physical object per release.
    for (const id of this.catalog.keys()) {
      const place = recordPlace(s, id);
      if (this.worldPlaces.get(id) === place) continue;
      this.worldPlaces.set(id, place);
      if (place === "npc") {
        const sale = s.sold.at(-1)!;
        this.world.buyerLeave(sale.npcId, id);
      } else this.world.setRecordPlace(id, place);
    }
    const blocked = !canLeaveShop(s);
    if (blocked !== this.exitBlocked) {
      this.exitBlocked = blocked;
      this.world.setExitBlocked(blocked);
    }
    this.world.setDeckPlaying(s.playing !== null);
    this.ambience.setPlaying(s.playing !== null);
    this.syncDeckAudio();

    // HUD.
    this.hud.setMoney(s.balance, this.wallet?.fakeUsdDecimals ?? 6, FUSD_SYMBOL);
    const op = s.op?.status === "pending" ? s.op.kind : null;
    this.world.setJumpAllowed(op === null); // no jumping while a purchase, sale or ATM withdrawal is pending
    this.hud.setPending(
      op === "purchase" ? "Ringing it up…" : op === "sell" ? "Closing the deal…" : op === "withdraw" ? "Withdrawing FakeUSD…" : null,
    );
    this.hud.setMission(objective(s).text);
    const held = s.hand ? this.catalog.get(s.hand.shopRecordId) : undefined;
    if (s.hand && held) {
      const owned = heldOwnedRecord(s);
      this.hud.setHeld({
        title: held.title,
        artist: held.artist,
        coverUrl: held.coverUrl,
        owned: owned !== undefined,
        status: owned ? `OWNED · #${owned.serial}/${owned.maxSupply}` : `UNPAID · ${this.money(held.price.amount)}`,
      });
    } else this.hud.setHeld(null);
    const onDeck = s.deck ? this.catalog.get(s.deck.shopRecordId) : undefined;
    if (s.playing && onDeck) {
      const track = onDeck.tracks[s.playing.trackIndex];
      this.hud.setNowPlaying({
        title: onDeck.title,
        artist: onDeck.artist,
        trackTitle: track?.title ?? "",
        trackNumber: s.playing.trackIndex + 1,
        trackCount: onDeck.tracks.length,
        source: this.deckSource,
      });
    } else this.hud.setNowPlaying(null);
    this.renderPrompt();
    this.updateWaypoint();
  }

  /** Start / stop / switch the deck preview so it matches state.playing. */
  private syncDeckAudio(): void {
    const s = this.state;
    const key = s.playing && s.deck ? `${s.deck.shopRecordId}#${s.playing.trackIndex}` : null;
    if (key === this.audioKey) return;
    this.audioKey = key;
    this.deckSource = null;
    if (!key || !s.deck || !s.playing) {
      this.deck.stop();
      return;
    }
    const record = this.catalog.get(s.deck.shopRecordId);
    if (!record) return;
    this.deck
      .play(record, s.playing.trackIndex)
      .then(() => {
        if (this.audioKey !== key) return;
        this.deckSource = this.deck.kind;
        this.render();
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return; // superseded
        if (this.audioKey !== key) return;
        sfx.error();
        this.hud.toast(message(error), { tone: "bad" });
        this.dispatch({ type: "stop" });
      });
  }

  private renderPrompt(): void {
    const t = this.near;
    const hidden = !this.started || !t || this.dialogs.openKey !== null || this.street.smashing;
    this.hud.setPrompt(hidden ? null : this.promptFor(t));
  }

  private promptFor(t: Interactable): string {
    const s = this.state;
    switch (t.kind) {
      case "record": {
        const r = t.recordId ? this.catalog.get(t.recordId) : undefined;
        if (r && s.hand?.shopRecordId === r.id) return `Inspect ${r.title}`;
        return r ? `Browse · ${r.title}` : "Browse";
      }
      case "deck":
        if (s.playing) return "Deck · next track / lift needle";
        if (s.deck) return "Use the deck";
        return s.hand ? "Put it on the deck" : "Listening deck";
      case "cashier":
        return heldIsUnpaid(s) ? "Pay at the counter" : "Talk to the clerk";
      case "car":
        return s.hand ? "Smash" : "Nice car";
      case "buyer":
        return heldIsOwned(s) ? "Sell to the collector" : "Talk to the collector";
      case "atm":
        return "Withdraw FakeUSD";
    }
  }

  // ═══════════════════════════════ per-frame ═══════════════════════════════

  private onMove(x: number, z: number, heading: number): void {
    // RecordDeck pans with forward = (−sin h, −cos h); the world's forward is (sin h, cos h).
    this.deck.setListener(x, z, heading + Math.PI);

    // Footsteps from actual speed; street bed fades in towards the doorway.
    const now = performance.now();
    const dt = Math.max(1e-3, (now - this.lastMove.t) / 1000);
    const speed = Math.hypot(x - this.lastMove.x, z - this.lastMove.z) / dt;
    this.lastMove = { x, z, t: now };
    if (dt < 0.25) this.ambience.update(speed > 0.6, speed > 4.6);
    const outdoors = this.state.zone === "street" ? 1 : Math.min(1, Math.max(0, 1 + z / 5)) * 0.6;
    if (Math.abs(outdoors - this.outdoors) > 0.02) {
      this.outdoors = outdoors;
      this.ambience.setOutdoors(outdoors);
    }

    this.updateWaypoint();
    if (this.started) this.minimap.draw(() => this.world.mapSnapshot());
  }

  /** Waypoint = the objective's target, hidden when the player is already there. */
  private updateWaypoint(): void {
    const target = objective(this.state).target;
    const player = this.world.getPlayer();
    let pos: { x: number; z: number } | null = null;
    switch (target) {
      case "shop-door":
        pos = this.world.anchors.shopDoor;
        break;
      case "deck":
      case "cashier":
      case "atm":
        pos = this.world.getInteractable(target) ?? null;
        break;
      case "buyer": {
        const buyer = this.world.getInteractable(COLLECTOR.id);
        pos = buyer?.enabled ? buyer : null;
        break;
      }
      case "car": {
        let best = Infinity;
        for (const id of this.carIds) {
          const car = this.world.getInteractable(id);
          if (!car?.enabled) continue;
          const d = Math.hypot(car.x - player.x, car.z - player.z);
          if (d < best) {
            best = d;
            pos = car;
          }
        }
        break;
      }
      case null:
        break;
    }
    if (pos && Math.hypot(pos.x - player.x, pos.z - player.z) < WAYPOINT_HIDE_DISTANCE) pos = null;
    const key = pos ? `${pos.x.toFixed(2)},${pos.z.toFixed(2)}` : "none";
    if (key === this.waypointKey) return;
    this.waypointKey = key;
    this.world.setWaypoint(pos ? { x: pos.x, z: pos.z } : null);
  }

  // ═══════════════════════════════ input ═══════════════════════════════

  /** E / Enter at an interactable (from the world, or __game.interact()). */
  interact(target: Interactable | null): void {
    if (!this.started || !target || this.dialogs.openKey || this.street.smashing) return;
    switch (target.kind) {
      case "record":
        if (target.recordId) this.shop.openRecord(target.recordId);
        break;
      case "deck":
        this.shop.openDeck();
        break;
      case "cashier":
        this.checkout.openCashier();
        break;
      case "car":
        void this.street.smashCar(target.id);
        break;
      case "buyer":
        this.street.openBuyer();
        break;
      case "atm":
        this.atm.openAtm();
        break;
    }
  }

  /** Buy the held unpaid record (checkout flow). Safe to call again as Retry. */
  purchase(): Promise<void> {
    return this.checkout.purchase();
  }

  /** Sell the held owned Record to the collector (street flow). Safe to call again as Retry. */
  sell(): Promise<void> {
    return this.street.sell();
  }

  /** Withdraw FakeUSD at the ATM (atm flow). Safe to call again as Retry. */
  withdraw(): Promise<void> {
    return this.atm.withdraw();
  }

  /** Bring the collector back now instead of waiting ~20 s after a sale (tests / rehearsal). */
  buyerReturnNow(): void {
    this.street.buyerReturn(COLLECTOR.id);
  }

  /** Global shortcuts. Menu keys (arrows/Enter/Esc) are handled by Dialogs first. */
  private onKey(e: KeyboardEvent): void {
    if (!this.started || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const open = this.dialogs.openKey;
    switch (e.code) {
      case "KeyC":
        if (open === "collection") this.dialogs.close();
        else if (!open) this.collection.openCollection();
        break;
      case "KeyH":
        if (open === "help") this.dialogs.close();
        else if (!open) this.collection.openHelp();
        break;
      case "KeyI":
        if (!open && this.state.hand) this.shop.openInspect();
        break;
      case "KeyM": {
        const muted = toggleMuted();
        this.hud.setMuted(muted);
        this.hud.toast(muted ? "Sound off" : "Sound on");
        break;
      }
      case "KeyN":
        this.nextTrackShortcut();
        if (open === "deck") this.shop.openDeck();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private nextTrackShortcut(): void {
    const s = this.state;
    const record = s.deck ? this.catalog.get(s.deck.shopRecordId) : undefined;
    if (!record) return;
    if (s.playing) this.dispatch({ type: "nextTrack", trackCount: record.tracks.length });
    else if (this.near?.kind === "deck") this.dispatch({ type: "play" });
  }

  // ═══════════════════════════════ chain reads ═══════════════════════════════

  /** Re-read the wallet; also updates the balance unless `dispatchBalance` is false. */
  private async refreshWallet(dispatchBalance = true): Promise<Wallet> {
    const wallet = await this.adapter.getWallet();
    this.wallet = wallet;
    this.hud.setNetwork(this.adapter.network, wallet.address);
    if (dispatchBalance) this.dispatch({ type: "walletLoaded", balance: wallet.fakeUsd });
    return wallet;
  }

  private async refreshCollection(): Promise<OwnedRecord[]> {
    const owned = await this.adapter.listOwnedRecords();
    this.dispatch({ type: "collectionLoaded", owned });
    return owned;
  }

  // ═══════════════════════════════ helpers ═══════════════════════════════

  private money(amount: bigint): string {
    return formatAmount(amount, this.wallet?.fakeUsdDecimals ?? 6, FUSD_SYMBOL);
  }

  /** For tests/debug: is sound muted? */
  get muted(): boolean {
    return isMuted();
  }
}
