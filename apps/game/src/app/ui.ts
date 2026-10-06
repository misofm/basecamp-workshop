/**
 * Shell + Ui: the DOM pieces, built in the same order as before the port (see
 * docs/EFFECT.md): <main id="world"> (Shell) → adapter (Chain) → GameWorld (World) →
 * Hud → Minimap → Dialogs → Intro (UiParts) → RecordDeck → ShopAmbience (Audio) →
 * TitleCard (Ui). main.ts chains the layers in exactly that order.
 * Must not: hold game logic; the UI modules only draw what they are given.
 */
import { Context, Effect, Layer } from "effect";
import { Hud } from "../ui/hud";
import { Minimap } from "../ui/minimap";
import { Dialogs } from "../ui/dialogs";
import { Intro } from "../ui/intro";
import { TitleCard } from "../ui/title-card";
import { Chain } from "./chain";

export interface ShellApi {
  /** #app */
  readonly app: HTMLDivElement;
  /** <main id="world">, appended to #app; the GameWorld renders into it. */
  readonly worldHost: HTMLElement;
}

export class Shell extends Context.Service<Shell, ShellApi>()("app/Shell") {
  static readonly layer: Layer.Layer<Shell> = Layer.sync(Shell, () => {
    const app = document.querySelector<HTMLDivElement>("#app")!;
    const worldHost = document.createElement("main");
    worldHost.id = "world";
    app.append(worldHost);
    return { app, worldHost };
  });
}

export interface UiPartsApi {
  readonly app: HTMLDivElement;
  readonly hud: Hud;
  readonly minimap: Minimap;
  readonly dialogs: Dialogs;
  readonly intro: Intro;
}

/** Hud, Minimap, Dialogs, Intro (the TitleCard comes later, see Ui). */
export class UiParts extends Context.Service<UiParts, UiPartsApi>()("app/UiParts") {
  static readonly layer: Layer.Layer<UiParts, never, Shell | Chain> = Layer.effect(
    UiParts,
    Effect.gen(function* () {
      const { app } = yield* Shell;
      yield* Chain; // built before the UI parts (construction order, see above)
      const hud = new Hud(app);
      const minimap = new Minimap(hud.root);
      const dialogs = new Dialogs(app);
      const intro = new Intro(app);
      return { app, hud, minimap, dialogs, intro };
    }),
  );
}

export interface UiApi extends UiPartsApi {
  readonly titleCard: TitleCard;
}

/** Every DOM piece; built after Audio so the TitleCard is constructed where it was. */
export class Ui extends Context.Service<Ui, UiApi>()("app/Ui") {
  static readonly layer: Layer.Layer<Ui, never, UiParts> = Layer.effect(
    Ui,
    UiParts.useSync((parts) => ({ ...parts, titleCard: new TitleCard(parts.app) })),
  );
}
