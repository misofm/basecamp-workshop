/**
 * Title card shown before play: "NOZOMI · Book 3 — As The World Shook", level
 * "Playback", a dusk card (orange-to-violet gradient, CRT scanlines) with the intro
 * text (world bible §7.11, ≤ 60 words) and the Studio Mirai credit.
 *
 * Owns: the intro overlay DOM, its loading lines (crates / cash) and the
 * "Press Enter" start (Enter, Space or click).
 * Must not: start audio or the game itself; it calls `onStart` and the
 * controller does the rest (unlock audio, ambience, show the HUD).
 */
import { h } from "./dom";

/** The intro text (57 words; keep it ≤ 60). No blockchain terms. */
export const INTRO_TEXT =
  "Less than a month after ninety-eight sleepers unplugged from the Tamashi machines, only three city blocks have power. " +
  "Chaos's fires still smolder; Order holds the old hotel. You are Gamer — a Takahashi nobody can know about. " +
  "Spin a record at Saisei. Sell one to Stonks. Make a friend. Get home before the ground starts shaking.";

export class Intro {
  onStart: () => void = () => {};
  readonly root: HTMLElement;
  private status: HTMLElement;
  private button: HTMLButtonElement;
  private started = false;

  constructor(host: HTMLElement, network: "mock" | "testnet") {
    this.status = h("ul", { class: "intro-status" });
    this.button = h("button", { class: "intro-start", type: "button" }, h("span", null, "Press"), h("kbd", null, "Enter"));
    this.button.addEventListener("click", () => this.start());
    this.root = h(
      "div",
      { class: "intro", role: "dialog", "aria-modal": "true", "aria-labelledby": "intro-title" },
      h(
        "div",
        { class: "intro-card" },
        h(
          "div",
          { class: "intro-top" },
          h("span", { class: "intro-kicker" }, "A MISO BASECAMP DEMO"),
          h("span", { class: "net-status", "data-network": network }, h("i", { class: "net-dot", "aria-hidden": "true" }), network === "mock" ? "offline demo" : "online"),
        ),
        h("span", { class: "intro-level" }, "Level · Playback"),
        h("h1", { id: "intro-title", class: "intro-title" }, h("span", null, "NOZOMI"), h("em", null, "Book 3 — As The World Shook")),
        h("p", { class: "intro-text" }, h("b", null, "Nozomi, 2042. "), INTRO_TEXT),
        h("p", { class: "intro-pitch" }, "Buy a record. Smash a car with it. Sell it on."),
        this.status,
        this.button,
        h("p", { class: "intro-keys" }, "WASD move · Shift sprint · Space jump · E interact · C collection · M mute · H help"),
        h("p", { class: "intro-credit" }, "Tamashi and Nozomi © Studio Mirai"),
      ),
    );
    host.append(this.root);
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.started || (e.code !== "Enter" && e.code !== "NumpadEnter" && e.code !== "Space")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.start();
      },
      true,
    );
    this.button.focus();
  }

  get isOpen(): boolean {
    return !this.started;
  }

  /** One loading line, e.g. setStatus("catalog", "Catalog: 10 records", "ok"). */
  setStatus(id: string, text: string, state: "loading" | "ok" | "error"): void {
    let line = this.status.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!line) {
      line = h("li", { "data-id": id });
      this.status.append(line);
    }
    line.className = `st-${state}`;
    line.textContent = text;
  }

  /**
   * Hold the start until `ready` settles (the 3D street is compiled and lit), so the first
   * seconds of play never hitch. A press while waiting starts the game as soon as it is ready.
   */
  waitFor(ready: Promise<unknown>): void {
    this.gate = ready.then(
      () => undefined,
      () => undefined,
    );
    this.button.classList.add("waiting");
    void this.gate.then(() => {
      this.gate = null;
      this.button.classList.remove("waiting");
      if (this.pressed) this.start();
    });
  }
  private gate: Promise<void> | null = null;
  private pressed = false;

  private start(): void {
    if (this.started) return;
    if (this.gate) {
      this.pressed = true;
      return;
    }
    this.started = true;
    this.root.classList.add("leaving");
    setTimeout(() => this.root.remove(), 600);
    this.onStart();
  }
}
