/**
 * Bootstrap only: build the pieces and hand them to the GameController.
 *
 *   adapter  (src/miso)   chain access, chosen by ?chain=mock|testnet
 *   world    (src/world)  Three.js city + shop, behind WorldApi
 *   audio    (src/audio)  deck preview, sfx, ambience
 *   ui       (src/ui)     HUD, minimap, dialogs, boot cover (DOM only)
 *   controller (src/game/controller.ts) glues them; read it first.
 *
 * `?gallery=1` (all 100 Tamashi in a grid) or `?gallery=<id>` (one up close next to its
 * artwork) runs the visual-QA gallery (src/tamashi/gallery.ts) instead of the game.
 *
 * Must not: contain game logic. If you're adding behaviour, it goes in the controller.
 */
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./ui/style.css";
import { Effect, Scope } from "effect";
import { createAdapter } from "./miso/select";
import { GameWorld } from "./world/world";
import { RecordDeck } from "./audio/deck";
import { ShopAmbience } from "./audio/ambience";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Dialogs } from "./ui/dialogs";
import { Intro } from "./ui/intro";
import { TitleCard } from "./ui/title-card";
import { installDebugHooks } from "./debug";
import { urlConfig } from "./app/config";
import { makeChain } from "./app/chain";
import { GameStateStore } from "./app/game-state";
import { makeController } from "./app/controller";

const app = document.querySelector<HTMLDivElement>("#app")!;
const gallery = urlConfig().gallery;

if (gallery) {
  void import("./tamashi/gallery").then((m) => m.runGallery(app, gallery));
} else {
  const worldHost = document.createElement("main");
  worldHost.id = "world";
  app.append(worldHost);

  const adapter = createAdapter();
  const world = new GameWorld(worldHost);
  const hud = new Hud(app);
  const minimap = new Minimap(hud.root);
  const dialogs = new Dialogs(app);
  const intro = new Intro(app, adapter.network);

  const deck = new RecordDeck();
  // The app scope: flows run as fibers in it (a later step makes main.ts one Layer graph).
  const scope = Effect.runSync(Scope.make());
  const controller = Effect.runSync(
    makeController({
      world,
      chain: makeChain(adapter),
      gameState: GameStateStore.makeSync(),
      deck,
      ambience: new ShopAmbience(),
      hud,
      minimap,
      dialogs,
      intro,
      titleCard: new TitleCard(app),
    }).pipe(Scope.provide(scope)),
  );
  installDebugHooks(world, adapter, controller, deck);
  // The street compiles its GPU pipelines behind the loading screen; Enter appears when
  // everything is warm (and the records are on the shelves) so play never hitches.
  const catalogStep = intro.track(2, 1500);
  const assetsStep = intro.track(5, 6000);
  const warmStep = intro.track(3, 3000, true);
  const booted = controller.boot().finally(catalogStep.done);
  const assets = world.ready.finally(assetsStep.done);
  void Promise.all([assets, booted])
    .then(() => {
      warmStep.start();
      return world.warmUp().finally(warmStep.done);
    })
    .catch(() => undefined)
    .then(() => intro.setReady());
}
