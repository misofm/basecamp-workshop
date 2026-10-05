/**
 * Accessible modal menus (one native <dialog>), plus view builders for each screen.
 *
 * Owns: the dialog element, its keyboard handling (↑↓ / W S select, Enter / E /
 * Space confirm, Esc close, per-action hotkeys), focus management, the skin (CRT
 * terminal in amber / green, paper, enamel plate, price tag; see docs/UI-STYLE.md) and the
 * DOM for every screen: record tag, deck, counter, pending, receipt, errors, ATM,
 * collection and help.
 * Must not: decide what an action does. Screens take plain view data and a list of
 * actions (label + callback) chosen by the controller. Opening/closing reports
 * through `onOpenChange` so the controller can freeze player input; nothing here
 * ever blocks the render loop (all work is synchronous DOM updates).
 */
import { coverFallback } from "../miso/media";
import { copyText, h } from "./dom";

export interface DialogAction {
  id: string;
  label: string;
  /** Small right-aligned hint, e.g. a price. */
  detail?: string;
  /** Keycap shown on the button ("E", "Esc", "N"). */
  key?: string;
  /** Extra KeyboardEvent.code that triggers this action while the dialog is open (e.g. "KeyN"). */
  hotkey?: string;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  run: () => void;
}

/** CRT terminals (amber, green) for machines; paper / tag / enamel for people and things. */
export type DialogSkin = "amber" | "green" | "paper" | "tag" | "enamel";

export interface DialogSpec {
  /** Which screen this is ("record", "deck", "purchase", "sell", "collection", "help"…). */
  key: string;
  tone?: "default" | "pending" | "success" | "error";
  skin?: DialogSkin;
  title: string;
  /** Render the title as a red hanko stamp: "領収 PAID" → { jp: "領収", en: "PAID" }. */
  stamp?: { jp: string; en: string };
  /** CRT only: a Japanese character boxed in front of the title ("済 CASH OUT"). */
  titleJp?: string;
  body?: Node | (Node | null)[];
  actions?: DialogAction[];
  wide?: boolean;
  /** false = Esc / × do nothing (rare; pending screens stay closable). */
  closable?: boolean;
  onClose?: () => void;
}

const NAV_KEYS = ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "Enter", "NumpadEnter", "KeyE", "Space", "Escape"];
const TILTS: Record<DialogSkin, string> = { amber: "0deg", green: "0deg", paper: "-1.2deg", tag: "1.2deg", enamel: "-0.8deg" };

export class Dialogs {
  /** Called with true when a dialog opens and false when it closes. */
  onOpenChange: (open: boolean) => void = () => {};
  /** Called on every keyboard move/confirm (for a UI blip). */
  onNavigate: () => void = () => {};

  private el: HTMLDialogElement;
  private content: HTMLElement;
  private spec: DialogSpec | null = null;

  constructor(host: HTMLElement) {
    this.content = h("div", { class: "dlg-content" });
    this.el = h("dialog", { class: "dlg", "aria-labelledby": "dlg-title" }, this.content);
    this.el.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.requestClose();
    });
    host.append(this.el);
    // Capture phase: runs before the world's E/Enter handler and swallows menu keys.
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  get openKey(): string | null {
    return this.el.open ? (this.spec?.key ?? null) : null;
  }

  /** Show a screen (replacing any open one). Keeps focus on the same action id if it still exists. */
  show(spec: DialogSpec): void {
    const previousFocus = this.el.open && this.spec?.key === spec.key ? (document.activeElement as HTMLElement | null)?.dataset.actionId : undefined;
    const wasOpen = this.el.open;
    const skin = spec.skin ?? "paper";
    this.spec = spec;
    this.el.className = `dlg skin-${skin} tone-${spec.tone ?? "default"}${spec.wide ? " dlg-wide" : ""}${wasOpen ? " dlg-swap" : ""}`;
    this.el.style.setProperty("--tilt", TILTS[skin]);
    const actions = (spec.actions ?? []).map((a) => {
      const button = h(
        "button",
        { class: `dlg-action dlg-nav ${a.kind ?? "secondary"}`, type: "button", "data-action-id": a.id, disabled: a.disabled ?? false },
        a.key ? h("kbd", null, a.key) : null,
        h("span", { class: "dlg-action-label" }, a.label),
        a.detail ? h("span", { class: "dlg-action-detail" }, a.detail) : null,
      );
      button.addEventListener("click", () => {
        if (!button.disabled) a.run();
      });
      return button;
    });
    const body = spec.body === undefined ? [] : Array.isArray(spec.body) ? spec.body : [spec.body];
    const title = h(
      "h2",
      { id: "dlg-title", class: `dlg-title${spec.stamp ? " is-stamp" : ""}` },
      spec.stamp
        ? [h("span", { class: "stamp-jp jp" }, spec.stamp.jp), " ", h("span", { class: "stamp-en" }, spec.stamp.en)]
        : [spec.titleJp ? h("span", { class: "title-jp jp" }, spec.titleJp) : null, spec.titleJp ? " " : null, spec.title],
    );
    const nodes: (Node | null)[] = [
      title,
      ...body.filter((n): n is Node => n !== null),
      actions.length ? h("div", { class: "dlg-actions" }, ...actions) : null,
    ];
    this.content.replaceChildren(...nodes.filter((n): n is Node => n !== null));
    if (!wasOpen) {
      this.el.showModal();
      this.onOpenChange(true);
    }
    const nav = this.navTargets();
    const keep = previousFocus ? nav.find((b) => b.dataset.actionId === previousFocus) : undefined;
    const primary = actions.find((b) => !b.disabled && b.classList.contains("primary"));
    (keep ?? primary ?? actions.find((b) => !b.disabled) ?? nav[0] ?? this.el)?.focus({ preventScroll: true });
  }

  /** Update only if this screen is still the one showing (async results arriving late). */
  showIf(key: string, spec: DialogSpec): boolean {
    if (this.openKey !== key) return false;
    this.show(spec);
    return true;
  }

  close(): void {
    if (!this.el.open) return;
    const spec = this.spec;
    this.el.close();
    this.spec = null;
    this.content.replaceChildren();
    this.onOpenChange(false);
    spec?.onClose?.();
  }

  private requestClose(): void {
    if (this.spec?.closable === false) return;
    this.close();
  }

  private navTargets(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>(".dlg-nav")).filter(
      (b) => !(b instanceof HTMLButtonElement && b.disabled),
    );
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.el.open) return;
    const hotkey = this.spec?.actions?.find((a) => a.hotkey === e.code && !a.disabled);
    if (!hotkey && !NAV_KEYS.includes(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (hotkey) {
      this.onNavigate();
      hotkey.run();
      return;
    }
    if (e.code === "Escape") {
      this.requestClose();
      return;
    }
    const targets = this.navTargets();
    const focused = document.activeElement as HTMLElement | null;
    if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "KeyE" || e.code === "Space") {
      if (focused && this.el.contains(focused) && targets.includes(focused)) {
        this.onNavigate();
        focused.click();
      }
      return;
    }
    if (!targets.length) return;
    const current = focused ? targets.indexOf(focused) : -1;
    const direction = e.code === "ArrowUp" || e.code === "KeyW" ? -1 : 1;
    const next = current < 0 ? (direction > 0 ? 0 : targets.length - 1) : (current + direction + targets.length) % targets.length;
    targets[next]?.focus();
    this.onNavigate();
  }
}

// ═════════════════════════════════ view builders ═════════════════════════════════
// Pure functions: plain data in, DOM out. No game rules.

/** One quiet line under the title. */
export function paragraph(text: string, className = "dlg-p"): HTMLElement {
  return h("p", { class: className }, text);
}

export interface RecordView {
  title: string;
  artist: string;
  coverUrl: string;
  palette: string[];
  priceText: string;
  /** "#106/250" (the copy this pick-up would be) or "sold out". */
  edition: string;
}

/** The price tag: small sleeve, "Artist · #106/250", price stamped on. */
export function recordBody(r: RecordView): HTMLElement {
  const accent = r.palette[1] ?? "#d5b776";
  return h(
    "div",
    { class: "rec", style: `--accent:${accent}` },
    h("img", { class: "rec-cover", src: r.coverUrl, alt: `${r.title} sleeve artwork`, onerror: coverFallback }),
    h("div", { class: "rec-info" }, h("p", { class: "rec-artist" }, `${r.artist} · ${r.edition}`), h("div", { class: "rec-price" }, r.priceText)),
  );
}

/** Small cover + one line, for the receipt and the offer. */
export function recordLine(coverUrl: string, text: string): HTMLElement {
  return h("div", { class: "strip" }, h("img", { src: coverUrl, alt: "", onerror: coverFallback }), h("p", { class: "strip-line" }, text));
}

/** Scrolling "PROCESSING ▮▮▮▯▯" bar (static in reduced motion). */
export function pendingBody(): HTMLElement {
  return h(
    "div",
    { class: "pending", role: "status", "aria-label": "Processing" },
    h("div", { class: "pending-bar", "aria-hidden": "true" }, ...[0, 1, 2, 3, 4].map((i) => h("i", { style: `--i:${i}` }, "▮"))),
  );
}

export function errorBody(message: string): HTMLElement {
  return h("p", { class: "err-msg" }, message);
}

export interface ReceiptLink {
  href: string;
  /** Stable hook for tests (data-receipt-link). */
  id?: string;
}

/** The single small "View receipt ↗" link. It is a menu stop (Tab / arrows), like a button. */
export function receiptLink(link: ReceiptLink): HTMLElement {
  return h("a", { class: "mini link dlg-nav", href: link.href, target: "_blank", rel: "noopener noreferrer", "data-receipt-link": link.id ?? "tx" }, "View receipt ↗");
}

export interface CollectionItem {
  recordId: string;
  title: string;
  artist: string;
  coverUrl: string;
  serialText: string;
  /** Button label ("Hold", "Put away", "In hand"…); null = no button. */
  actionLabel: string | null;
  actionDisabled?: boolean;
  onAction?: () => void;
}

export interface SoldItem {
  title: string;
  paidText: string;
}

export function collectionBody(
  state: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: CollectionItem[]; sold: SoldItem[] },
): HTMLElement {
  if (state.kind === "loading") return h("div", { class: "coll coll-loading", "aria-busy": "true" }, pendingBody());
  if (state.kind === "error") return errorBody(state.message);
  const items = state.items.map((item) => {
    const button = item.actionLabel
      ? h("button", { class: "mini dlg-nav coll-hold", type: "button", disabled: item.actionDisabled ?? false }, item.actionLabel)
      : null;
    if (button && item.onAction) button.addEventListener("click", item.onAction);
    return h(
      "div",
      { class: "coll-item", "data-record-id": item.recordId },
      h("img", { src: item.coverUrl, alt: "", onerror: coverFallback }),
      h("div", { class: "coll-text" }, h("strong", null, item.title), h("small", null, item.serialText)),
      button,
    );
  });
  return h(
    "div",
    { class: "coll" },
    items.length ? h("div", { class: "coll-list" }, ...items) : paragraph("Nothing yet."),
    state.sold.length
      ? h(
          "div",
          { class: "coll-sold" },
          ...state.sold.map((s) => h("div", { class: "coll-sold-row" }, h("span", null, s.title), h("b", null, s.paidText))),
        )
      : null,
  );
}

export function helpBody(): HTMLElement {
  const rows: [string, string][] = [
    ["WASD", "Walk"],
    ["Shift", "Sprint"],
    ["Space", "Jump"],
    ["E", "Use"],
    ["N", "Next track"],
    ["I", "Look closer"],
    ["C", "Records"],
    ["M", "Mute"],
    ["U", "Hide UI"],
    ["L", "Mouse look"],
  ];
  return h(
    "div",
    { class: "help" },
    h("dl", { class: "help-keys" }, ...rows.flatMap(([k, v]) => [h("dt", null, h("kbd", null, k)), h("dd", null, v)])),
    h("p", { class: "help-credit" }, "Tamashi and Nozomi © Studio Mirai"),
  );
}
