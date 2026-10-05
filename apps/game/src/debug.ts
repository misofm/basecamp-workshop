/**
 * TEST HOOK: `window.__game`, used by the Playwright e2e tests and handy in the console.
 *
 * Owns: a tiny, stable surface for driving the game from outside. Installed in
 * every build (it can't spend real money: chain writes still go through the
 * adapter, and the mock-only knobs are no-ops on testnet).
 * Must not: contain game logic. Everything here calls the controller/world/adapter.
 *
 *   __game.state()                    current GameState (pure data)
 *   __game.teleportTo("deck")         stand at an interactable ("record:<id>", "cashier",
 *   __game.teleportTo({x, z, heading})  "car:0", "buyer:collector", "atm", "home"…), facing it, or a point
 *   __game.interact()                 same as pressing E where you stand
 *   __game.press("KeyN")              dispatch a key (code or single letter) on window
 *   __game.failNext("purchase")       mock: next purchase/sell/withdraw/any fails once
 *   __game.setFailureMode("none")     mock: purchase|sell|withdraw|all|none, sticky
 *   __game.setLatency(1500)           mock: simulated chain latency (ms)
 *   __game.measure()                  draw calls / triangles for one frame
 *   ?debug=1                          corner overlay: backend, quality tier, render scale / AO / bloom, FPS / frame time, draw calls
 *   __game.deckDebug()                deck source, <audio> currentTime, preview window start
 *   __game.buyerReturnNow()           bring Stonks (the collector) back now (normally ~20 s after a sale)
 *   __game.crowdStats()               crowd on screen, distinct Tamashi ids shown so far, named cast (id, name, spot, onScreen)
 *   __game.tamashiGallery()           open the Tamashi gallery (?gallery=1) instead of the game
 */
import type { MisoAdapter } from "./miso/adapter";
import { MockAdapter, type FailKind, type FailureMode } from "./miso/mock-adapter";
import type { GameController } from "./game/controller";
import type { GameWorld } from "./world/world";
import type { RecordDeck } from "./audio/deck";
import { BUYER_SPOT, HOTEL_DOOR, PARKED_CARS } from "./world/layout";
import type { Interactable } from "./world/api";

/** Shop interior centre, used to face wall-mounted record sections. */
const SHOP_CENTRE = { x: 0, z: -7 };

/** Heading (0 = +z) from `from` towards `to`, or `fallback` when they coincide. */
function headingTo(from: { x: number; z: number }, to: { x: number; z: number }, fallback: number): number {
  const dx = to.x - from.x,
    dz = to.z - from.z;
  return Math.hypot(dx, dz) < 0.05 ? fallback : Math.atan2(dx, dz);
}

/**
 * Face the thing you're interacting with: the sedan (north, π: its interact point is
 * on the south sidewalk), Stonks (south, 0), the hotel door (north, π), records from
 * the shop centre, everything else north (π).
 */
function faceHeading(i: Interactable): number {
  switch (i.kind) {
    case "car": {
      const car = PARKED_CARS[Number(i.id.split(":")[1]) || 0] ?? PARKED_CARS[0];
      return car ? headingTo(i, car, Math.PI) : Math.PI;
    }
    case "buyer":
      return headingTo(i, BUYER_SPOT, 0);
    case "home":
      return headingTo(i, HOTEL_DOOR, Math.PI);
    case "record":
      return Math.atan2(i.x - SHOP_CENTRE.x, i.z - SHOP_CENTRE.z);
    default:
      return Math.PI;
  }
}

export function installDebugHooks(world: GameWorld, adapter: MisoAdapter, controller: GameController, deck: RecordDeck): void {
  const mock = adapter instanceof MockAdapter ? adapter : null;
  const hooks = {
    state: () => controller.state,
    world,
    adapter,
    controller,
    teleportTo(target: string | { x: number; z: number; heading?: number }): boolean {
      if (typeof target !== "string") {
        world.teleport(target.x, target.z, target.heading);
        return true;
      }
      const i = world.getInteractable(target);
      if (!i) return false;
      world.teleport(i.x, i.z, faceHeading(i));
      return true;
    },
    interact: () => controller.interact(controller.near),
    press(key: string): void {
      const code = key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
      const init = { code, key: key.length === 1 ? key : code, bubbles: true, cancelable: true };
      window.dispatchEvent(new KeyboardEvent("keydown", init));
      window.dispatchEvent(new KeyboardEvent("keyup", init));
    },
    failNext: (kind: FailKind) => mock?.failNext(kind),
    setFailureMode: (mode: FailureMode) => mock?.setFailureMode(mode),
    setLatency: (ms: number) => mock?.setLatency(ms),
    measure: () => world.measure(),
    deckDebug: () => deck.debugInfo(),
    buyerReturnNow: () => controller.buyerReturnNow(),
    crowdStats: () => world.crowdStats(),
    tamashiGallery(): void {
      location.assign(`${location.pathname}?gallery=1`);
    },
  };
  (window as unknown as { __game: typeof hooks }).__game = hooks;
  if (new URLSearchParams(location.search).get("debug") === "1") installDebugOverlay(() => hooks.measure());
}

/** Draw calls are re-measured this often (measure() renders one extra frame). */
const DEBUG_MEASURE_MS = 2000;

/**
 * `?debug=1` only: a small corner panel with the render backend
 * (`<html data-backend>`), the quality tier (`<html data-quality>`), FPS / frame time
 * and draw calls. Never shown to players otherwise. Reads only; no game logic.
 */
function installDebugOverlay(measure: () => { calls: number; triangles: number }): void {
  const panel = document.createElement("pre");
  panel.className = "debug-overlay";
  panel.setAttribute("aria-hidden", "true");
  Object.assign(panel.style, {
    position: "fixed",
    top: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "100",
    margin: "0",
    padding: "6px 10px",
    background: "rgba(0,0,0,0.72)",
    color: "#9effc4",
    font: "12px/1.35 ui-monospace, Menlo, Consolas, monospace",
    borderRadius: "4px",
    pointerEvents: "none",
    whiteSpace: "pre",
  });
  document.body.append(panel);
  let frames = 0;
  let windowStart = performance.now();
  let last = windowStart;
  let worst = 0;
  let fps = 0;
  let frameMs = 0;
  let draw = { calls: 0, triangles: 0 };
  let lastMeasure = 0;
  const tick = (now: number) => {
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    if (now - windowStart >= 500) {
      fps = (frames * 1000) / (now - windowStart);
      frameMs = (now - windowStart) / frames;
      frames = 0;
      windowStart = now;
      if (now - lastMeasure >= DEBUG_MEASURE_MS) {
        lastMeasure = now;
        try {
          draw = measure();
        } catch {
          /* renderer not ready yet */
        }
      }
      const d = document.documentElement.dataset;
      panel.textContent =
        `backend ${d.backend ?? "?"} · quality ${d.quality ?? "?"}\n` +
        `scale ${d.renderScale ?? "?"} · AO ${d.ao ?? "?"} · bloom ${d.bloom ?? "?"}\n` +
        `${fps.toFixed(0)} fps · ${frameMs.toFixed(1)} ms (worst ${worst.toFixed(0)} ms)\n` +
        `${draw.calls} draws · ${(draw.triangles / 1000).toFixed(0)}k tris`;
      worst = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
