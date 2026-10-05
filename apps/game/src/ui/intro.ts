/**
 * Title card shown before play ("MISO RECORDS · AFTER HOURS").
 *
 * Owns: the intro overlay DOM, its loading lines (catalog / wallet) and the
 * "Press Enter" start (Enter, Space or click).
 * Must not: start audio or the game itself; it calls `onStart` and the
 * controller does the rest (unlock audio, ambience, show the HUD).
 */
import { h } from "./dom";

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
        h("div", { class: "intro-top" }, h("span", { class: `net-badge net-${network}` }, network === "mock" ? "MOCK CHAIN" : "SUI TESTNET"), h("span", { class: "intro-kicker" }, "A MISO BASECAMP DEMO")),
        h("h1", { id: "intro-title", class: "intro-title" }, h("span", null, "MISO RECORDS"), h("em", null, "after hours")),
        h("p", { class: "intro-pitch" }, "Buy a record on Sui. Smash a car with it. Sell it on."),
        this.status,
        this.button,
        h("p", { class: "intro-keys" }, "WASD move · Shift sprint · E interact · C collection · M mute · H help"),
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

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.root.classList.add("leaving");
    setTimeout(() => this.root.remove(), 600);
    this.onStart();
  }
}
