/**
 * Chapter title card for the exit beat (world bible §7.4): after the boom and the
 * iron footsteps, "Book 3 — Dawn of the Machin" fills the screen until the player
 * dismisses it (Enter, Esc, Space or a click).
 *
 * Owns: the overlay DOM and its dismiss keys (captured, so Dialogs and the controller
 * never see them).
 * Must not: play audio, touch the world or change game state. The controller awaits
 * show() and carries on (the player is free to walk again afterwards).
 */
import { h, isBrowserShortcut } from "./dom";

export class TitleCard {
  private root: HTMLElement | null = null;
  private resolve: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Show the card; resolves when the player dismisses it. */
  show(): Promise<void> {
    if (this.root) return Promise.resolve();
    const button = h("button", { class: "title-card-dismiss", type: "button" }, h("kbd", null, "Enter"), h("span", null, "Continue"));
    this.root = h(
      "div",
      { class: "title-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "title-card-title" },
      h(
        "div",
        { class: "title-card-inner" },
        h("h1", { id: "title-card-title", class: "title-card-title" }, h("span", null, "Book 3 — "), "Dawn of the Machin"),
        h("p", { class: "title-card-credit" }, "Nozomi · Tamashi and Nozomi © Studio Mirai"),
        button,
      ),
    );
    this.root.addEventListener("click", () => this.dismiss());
    window.addEventListener("keydown", this.onKey, true);
    this.host.append(this.root);
    button.focus();
    return new Promise<void>((resolve) => (this.resolve = resolve));
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.root) return;
    // Swallow every key while the card is up; only these dismiss it. Browser shortcuts
    // (F5, F11, Ctrl/Cmd+R…) keep their default.
    e.stopImmediatePropagation();
    if (isBrowserShortcut(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Escape" || e.code === "Space") this.dismiss();
  };

  private dismiss(): void {
    const root = this.root;
    if (!root) return;
    this.root = null;
    window.removeEventListener("keydown", this.onKey, true);
    // Drop focus now: the fading card keeps its "Continue" button in the DOM for 500 ms, and
    // a focused button makes the world ignore E / Enter (and a dialog opened meanwhile would
    // hand focus back to it on close).
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur();
    root.classList.add("leaving");
    setTimeout(() => root.remove(), 500);
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }
}
