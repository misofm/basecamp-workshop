/**
 * Bootstrap only: build the pieces and hand them to the GameController.
 *
 *   adapter  (src/miso)   chain access, chosen by ?chain=mock|testnet
 *   world    (src/world)  Three.js city + shop, behind WorldApi
 *   audio    (src/audio)  deck preview, sfx, ambience
 *   ui       (src/ui)     HUD, minimap, dialogs, intro (DOM only)
 *   controller (src/game/controller.ts) glues them; read it first.
 *
 * Must not: contain game logic. If you're adding behaviour, it goes in the controller.
 */
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "./ui/style.css";
import { createAdapter } from "./miso/select";
import { GameWorld } from "./world/world";
import { RecordDeck } from "./audio/deck";
import { ShopAmbience } from "./audio/ambience";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Dialogs } from "./ui/dialogs";
import { Intro } from "./ui/intro";
import { GameController } from "./game/controller";
import { installDebugHooks } from "./debug";

const app = document.querySelector<HTMLDivElement>("#app")!;
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
const controller = new GameController({
  world,
  adapter,
  deck,
  ambience: new ShopAmbience(),
  hud,
  minimap,
  dialogs,
  intro,
});
installDebugHooks(world, adapter, controller, deck);
void controller.boot();
