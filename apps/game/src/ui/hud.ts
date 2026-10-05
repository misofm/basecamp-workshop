/**
 * The heads-up display: everything drawn over the 3D scene while playing.
 *
 * Owns: the DOM for the GTA-style money counter (count-up animation, green/red
 * flash, pending spinner), wallet + network badge, mission text, held-record card,
 * now-playing bar, the [E] interaction prompt, toasts (small + big centre
 * "mission" toasts), the mute badge and the controls footer.
 * Must not: contain game logic, read game state or call the adapter/world. The
 * controller pushes plain view data in through the setters below.
 */
import { formatAmount } from "../miso/format";
import { coverFallback } from "../miso/media";
import { h } from "./dom";

export interface HeldCard {
  title: string;
  artist: string;
  coverUrl: string;
  /** "OWNED · #106/250" or "UNPAID · 12.00 FUSD". */
  status: string;
  owned: boolean;
}

export interface NowPlaying {
  title: string;
  artist: string;
  trackTitle: string;
  trackNumber: number;
  trackCount: number;
  /** null while the stream is still starting. */
  source: "hls" | "synth" | null;
}

export interface ToastOptions {
  tone?: "info" | "good" | "bad" | "speech";
  /** Speaker name for speech toasts ("Clerk", "The Collector"). */
  speaker?: string;
  link?: { href: string; label: string };
  durationMs?: number;
}

const MONEY_ANIM_MS = 1000;

export class Hud {
  readonly root: HTMLElement;
  private moneyEl: HTMLElement;
  private moneyValue: HTMLElement;
  private moneySymbol: HTMLElement;
  private moneyDelta: HTMLElement;
  private pendingEl: HTMLElement;
  private pendingText: HTMLElement;
  private walletEl: HTMLElement;
  private missionEl: HTMLElement;
  private missionText: HTMLElement;
  private heldEl: HTMLElement;
  private playingEl: HTMLElement;
  private progressFill: HTMLElement;
  private progressTime: HTMLElement;
  private promptEl: HTMLElement;
  private promptLabel: HTMLElement;
  private toastsEl: HTMLElement;
  private bigToastEl: HTMLElement;
  private muteEl: HTMLElement;

  private shownAmount: number | null = null;
  private targetAmount: bigint | null = null;
  private decimals = 6;
  private symbol = "FUSD";
  private anim = 0;
  private bigToastTimer = 0;
  private lastMission = "";
  private lastHeldKey = "";
  private lastPlayingKey = "";

  constructor(host: HTMLElement) {
    this.moneySymbol = h("span", { class: "money-symbol" }, "FUSD");
    this.moneyValue = h("span", { class: "money-value" }, "—");
    this.moneyDelta = h("div", { class: "money-delta", "aria-hidden": "true" });
    this.moneyEl = h("div", { class: "money", role: "status", "aria-label": "FakeUSD balance" }, this.moneySymbol, this.moneyValue);
    this.pendingText = h("span", null, "Processing on Sui…");
    this.pendingEl = h("div", { class: "money-pending", hidden: true }, h("span", { class: "spinner" }), this.pendingText);
    this.walletEl = h("div", { class: "wallet" });
    this.missionText = h("p", { class: "mission-text" });
    this.missionEl = h("section", { class: "mission", "aria-live": "polite" }, h("div", { class: "mission-label" }, "MISSION"), this.missionText);
    this.heldEl = h("section", { class: "held-card", hidden: true, "aria-live": "polite" });
    this.progressFill = h("div", { class: "np-fill" });
    this.progressTime = h("span", { class: "np-time" }, "0:00 / 0:30");
    this.playingEl = h("section", { class: "now-playing", hidden: true, "aria-live": "polite" });
    this.promptLabel = h("span", { class: "prompt-label" });
    this.promptEl = h("div", { class: "prompt", hidden: true }, h("kbd", null, "E"), this.promptLabel);
    this.toastsEl = h("div", { class: "toasts", "aria-live": "polite" });
    this.bigToastEl = h("div", { class: "big-toast", hidden: true, role: "status" });
    this.muteEl = h("div", { class: "mute-badge", hidden: true }, "SOUND OFF · M");
    const controls = h(
      "footer",
      { class: "controls" },
      ...[
        ["WASD", "move"],
        ["Shift", "sprint"],
        ["E", "interact"],
        ["C", "collection"],
        ["M", "mute"],
        ["H", "help"],
      ].map(([key, label]) => h("span", null, h("kbd", null, key), label)),
    );
    this.root = h(
      "div",
      { id: "hud", class: "hud", hidden: true },
      h("div", { class: "hud-top-right" }, this.moneyEl, this.moneyDelta, this.pendingEl, this.walletEl, this.muteEl),
      this.missionEl,
      h("div", { class: "hud-bottom-right" }, this.playingEl, this.heldEl),
      this.promptEl,
      this.toastsEl,
      this.bigToastEl,
      controls,
    );
    host.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  // ---------------------------------------------------------------- money

  /** Set the balance; animates from the previous value and flashes green/red. */
  setMoney(amount: bigint | null, decimals = 6, symbol = "FUSD"): void {
    this.decimals = decimals;
    this.symbol = symbol;
    this.moneySymbol.textContent = symbol;
    if (amount === null) {
      this.targetAmount = null;
      this.moneyValue.textContent = "—";
      return;
    }
    if (this.targetAmount === amount) return;
    const previous = this.targetAmount;
    this.targetAmount = amount;
    const to = Number(amount) / 10 ** decimals;
    if (previous === null || this.shownAmount === null) {
      this.shownAmount = to;
      this.moneyValue.textContent = formatAmount(amount, decimals);
      return;
    }
    const diff = amount - previous;
    this.flashMoney(diff > 0n ? "up" : "down", diff);
    const from = this.shownAmount;
    const start = performance.now();
    cancelAnimationFrame(this.anim);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / MONEY_ANIM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this.shownAmount = from + (to - from) * eased;
      this.moneyValue.textContent =
        t < 1 ? this.shownAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : formatAmount(amount, decimals);
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  private flashMoney(direction: "up" | "down", diff: bigint): void {
    this.moneyEl.classList.remove("flash-up", "flash-down");
    void this.moneyEl.offsetWidth; // restart the CSS animation
    this.moneyEl.classList.add(direction === "up" ? "flash-up" : "flash-down");
    this.moneyDelta.textContent = `${diff > 0n ? "+" : "−"}${formatAmount(diff < 0n ? -diff : diff, this.decimals)}`;
    this.moneyDelta.className = `money-delta show ${direction}`;
    void this.moneyDelta.offsetWidth;
  }

  /** Spinner under the money counter while a transaction is in flight. null hides it. */
  setPending(text: string | null): void {
    this.pendingEl.hidden = text === null;
    if (text) this.pendingText.textContent = text;
  }

  setWallet(address: string | null, network: "mock" | "testnet"): void {
    this.walletEl.replaceChildren(
      h("span", { class: `net-badge net-${network}` }, network === "mock" ? "MOCK CHAIN" : "SUI TESTNET"),
      h("span", { class: "wallet-address" }, address ?? "connecting…"),
    );
  }

  setMuted(muted: boolean): void {
    this.muteEl.hidden = !muted;
  }

  // -------------------------------------------------------------- mission

  setMission(text: string): void {
    if (text === this.lastMission) return;
    this.lastMission = text;
    this.missionText.textContent = text;
    this.missionEl.classList.remove("mission-new");
    void this.missionEl.offsetWidth;
    this.missionEl.classList.add("mission-new");
  }

  // ----------------------------------------------------------- held record

  setHeld(card: HeldCard | null): void {
    const key = card ? `${card.title}|${card.status}` : "";
    if (key === this.lastHeldKey) return;
    this.lastHeldKey = key;
    this.heldEl.hidden = !card;
    if (!card) return;
    this.heldEl.replaceChildren(
      h("img", { class: "held-cover", src: card.coverUrl, alt: "", onerror: coverFallback }),
      h(
        "div",
        { class: "held-info" },
        h("div", { class: "held-label" }, "IN HAND"),
        h("div", { class: "held-title" }, card.title),
        h("div", { class: "held-artist" }, card.artist),
        h("div", { class: `held-status ${card.owned ? "owned" : "unpaid"}` }, card.status),
        h("div", { class: "held-hint" }, h("kbd", null, "I"), "inspect"),
      ),
    );
  }

  // ----------------------------------------------------------- now playing

  setNowPlaying(np: NowPlaying | null): void {
    const key = np ? `${np.title}|${np.trackNumber}|${np.source}` : "";
    if (key === this.lastPlayingKey) return;
    this.lastPlayingKey = key;
    this.playingEl.hidden = !np;
    if (!np) return;
    this.progressFill.style.width = "0%";
    this.progressTime.textContent = "0:00 / 0:30";
    const badge = np.source
      ? h("span", { class: `np-badge np-${np.source}` }, np.source === "hls" ? "HLS" : "SYNTH")
      : h("span", { class: "np-badge np-loading" }, "LOADING");
    this.playingEl.replaceChildren(
      h(
        "div",
        { class: "np-head" },
        h("span", { class: "np-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
        h("span", { class: "np-label" }, "NOW PLAYING"),
        badge,
      ),
      h("div", { class: "np-track" }, `${np.trackNumber}. ${np.trackTitle}`),
      h("div", { class: "np-record" }, `${np.title} — ${np.artist}`),
      h("div", { class: "np-bar" }, this.progressFill),
      h("div", { class: "np-foot" }, this.progressTime, h("span", { class: "np-next" }, h("kbd", null, "N"), `next track (${np.trackNumber}/${np.trackCount})`)),
    );
  }

  setProgress(elapsedSec: number, windowSec: number): void {
    const pct = windowSec > 0 ? Math.min(100, (elapsedSec / windowSec) * 100) : 0;
    this.progressFill.style.width = `${pct.toFixed(1)}%`;
    this.progressTime.textContent = `${clock(elapsedSec)} / ${clock(windowSec)}`;
  }

  // ---------------------------------------------------------------- prompt

  setPrompt(label: string | null): void {
    this.promptEl.hidden = label === null;
    if (label !== null) this.promptLabel.textContent = label;
  }

  // ---------------------------------------------------------------- toasts

  toast(text: string, options: ToastOptions = {}): void {
    const tone = options.tone ?? "info";
    const el = h(
      "div",
      { class: `toast toast-${tone}` },
      options.speaker ? h("span", { class: "toast-speaker" }, options.speaker) : null,
      h("span", { class: "toast-text" }, text),
      options.link
        ? h("a", { class: "toast-link", href: options.link.href, target: "_blank", rel: "noopener noreferrer" }, options.link.label)
        : null,
    );
    this.toastsEl.append(el);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild?.remove();
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 400);
    }, options.durationMs ?? 3800);
  }

  /** Big centre-screen GTA-style banner ("RECORD CONDITION: STILL MINT"). */
  missionToast(title: string, subtitle = "", tone: "good" | "bad" | "info" = "good", durationMs = 3600): void {
    clearTimeout(this.bigToastTimer);
    this.bigToastEl.className = `big-toast big-${tone}`;
    this.bigToastEl.replaceChildren(h("div", { class: "big-title" }, title), subtitle ? h("div", { class: "big-sub" }, subtitle) : "");
    this.bigToastEl.hidden = false;
    this.bigToastTimer = window.setTimeout(() => (this.bigToastEl.hidden = true), durationMs);
  }
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
