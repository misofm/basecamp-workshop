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
 *   1. Spawn at the hotel side door (west end) → walk east to Saisei Records (door chime,
 *      ambience fades indoors; fire / diner / band / vending mixed by distance every frame).
 *   2. E on a record → record menu → "Pick up"            dispatch pick
 *   3. E on the deck → place / drop needle / next / lift   placeOnDeck, play … (RecordDeck streams 30 s)
 *   4. E at the counter (Jazz) → summary → Pay              purchaseStart → adapter.purchase()
 *        → purchaseSuccess (receipt: Record id + explorer links) | purchaseFail (Retry / Cancel)
 *      Unpaid stock can't leave: world.setExitBlocked(!canLeaveShop) + "Oi! Pay for that first."
 *   5. Outside, E on the dead Triangle sedan ("car:0") with the record   smash → world.smashCar() → "STILL MINT"
 *   6. E on Stonks (BUYING table) → offer (1.5× shop price) sellStart → adapter.sellToNpc()
 *        → sellSuccess (buyer walks off with it, cash counts up) | sellFail (Retry)
 *   7. C → collection, read back from the chain via adapter.listOwnedRecords().
 *   Exit beat (after a sale): E at the hotel door → goHome → sfx.boom() + world.homeBeat()
 *      → iron footsteps → title card "Book 3 — Dawn of the Machin" → "Home." (H → Reset demo)
 *   Any time: E at the ATM in TriMart → Withdraw 50 FUSD   withdrawStart → adapter.withdrawFakeUsd()
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
 *   flows/atm-flow.ts         the ATM in TriMart's vestibule: withdraw FakeUSD from the faucet
 *   goHome() (this file)      the exit beat; ui/title-card.ts draws the card
 *
 * Rules this file follows:
 *  - Every adapter call: dispatch xStart → pending UI → await → xSuccess / xFail.
 *    Failures show the adapter's friendly message + Retry. After a purchase or sale
 *    the wallet and collection are re-read from the adapter (chain truth).
 *  - render() is the only place that pushes state into the world, audio and HUD.
 *  - The UI modules (src/ui/*) only draw what they are given; game rules live in
 *    state.ts, copy for missions in objectives.ts, offers in npc-buyers.ts.
 */
import { Cause, Effect } from "effect";
import type { ChainApi } from "../app/chain";
import type { ChainError } from "../app/errors";
import type { GameStateStore } from "../app/game-state";
import type { ErrorBoundaryApi } from "../app/boundary";
import type { MisoAdapter } from "../miso/adapter";
import { formatAmount } from "../miso/format";
import type { OwnedRecord, ShopRecord, Wallet } from "../miso/types";
import type { Interactable, RecordPlace as WorldPlace, WorldAnchors, WorldApi } from "../world/api";
import type { RecordDeck } from "../audio/deck";
import type { ShopAmbience } from "../audio/ambience";
import { isMuted, toggleMuted } from "../audio/context";
import * as sfx from "../audio/sfx";
import type { Hud } from "../ui/hud";
import type { Intro } from "../ui/intro";
import type { Minimap } from "../ui/minimap";
import { UiVisibility, uiVisibleFromSearch } from "../ui/ui-visibility";
import type { TitleCard } from "../ui/title-card";
import type { Dialogs } from "../ui/dialogs";
import { objective } from "./objectives";
import { COLLECTOR } from "./npc-buyers";
import {
  canGoHome,
  canLeaveShop,
  heldIsOwned,
  heldIsUnpaid,
  heldOwnedRecord,
  isBusy,
  recordPlace,
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
/** The exit beat's interactable (the hotel side door). */
const HOME_ID = "home";
/** Iron footsteps start this long after the boom (ms). */
const FOOTSTEPS_DELAY_MS = 1000;
/** The title card shows once the brown-out is over, or after this long at the latest (ms). */
const HOME_BEAT_MAX_WAIT_MS = 3500;

/** Ambience falloff: full at ≤ NEAR m from a source, silent at `far` m (smoothstep). */
const SOUND_NEAR = 4;
const SOUND_FAR = { fire: 30, band: 30, diner: 18, vending: 18 } as const;
type SoundLevels = { fire: number; diner: number; band: number; vending: number; street: number };

/**
 * Audio calls that the audio layer is adding concurrently (sfx.boom, sfx.ironFootsteps,
 * ShopAmbience.setSources). Called through optional guards so this compiles either way.
 */

/** A purchase, sale or ATM withdrawal is in flight (catalog / wallet / collection reads don't count). */
function txInFlight(s: GameState): boolean {
  return isBusy(s) && (s.op?.kind === "purchase" || s.op?.kind === "sell" || s.op?.kind === "withdraw");
}

/**
 * `.catch((error) => console.warn(label, error))` for boot reads: a chain error logs the
 * adapter's original rejection (its `cause`), a defect logs the thrown value. Interruption
 * propagates.
 */
const warnOnFailure =
  (label: string) =>
  <A>(self: Effect.Effect<A, ChainError>): Effect.Effect<A | undefined> =>
    Effect.catchCause(self, (cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause as Cause.Cause<never>);
      const error = Cause.squash(cause);
      const raw = isChainError(error) && error.cause !== undefined ? error.cause : error;
      return Effect.sync(() => {
        console.warn(label, raw);
        return undefined;
      });
    });

/** `.catch(() => {})` for boot reads: failures and defects are swallowed, interruption propagates. */
const ignoreFailure = <A>(self: Effect.Effect<A, ChainError>): Effect.Effect<A | undefined> =>
  Effect.catchCause(self, (cause) => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause as Cause.Cause<never>) : Effect.succeed(undefined)));

function isChainError(error: unknown): error is ChainError {
  return typeof error === "object" && error !== null && "_tag" in error && "op" in error && "message" in error;
}

function falloff(distance: number, far: number): number {
  const t = Math.min(1, Math.max(0, (far - distance) / (far - SOUND_NEAR)));
  return t * t * (3 - 2 * t);
}

export interface ControllerDeps {
  world: WorldApi & { anchors: WorldAnchors };
  /** The chain (MisoAdapter wrapped as Effects: app/chain.ts). */
  chain: ChainApi;
  /** Where the game state lives (app/game-state.ts). */
  gameState: GameStateStore;
  deck: RecordDeck;
  ambience: ShopAmbience;
  hud: Hud;
  minimap: Minimap;
  intro: Intro;
  dialogs: Dialogs;
  titleCard: TitleCard;
  /**
   * Fork an Effect into the app-scoped FiberSet (starts synchronously). Defects are
   * reported via `boundary`; resolves undefined on a defect or interruption.
   */
  run: <A>(name: string, effect: Effect.Effect<A>) => Promise<A | undefined>;
  /** App-layer error boundary (app/boundary.ts). */
  boundary: ErrorBoundaryApi;
  /**
   * Add a guarded, app-scoped event listener (app/input.ts): same synchronous
   * addEventListener as before, removed when the app scope closes.
   */
  listen: (target: EventTarget, type: string, handler: (e: Event) => void, options?: boolean | AddEventListenerOptions) => void;
  /** Resume audio + start the ambience now, retrying on the next key / pointer (app/audio.ts). */
  startAudio: () => void;
}

export class GameController {
  /** Current game state (read-only from outside; change it with dispatch()). */
  get state(): GameState {
    return this.gameState.current;
  }
  /** The interactable the player is standing at (from world.onNear). */
  near: Interactable | null = null;
  started = false;

  private readonly world: ControllerDeps["world"];
  private readonly chain: ChainApi;
  private readonly gameState: GameStateStore;
  private readonly run: ControllerDeps["run"];
  private readonly boundary: ErrorBoundaryApi;
  private readonly startAudio: () => void;
  private readonly deck: RecordDeck;
  private readonly ambience: ShopAmbience;
  private readonly hud: Hud;
  private readonly minimap: Minimap;
  private readonly intro: Intro;
  private readonly uiVisibility = new UiVisibility(uiVisibleFromSearch(location.search));
  private readonly dialogs: Dialogs;
  private readonly titleCard: TitleCard;

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
  /** What the world currently has for the "home" interactable. */
  private homeEnabled = false;
  /** True from the boom until the title card is dismissed (input frozen, no prompt). */
  private homeBeatRunning = false;
  private soundLevels: SoundLevels = { fire: 0, diner: 0, band: 0, vending: 0, street: 1 };
  /** Whether help was last drawn with a transaction in flight (Reset demo disabled). */
  private helpBusy = false;

  // Per-station flows (./flows/*), sharing one FlowContext.
  private readonly shop: ShopFlow;
  private readonly checkout: CheckoutFlow;
  private readonly street: StreetFlow;
  private readonly collection: CollectionFlow;
  private readonly atm: AtmFlow;

  constructor(deps: ControllerDeps) {
    this.world = deps.world;
    this.chain = deps.chain;
    this.gameState = deps.gameState;
    this.run = deps.run;
    this.boundary = deps.boundary;
    this.startAudio = deps.startAudio;
    this.deck = deps.deck;
    this.ambience = deps.ambience;
    this.hud = deps.hud;
    this.minimap = deps.minimap;
    this.intro = deps.intro;
    this.dialogs = deps.dialogs;
    this.titleCard = deps.titleCard;

    // What the flows may touch (see flows/context.ts).
    const ctx: FlowContext = {
      world: this.world,
      chain: this.chain,
      hud: this.hud,
      dialogs: this.dialogs,
      catalog: this.catalog,
      state: () => this.state,
      dispatch: (action) => this.dispatch(action),
      refreshWallet: (dispatchBalance) => this.refreshWallet(dispatchBalance),
      refreshCollection: () => this.refreshCollection(),
      run: (name, effect) => this.run(name, effect),
      report: (context, cause) => this.boundary.report(context, cause),
      renderPrompt: () => this.renderPrompt(),
      money: (amount) => this.money(amount),
    };
    this.shop = new ShopFlow(ctx);
    this.checkout = new CheckoutFlow(ctx);
    this.street = new StreetFlow(ctx);
    this.collection = new CollectionFlow(ctx);
    this.atm = new AtmFlow(ctx);

    // Every callback handed to the world / audio / UI / window is guarded: an app-layer
    // throw is reported (console + one toast), never propagated into the render loop or
    // the event dispatch.
    const guard = this.boundary.guard;

    // World events.
    this.world.onNear = guard("world.onNear", (target: Interactable | null) => {
      this.near = target;
      this.renderPrompt();
    });
    this.world.onInteract = guard("world.onInteract", (target: Interactable | null) => this.interact(target));
    this.world.onMove = guard("world.onMove", (x: number, z: number, heading: number) => this.onMove(x, z, heading));
    this.world.onZoneChange = guard("world.onZoneChange", (zone: GameState["zone"]) => {
      this.dispatch({ type: "setZone", zone });
      if (zone === "shop") this.ambience.chime();
    });
    this.world.onExitBlockedBump = guard("world.onExitBlockedBump", () => {
      this.hud.toast("Oi! Pay for that first.", { tone: "speech", speaker: "Jazz" });
      sfx.error();
    });

    // Deck audio events.
    this.deck.setSourcePosition(this.world.anchors.deck.x, this.world.anchors.deck.z);
    this.deck.onProgress = guard("deck.onProgress", (elapsed: number, len: number) => this.hud.setProgress(elapsed, len));
    this.deck.onEnded = guard("deck.onEnded", () => {
      this.dispatch({ type: "stop" });
      this.hud.toast("Like it? Take it to the counter.");
    });
    this.deck.onError = guard("deck.onError", (error: Error) => {
      this.dispatch({ type: "stop" });
      this.hud.toast(error.message, { tone: "bad" });
    });

    // UI events.
    this.dialogs.onOpenChange = guard("dialogs.onOpenChange", () => {
      this.syncBlocked();
      this.renderPrompt();
    });
    this.dialogs.onNavigate = guard("dialogs.onNavigate", () => sfx.uiBlip());
    // Through app/input.ts: guarded (context "keydown") and removed when the app scope closes.
    deps.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent));

    this.intro.onStart = guard("intro.onStart", () => this.start());
    this.world.setBlocked(true); // until the loading screen is dismissed
    this.carIds = this.world
      .mapSnapshot()
      .points.filter((p) => p.kind === "car")
      .map((p) => p.id);
    this.hud.setNetwork(this.chain.network);
    this.render();
  }

  /** The raw MisoAdapter (window.__game, debug tools). */
  get adapter(): MisoAdapter {
    return this.chain.adapter;
  }

  // ═══════════════════════════════ startup ═══════════════════════════════

  /** Load catalog, wallet and collection (in parallel) while the boot cover is showing. */
  boot(): Promise<void> {
    return this.run("boot", this.bootEffect());
  }

  private bootEffect(): Effect.Effect<void> {
    const catalog = this.chain.loadShopCatalog.pipe(
      Effect.map((records) => {
        for (const r of records) this.catalog.set(r.id, r);
        const prices: Record<string, bigint> = {};
        for (const r of records) prices[r.id] = r.price.amount;
        this.world.setShopRecords(
          records.map((r) => ({ id: r.id, title: r.title, artist: r.artist, section: r.section, coverUrl: r.coverUrl, palette: r.palette })),
        );
        this.dispatch({ type: "catalogLoaded", prices });
      }),
      warnOnFailure("catalog failed"),
    );
    const wallet = this.refreshWallet().pipe(Effect.asVoid, warnOnFailure("wallet failed"));
    const collection = this.refreshCollection().pipe(Effect.asVoid, ignoreFailure);
    return Effect.all([catalog, wallet, collection], { concurrency: "unbounded", discard: true }).pipe(
      Effect.map(() => {
        document.documentElement.dataset.gameReady = "true";
      }),
    );
  }

  /**
   * Enter on the loading screen (a user gesture): resume the audio context, start the
   * ambience, show the HUD and hand over control. If audio could not start here, the first
   * key press or pointer down later does it silently (no prompt).
   */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.startAudio();
    window.focus();
    this.hud.setVisible(true);
    this.applyUiVisibility();
    this.syncBlocked();
    this.render();
  }

  // ═══════════════════════════════ state ═══════════════════════════════

  /**
   * Apply an action. Returns false if the state machine refused it (or it changed nothing).
   * An illegal action is a no-op plus a dev-console warning (GameStateStore), never a crash.
   */
  dispatch(action: GameAction): boolean {
    if (!this.gameState.dispatch(action)) return false;
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
    // Exit beat: the hotel door opens up after a sale (state.ts canGoHome).
    const home = canGoHome(s) && !this.homeBeatRunning;
    if (home !== this.homeEnabled) {
      this.homeEnabled = home;
      this.world.setInteractableEnabled(HOME_ID, home);
    }
    this.world.setDeckPlaying(s.playing !== null);
    this.ambience.setPlaying(s.playing !== null);
    this.syncDeckAudio();

    // HUD.
    this.hud.setMoney(s.balance, this.wallet?.fakeUsdDecimals ?? 6, FUSD_SYMBOL);
    const op = s.op?.status === "pending" ? s.op.kind : null;
    this.world.setJumpAllowed(op === null); // no jumping while a purchase, sale or ATM withdrawal is pending
    const txPending = op === "purchase" || op === "sell" || op === "withdraw";
    this.hud.setPending(txPending ? "Processing" : null);
    // A transaction in flight always shows the overlay (spinner now, the result toast later):
    // U-hidden UI would leave the player with no sign of it. U is ignored until it settles.
    if (txPending && this.started && !this.uiVisibility.visible) {
      this.uiVisibility.visible = true;
      this.applyUiVisibility();
    }
    // Help's "Reset demo" is disabled while a transaction is in flight: keep it current.
    if (txPending !== this.helpBusy) {
      this.helpBusy = txPending;
      if (this.dialogs.openKey === "help") this.collection.openHelp();
    }
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
    const trackIndex = s.playing.trackIndex;
    void this.run(
      "deck.play",
      Effect.tryPromise({ try: () => this.deck.play(record, trackIndex), catch: (error) => error }).pipe(
        Effect.match({
          onSuccess: () => {
            if (this.audioKey !== key) return;
            this.deckSource = this.deck.kind;
            this.render();
          },
          onFailure: (error) => {
            if (error instanceof Error && error.name === "AbortError") return; // superseded
            if (this.audioKey !== key) return;
            sfx.error();
            this.hud.toast(message(error), { tone: "bad" });
            this.dispatch({ type: "stop" });
          },
        }),
      ),
    );
  }

  private renderPrompt(): void {
    const t = this.near;
    const hidden = !this.started || !t || this.dialogs.openKey !== null || this.street.smashing || this.homeBeatRunning;
    this.hud.setPrompt(hidden ? null : this.promptFor(t));
  }

  private promptFor(t: Interactable): string {
    const s = this.state;
    switch (t.kind) {
      case "record": {
        const r = t.recordId ? this.catalog.get(t.recordId) : undefined;
        if (r && s.hand?.shopRecordId === r.id) return `Inspect ${r.title}`;
        return r ? r.title : "Browse";
      }
      case "deck":
        if (s.playing) return "Turntable";
        if (s.deck) return "Turntable";
        return s.hand ? "Put it on" : "Turntable";
      case "cashier":
        return heldIsUnpaid(s) ? "Pay Jazz" : "Talk to Jazz";
      case "car":
        return s.hand ? "Smash" : "Dead sedan";
      case "buyer":
        return heldIsOwned(s) ? "Sell to Stonks" : "Talk to Stonks";
      case "atm":
        return "ATM";
      case "home":
        return "Head home with Inicio";
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
    this.updateSoundSources(x, z);

    this.updateWaypoint();
    if (this.started) this.minimap.draw(() => this.world.mapSnapshot());
  }

  /**
   * Ambience mix by distance to the fixed sources (layout.ts SOUND_SOURCES via
   * world.anchors.sounds): fire and band carry ~30 m, diner and vending ~18 m. Inside
   * the shop everything outdoors is muffled with the street bed. The band falls silent
   * after the boom (exit beat).
   */
  private updateSoundSources(x: number, z: number): void {
    const src = this.world.anchors.sounds;
    if (!src) return;
    const out = this.outdoors;
    const level = (p: { x: number; z: number }, far: number) => falloff(Math.hypot(p.x - x, p.z - z), far) * out;
    const next: SoundLevels = {
      fire: level(src.fire, SOUND_FAR.fire),
      diner: level(src.diner, SOUND_FAR.diner),
      band: this.state.wentHome ? 0 : level(src.band, SOUND_FAR.band),
      vending: level(src.vending, SOUND_FAR.vending),
      street: out,
    };
    const prev = this.soundLevels;
    const changed = (Object.keys(next) as (keyof SoundLevels)[]).some((k) => Math.abs(next[k] - prev[k]) > 0.01);
    if (!changed) return;
    this.soundLevels = next;
    this.ambience.setSources(next);
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
      case "home":
        pos = this.world.anchors.homeDoor ?? this.world.getInteractable(HOME_ID) ?? null;
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
    if (!this.started || !target || this.dialogs.openKey || this.street.smashing || this.homeBeatRunning || this.titleCard.isOpen) return;
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
      case "home":
        void this.goHome();
        break;
    }
  }

  /**
   * The exit beat (bible §7.4): Gamer heads home with Inicio. The boom from the
   * facility (sfx + world.homeBeat: camera shake, brown-out), iron footsteps a second
   * later, then the "Book 3 — Dawn of the Machin" title card. Afterwards the player is
   * free to walk; the mission reads "Home. Press H to reset."
   * Refused (no-op) before a sale, while anything is pending, or when already home.
   */
  goHome(): Promise<void> {
    return this.run("goHome", this.goHomeEffect());
  }

  private goHomeEffect(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.homeBeatRunning || !this.dispatch({ type: "goHome" })) return Effect.void;
      this.homeBeatRunning = true;
      this.render(); // disables the door, hides the prompt
      this.syncBlocked();
      return Effect.gen({ self: this }, function* () {
        sfx.boom();
        setTimeout(() => sfx.ironFootsteps(), FOOTSTEPS_DELAY_MS);
        // The card follows the brown-out, but never waits on a slow renderer for long
        // (homeBeat runs on frame time; at a few fps it would take many seconds).
        const beat = this.world.homeBeat().catch(() => {});
        yield* Effect.promise(() =>
          Promise.all([
            Promise.race([beat, new Promise((resolve) => setTimeout(resolve, HOME_BEAT_MAX_WAIT_MS))]),
            new Promise((resolve) => setTimeout(resolve, FOOTSTEPS_DELAY_MS + 200)),
          ]),
        );
        yield* Effect.promise(() => this.titleCard.show());
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.homeBeatRunning = false;
            this.syncBlocked();
            this.render();
          }),
        ),
      );
    });
  }

  /** Freeze player input while the loading screen, a dialog, or the exit beat / title card is up. */
  private syncBlocked(): void {
    this.world.setBlocked(this.intro.isOpen || this.dialogs.openKey !== null || this.homeBeatRunning || this.titleCard.isOpen);
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
    // No menu may open over a scripted moment: the smash swing (the record is mid-air) or
    // the exit beat (boom → title card, which owns the keyboard once it is up).
    const scripted = this.street.smashing || this.homeBeatRunning || this.titleCard.isOpen;
    switch (e.code) {
      case "KeyC":
        if (open === "collection") this.dialogs.close();
        else if (!open && !scripted) this.collection.openCollection();
        break;
      case "KeyH":
        if (open === "help") this.dialogs.close();
        else if (!open && !scripted) this.collection.openHelp();
        break;
      case "KeyI":
        // Toggles like C and H.
        if (open === "inspect") this.dialogs.close();
        else if (!open && !scripted && this.state.hand) this.shop.openInspect();
        break;
      case "KeyU":
        if (open) return; // dialogs keep the overlay as it is
        if (txInFlight(this.state)) return; // the overlay stays up while a transaction is pending (see render)
        this.uiVisibility.toggle();
        this.applyUiVisibility();
        break;
      case "KeyM": {
        const muted = toggleMuted();
        this.hud.setMuted(muted);
        this.hud.toast(muted ? "Muted" : "Sound on");
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

  /** HUD, minimap, prompts, toasts and the 3D helper markers follow the U toggle (no toast: it would be in the shot). */
  private applyUiVisibility(): void {
    const visible = this.uiVisibility.visible;
    document.documentElement.dataset.ui = visible ? "on" : "off";
    this.world.setHelpersVisible(visible);
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
  private refreshWallet(dispatchBalance = true): Effect.Effect<Wallet, ChainError> {
    return this.chain.getWallet.pipe(
      Effect.tap((wallet) =>
        Effect.sync(() => {
          this.wallet = wallet;
          this.hud.setNetwork(this.chain.network, wallet.address);
          if (dispatchBalance) this.dispatch({ type: "walletLoaded", balance: wallet.fakeUsd });
        }),
      ),
    );
  }

  private refreshCollection(): Effect.Effect<OwnedRecord[], ChainError> {
    return this.chain.listOwnedRecords.pipe(
      Effect.tap((owned) =>
        Effect.sync(() => {
          this.dispatch({ type: "collectionLoaded", owned });
        }),
      ),
    );
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
