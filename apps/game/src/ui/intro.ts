/**
 * The loading screen: a small "NOZOMI · 再生" mark on a paper card, a loading bar that
 * reflects real progress, and, once everything is ready, "[Enter] Press Enter" (a click
 * works too). No story, no checklist, no controls list.
 *
 * Owns: the overlay DOM, the progress model and the Enter / click start. Enter is swallowed
 * (capture phase) so the same press never also triggers an in-game action.
 * Must not: start audio or the game itself; it calls `onStart` from inside the key / click
 * handler (a user gesture) and the controller unlocks audio there.
 *
 * Progress: each tracked task has a weight. While it runs, its share creeps towards ~90 %
 * (exponential, so it never freezes and never reaches 100 % early); when it settles it jumps
 * to its full weight.
 */
import { h, isBrowserShortcut } from "./dom";

interface Task {
  weight: number;
  tauMs: number;
  startedAt: number | null;
  done: boolean;
}

export class Intro {
  onStart: () => void = () => {};
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private fill: HTMLElement;
  private button: HTMLButtonElement;
  private tasks: Task[] = [];
  private started = false;
  private ready = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(host: HTMLElement, network: "mock" | "testnet") {
    this.fill = h("i");
    this.bar = h("div", { class: "intro-bar", role: "progressbar", "aria-label": "Loading", "aria-valuemin": 0, "aria-valuemax": 100 }, this.fill);
    this.button = h("button", { class: "intro-start", type: "button", hidden: true }, h("span", { class: "intro-word" }, "Press"), h("kbd", null, "Enter"), h("span", { class: "intro-word" }, "to continue"));
    this.button.addEventListener("click", () => this.start());
    this.root = h(
      "div",
      { class: "intro", role: "dialog", "aria-modal": "true", "aria-labelledby": "intro-title" },
      h(
        "div",
        { class: "intro-card" },
        network === "mock" ? h("span", { class: "net-status", "data-network": network }, "offline demo") : null,
        h("h1", { id: "intro-title", class: "intro-title" }, h("span", null, "NOZOMI"), " · ", h("span", { class: "jp" }, "再生")),
        this.bar,
        this.button,
        h("p", { class: "intro-credit" }, "Tamashi and Nozomi © Studio Mirai"),
      ),
    );
    host.append(this.root);
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.started) return;
        // Swallow every key while the screen is up so nothing reaches the game; only Enter starts.
        // Browser shortcuts (F5, F11, Ctrl/Cmd+R…) keep working: a stuck load must stay reloadable.
        e.stopImmediatePropagation();
        if (isBrowserShortcut(e)) return;
        e.preventDefault();
        if (e.repeat) return;
        if (this.ready && (e.code === "Enter" || e.code === "NumpadEnter")) this.start();
      },
      true,
    );
    this.timer = setInterval(() => this.paint(), 80);
    this.paint();
  }

  get isOpen(): boolean {
    return !this.started;
  }

  /**
   * Register a load step. It starts creeping now unless `deferred`; call `start()` when a
   * deferred step begins and `done()` when it settles (ok or not).
   */
  track(weight: number, tauMs: number, deferred = false): { start: () => void; done: () => void } {
    const task: Task = { weight, tauMs, startedAt: deferred ? null : performance.now(), done: false };
    this.tasks.push(task);
    return {
      start: () => (task.startedAt ??= performance.now()),
      done: () => {
        task.done = true;
        this.paint();
      },
    };
  }

  private fraction(): number {
    const total = this.tasks.reduce((a, t) => a + t.weight, 0) || 1;
    const now = performance.now();
    const got = this.tasks.reduce((a, t) => a + t.weight * (t.done ? 1 : t.startedAt === null ? 0 : 0.9 * (1 - Math.exp(-(now - t.startedAt) / t.tauMs))), 0);
    return Math.min(1, got / total);
  }

  private paint(): void {
    if (this.ready) return;
    const f = this.fraction();
    this.fill.style.width = `${(f * 100).toFixed(1)}%`;
    this.bar.setAttribute("aria-valuenow", String(Math.round(f * 100)));
  }

  /** Everything is loaded: swap the bar for "Press Enter". */
  setReady(): void {
    if (this.ready || this.started) return;
    this.ready = true;
    clearInterval(this.timer);
    this.fill.style.width = "100%";
    this.bar.hidden = true;
    this.button.hidden = false;
    this.root.dataset.ready = "true";
    this.button.focus();
  }

  private start(): void {
    if (this.started || !this.ready) return;
    this.started = true;
    // Same as the title card: never leave focus on the fading "Press Enter" button.
    this.button.blur();
    this.root.classList.add("leaving");
    setTimeout(() => this.root.remove(), 600);
    this.onStart();
  }
}
