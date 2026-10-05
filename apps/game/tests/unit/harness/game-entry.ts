/**
 * Browser-side entry for tests/unit/input-routing.spec.ts (bundled with esbuild, injected
 * into a blank page). This is the ONE place that knows how the game is wired: when the
 * controller moves to another architecture, rewrite `makeGame()` and keep the surface on
 * `window.__h` (state snapshot, stand/interact, deferreds, counters) stable.
 *
 * Real: GameController (built by app/controller.ts makeController on Chain + GameState +
 * an app Scope), Dialogs, Hud, Intro, TitleCard, MockAdapter.
 * Fake: the 3D world (WorldApi), RecordDeck, ShopAmbience, Minimap.
 */
import { Effect, Exit, Scope } from "effect";
import { makeController } from "../../../src/app/controller";
import { makeChain } from "../../../src/app/chain";
import { GameStateStore } from "../../../src/app/game-state";
import { Dialogs } from "../../../src/ui/dialogs";
import { Hud } from "../../../src/ui/hud";
import { Intro } from "../../../src/ui/intro";
import { TitleCard } from "../../../src/ui/title-card";
import { MockAdapter } from "../../../src/miso/mock-adapter";
import { MOCK_CATALOG } from "../../../src/miso/mock-catalog";
import type { Interactable, InteractableKind, MapSnapshot } from "../../../src/world/api";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}
function deferred(): Deferred {
  let resolve!: () => void;
  const d: Deferred = { promise: new Promise<void>((r) => (resolve = r)), resolve: () => {}, settled: false };
  d.resolve = () => {
    d.settled = true;
    resolve();
  };
  return d;
}

function kindOf(id: string): InteractableKind {
  if (id.startsWith("record:")) return "record";
  if (id.startsWith("car:")) return "car";
  if (id.startsWith("buyer:")) return "buyer";
  return id as InteractableKind; // deck, cashier, atm, home
}

/** Implements every WorldApi member the controller and flows call; records what it is told. */
class FakeWorld {
  anchors = {
    deck: { x: 2, z: -10 },
    shopDoor: { x: 0, z: 0 },
    homeDoor: { x: -38, z: 2 },
    sounds: { fire: { x: -20, z: 12 }, diner: { x: 10, z: 12 }, band: { x: 20, z: 12 }, vending: { x: -5, z: 12 } },
  };
  onNear: (t: Interactable | null) => void = () => {};
  onInteract: (t: Interactable | null) => void = () => {};
  onMove: (x: number, z: number, h: number) => void = () => {};
  onZoneChange: (z: "street" | "shop") => void = () => {};
  onExitBlockedBump: () => void = () => {};

  blocked = false;
  blockedCalls: boolean[] = [];
  jumpAllowed = true;
  exitBlocked = false;
  helpersVisible = true;
  smashCalls: string[] = [];
  smash: Deferred | null = null;
  homeBeatCalls = 0;
  beat: Deferred | null = null;
  near: Interactable | null = null;
  private interactables = new Map<string, Interactable>();

  constructor() {
    const ids = ["deck", "cashier", "atm", "home", "car:0", "buyer:collector", ...MOCK_CATALOG.map((r) => `record:${r.id}`)];
    ids.forEach((id, i) =>
      this.interactables.set(id, {
        id,
        kind: kindOf(id),
        x: i * 3,
        z: 5,
        radius: 1.5,
        recordId: id.startsWith("record:") ? id.slice(7) : undefined,
        enabled: id !== "home",
      }),
    );
    // Like world.ts onKey: E / Enter (bubbling, edge-triggered, not while blocked) → onInteract(nearest).
    window.addEventListener("keydown", (e) => {
      if (e.code !== "KeyE" && e.code !== "Enter" && e.code !== "NumpadEnter") return;
      if (e.repeat || this.blocked || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLButtonElement || t instanceof HTMLInputElement)) return;
      e.preventDefault();
      this.onInteract(this.near);
    });
  }

  // ── test hooks ──
  stand(id: string | null): void {
    this.near = id ? (this.interactables.get(id) ?? null) : null;
    this.onNear(this.near);
  }

  // ── WorldApi ──
  setShopRecords(): void {}
  setRecordPlace(): void {}
  setDeckPlaying(): void {}
  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    this.blockedCalls.push(blocked);
  }
  setJumpAllowed(allowed: boolean): void {
    this.jumpAllowed = allowed;
  }
  setExitBlocked(blocked: boolean): void {
    this.exitBlocked = blocked;
  }
  setInteractableEnabled(id: string, enabled: boolean): void {
    const t = this.interactables.get(id);
    if (t) t.enabled = enabled;
  }
  setWaypoint(): void {}
  setHelpersVisible(visible: boolean): void {
    this.helpersVisible = visible;
  }
  setCashierStatus(): void {}
  smashCar(carId: string): Promise<void> {
    this.smashCalls.push(carId);
    this.smash = deferred();
    return this.smash.promise;
  }
  setBuyerStatus(): void {}
  buyerLeave(): void {}
  buyerReturn(): Promise<void> {
    return Promise.resolve();
  }
  homeBeat(): Promise<void> {
    this.homeBeatCalls++;
    this.beat = deferred();
    return this.beat.promise;
  }
  teleport(): void {}
  getPlayer() {
    return { x: 0, z: 5, heading: 0, zone: "shop" as const };
  }
  getInteractable(id: string): Interactable | undefined {
    return this.interactables.get(id);
  }
  mapSnapshot(): MapSnapshot {
    return {
      bounds: { minX: -40, maxX: 34, minZ: -15, maxZ: 20 },
      player: { x: 0, z: 5, heading: 0 },
      roads: [],
      buildings: [],
      shop: { x: 0, z: -7, w: 18, d: 14 },
      cars: [],
      pedestrians: [],
      points: [...this.interactables.values()].map((t) => ({ id: t.id, kind: t.kind, x: t.x, z: t.z, enabled: t.enabled })),
      waypoint: null,
    };
  }
}

class FakeDeck {
  kind: "hls" | "synth" | null = "synth";
  onProgress: (a: number, b: number) => void = () => {};
  onEnded: () => void = () => {};
  onError: (e: Error) => void = () => {};
  setSourcePosition(): void {}
  setListener(): void {}
  play(): Promise<void> {
    return Promise.resolve();
  }
  stop(): void {}
}

class FakeAmbience {
  chime(): void {}
  start(): Promise<void> {
    return Promise.resolve();
  }
  setPlaying(): void {}
  update(): void {}
  setOutdoors(): void {}
  setSources(): void {}
}

class FakeMinimap {
  draw(): void {}
}

const scopes: Scope.Closeable[] = [];

function makeGame(opts: { latencyMs?: number; adapter?: MockAdapter } = {}) {
  const app = document.getElementById("app") ?? document.body;
  const adapter = opts.adapter ?? new MockAdapter({ latencyMs: opts.latencyMs ?? 50 });
  const calls = { purchase: 0, sellToNpc: 0, withdrawFakeUsd: 0 };
  for (const name of Object.keys(calls) as (keyof typeof calls)[]) {
    const original = (adapter[name] as (...a: unknown[]) => unknown).bind(adapter);
    (adapter as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls[name]++;
      return original(...args);
    };
  }
  const world = new FakeWorld();
  const hud = new Hud(app);
  const dialogs = new Dialogs(app);
  const intro = new Intro(app, adapter.network);
  const titleCard = new TitleCard(app);
  /** The app scope: closing it interrupts every running flow (effect-flows.spec.ts). */
  const scope = Effect.runSync(Scope.make());
  scopes.push(scope);
  const controller = Effect.runSync(
    makeController({
      world: world as never,
      chain: makeChain(adapter),
      gameState: GameStateStore.makeSync(),
      deck: new FakeDeck() as never,
      ambience: new FakeAmbience() as never,
      hud,
      minimap: new FakeMinimap() as never,
      dialogs,
      intro,
      titleCard,
    }).pipe(Scope.provide(scope)),
  );
  const warnings: string[] = [];
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
    warn(...args);
  };
  /** Keys that reached the bubbling phase on window (i.e. the "game" listener level). */
  const gameKeys: string[] = [];
  window.addEventListener("keydown", (e) => gameKeys.push(e.code));

  const h = {
    controller,
    adapter,
    world,
    dialogs,
    intro,
    titleCard,
    hud,
    calls,
    warnings,
    gameKeys,
    booted: controller.boot(),
    /** JSON-safe view of controller.state (+ the UI layer that is up). */
    snapshot() {
      const s = controller.state;
      return {
        balance: s.balance === null ? null : s.balance.toString(),
        hand: s.hand,
        deck: s.deck,
        op: s.op,
        ownedIds: s.owned.map((o) => o.recordId),
        sold: s.sold.map((x) => ({ recordId: x.recordId, paid: x.paid.toString() })),
        smashedCars: [...s.smashedCars],
        wentHome: s.wentHome,
        openKey: dialogs.openKey,
        titleCard: titleCard.isOpen,
        started: controller.started,
      };
    },
    stand: (id: string | null) => world.stand(id),
    /** What the world does on E / Enter at the current spot. */
    interact: () => world.onInteract(world.near),
    toasts: () => [...document.querySelectorAll(".toasts .toast")].map((t) => t.textContent ?? ""),
    actions: () =>
      [...document.querySelectorAll<HTMLButtonElement>("dialog[open] .dlg-action")].map((b) => ({ id: b.dataset.actionId, disabled: b.disabled })),
    focusedAction: () => (document.activeElement as HTMLElement | null)?.dataset?.actionId ?? null,
    dialogText: () => (document.querySelector("dialog[open]")?.textContent ?? "").trim(),
  };
  (window as unknown as { __h: typeof h }).__h = h;
  return h;
}

/** Close the app scope of the current game (interrupts its flows); resolves when done. */
function closeScope(): Promise<void> {
  return Effect.runPromise(Scope.close(scopes.at(-1)!, Exit.void));
}

(window as unknown as Record<string, unknown>).__ui = { Dialogs, Intro, TitleCard, MockAdapter, makeGame, closeScope };
