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
 *   __game.teleportTo({x, z, heading})  "car:0", "buyer:collector", "atm"…) or a point
 *   __game.interact()                 same as pressing E where you stand
 *   __game.press("KeyN")              dispatch a key (code or single letter) on window
 *   __game.failNext("purchase")       mock: next purchase/sell/withdraw/any fails once
 *   __game.setFailureMode("none")     mock: purchase|sell|withdraw|all|none, sticky
 *   __game.setLatency(1500)           mock: simulated chain latency (ms)
 *   __game.measure()                  draw calls / triangles for one frame
 *   __game.deckDebug()                deck source, <audio> currentTime, preview window start
 *   __game.buyerReturnNow()           bring the collector back now (normally ~20 s after a sale)
 *   __game.crowdStats()               crowd on screen, distinct Tamashi ids shown so far, named cast (id, name, spot, onScreen)
 *   __game.tamashiGallery()           open the Tamashi gallery (?gallery=1) instead of the game
 */
import type { MisoAdapter } from "./miso/adapter";
import { MockAdapter, type FailKind, type FailureMode } from "./miso/mock-adapter";
import type { GameController } from "./game/controller";
import type { GameWorld } from "./world/world";
import type { RecordDeck } from "./audio/deck";

/** Shop interior centre, used to face wall-mounted record sections. */
const SHOP_CENTRE = { x: 0, z: -7 };

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
      // Face the thing you're interacting with (heading 0 = +z).
      const heading =
        i.kind === "car" ? 0 : i.kind === "record" ? Math.atan2(i.x - SHOP_CENTRE.x, i.z - SHOP_CENTRE.z) : Math.PI;
      world.teleport(i.x, i.z, heading);
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
}
