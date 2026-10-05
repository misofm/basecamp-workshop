/**
 * Accessible modal menus (one native <dialog>), plus view builders for each screen.
 *
 * Owns: the dialog element, its keyboard handling (↑↓ / W S select, Enter / E /
 * Space confirm, Esc close), focus management, and the DOM for every screen:
 * record sleeve, deck, purchase (summary / pending / receipt / error), sell offer,
 * ATM withdrawal, collection and help.
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
  /** Small right-aligned hint, e.g. a price or "[N]". */
  detail?: string;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  run: () => void;
}

export interface DialogSpec {
  /** Which screen this is ("record", "deck", "purchase", "sell", "collection", "help"…). */
  key: string;
  tone?: "default" | "pending" | "success" | "error";
  eyebrow: string;
  title: string;
  body?: Node | (Node | null)[];
  actions?: DialogAction[];
  wide?: boolean;
  /** false = Esc / × do nothing (rare; pending screens stay closable). */
  closable?: boolean;
  onClose?: () => void;
}

const NAV_KEYS = ["ArrowUp", "ArrowDown", "KeyW", "KeyS", "Enter", "NumpadEnter", "KeyE", "Space", "Escape"];

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
    const closeButton = h("button", { class: "dlg-close", type: "button", "aria-label": "Close (Esc)" }, "×");
    closeButton.addEventListener("click", () => this.requestClose());
    this.el = h("dialog", { class: "dlg", "aria-labelledby": "dlg-title" }, closeButton, this.content);
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
    this.spec = spec;
    this.el.className = `dlg tone-${spec.tone ?? "default"}${spec.wide ? " dlg-wide" : ""}`;
    const actions = (spec.actions ?? []).map((a) => {
      const button = h(
        "button",
        { class: `dlg-action dlg-nav ${a.kind ?? "secondary"}`, type: "button", "data-action-id": a.id, disabled: a.disabled ?? false },
        h("span", { class: "dlg-action-label" }, a.label),
        a.detail ? h("span", { class: "dlg-action-detail" }, a.detail) : null,
      );
      button.addEventListener("click", () => {
        if (!button.disabled) a.run();
      });
      return button;
    });
    const body = spec.body === undefined ? [] : Array.isArray(spec.body) ? spec.body : [spec.body];
    const nodes: (Node | null)[] = [
      h("div", { class: "dlg-eyebrow" }, spec.eyebrow),
      h("h2", { id: "dlg-title", class: "dlg-title" }, spec.title),
      ...body.filter((n): n is Node => n !== null),
      actions.length ? h("div", { class: "dlg-actions" }, ...actions) : null,
      actions.length ? h("div", { class: "dlg-keys" }, "↑↓ select · Enter confirm · Esc close") : null,
    ];
    this.content.replaceChildren(...nodes.filter((n): n is Node => n !== null));
    if (!wasOpen) {
      this.el.showModal();
      this.onOpenChange(true);
    }
    const nav = this.navTargets();
    const keep = previousFocus ? nav.find((b) => b.dataset.actionId === previousFocus) : undefined;
    (keep ?? actions.find((b) => !b.disabled) ?? nav[0] ?? this.el)?.focus({ preventScroll: true });
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
    if (!this.el.open || !NAV_KEYS.includes(e.code)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
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

export interface RecordView {
  title: string;
  artist: string;
  genre: string;
  year: number;
  label: string;
  description: string;
  coverUrl: string;
  palette: string[];
  priceText: string;
  edition: string;
  minted: number;
  maxSupply: number;
  /** Optional status chip: "IN YOUR HANDS · UNPAID", "OWNED · #106/250". */
  status?: string;
}

/** Big sleeve + liner notes + price + edition bar. */
export function recordBody(r: RecordView): HTMLElement {
  const pct = r.maxSupply > 0 ? Math.min(100, (r.minted / r.maxSupply) * 100) : 0;
  const accent = r.palette[1] ?? "#d5b776";
  return h(
    "div",
    { class: "rec", style: `--accent:${accent}` },
    h(
      "div",
      { class: "rec-sleeve" },
      h("img", { class: "rec-cover", src: r.coverUrl, alt: `${r.title} sleeve artwork`, onerror: coverFallback }),
      h("div", { class: "rec-vinyl", "aria-hidden": "true" }),
    ),
    h(
      "div",
      { class: "rec-info" },
      r.status ? h("div", { class: "rec-status" }, r.status) : null,
      h("p", { class: "rec-artist" }, r.artist),
      h("div", { class: "rec-tags" }, h("span", null, r.genre), h("span", null, String(r.year)), h("span", null, r.label)),
      h("p", { class: "rec-desc" }, r.description),
      h(
        "div",
        { class: "rec-buy" },
        h("div", { class: "rec-price" }, r.priceText),
        h(
          "div",
          { class: "rec-edition" },
          h("div", { class: "rec-edition-row" }, h("span", null, r.edition), h("b", null, `${r.minted} / ${r.maxSupply} minted`)),
          h("div", { class: "rec-bar" }, h("i", { style: `width:${pct.toFixed(1)}%` })),
        ),
      ),
    ),
  );
}

/** Small cover + title row used by purchase/sell/deck screens. */
export function recordStrip(coverUrl: string, title: string, artist: string, right?: string, note?: string): HTMLElement {
  return h(
    "div",
    { class: "strip" },
    h("img", { src: coverUrl, alt: "", onerror: coverFallback }),
    h("div", { class: "strip-text" }, h("strong", null, title), h("span", null, artist), note ? h("small", null, note) : null),
    right ? h("div", { class: "strip-right" }, right) : null,
  );
}

export function lineItems(rows: [string, string][]): HTMLElement {
  return h("dl", { class: "lines" }, ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
}

/** Animated "processing" block. */
export function pendingBody(text: string, sub: string): HTMLElement {
  return h(
    "div",
    { class: "pending" },
    h("div", { class: "pending-disc", "aria-hidden": "true" }),
    h("p", { class: "pending-text" }, text, h("span", { class: "dots", "aria-hidden": "true" }, h("i", null, "."), h("i", null, "."), h("i", null, "."))),
    h("p", { class: "pending-sub" }, sub),
  );
}

export function errorBody(message: string, reassurance: string): HTMLElement {
  return h("div", { class: "err" }, h("div", { class: "err-icon", "aria-hidden": "true" }, "!"), h("p", { class: "err-msg" }, message), h("p", { class: "err-sub" }, reassurance));
}

export interface ReceiptRow {
  label: string;
  value: string;
  /** Full value copied by the copy button. */
  copy?: string;
  href?: string;
  linkLabel?: string;
}

/** Receipt with copy buttons and explorer links (open in a new tab). */
export function receiptBody(headline: string, rows: ReceiptRow[], footnote?: string): HTMLElement {
  return h(
    "div",
    { class: "receipt" },
    h("div", { class: "receipt-check", "aria-hidden": "true" }, "✓"),
    h("p", { class: "receipt-headline" }, headline),
    h(
      "div",
      { class: "receipt-rows" },
      ...rows.map((row) => {
        const copy = row.copy ? h("button", { class: "mini dlg-nav", type: "button", "aria-label": `Copy ${row.label}` }, "Copy") : null;
        if (copy && row.copy) {
          const value = row.copy;
          copy.addEventListener("click", () => {
            void copyText(value).then((ok) => (copy.textContent = ok ? "Copied ✓" : "Copy failed"));
          });
        }
        return h(
          "div",
          { class: "receipt-row" },
          h("span", { class: "receipt-label" }, row.label),
          h("code", { class: `receipt-value${row.copy ? " mono" : ""}`, title: row.copy ?? row.value }, row.value),
          copy,
          row.href
            ? h("a", { class: "mini link dlg-nav", href: row.href, target: "_blank", rel: "noopener noreferrer", "data-receipt-link": row.label }, row.linkLabel ?? "Explorer ↗")
            : null,
        );
      }),
    ),
    footnote ? h("p", { class: "receipt-foot" }, footnote) : null,
  );
}

export function paragraph(text: string, className = "dlg-p"): HTMLElement {
  return h("p", { class: className }, text);
}

export interface CollectionItem {
  recordId: string;
  shortRecordId: string;
  title: string;
  artist: string;
  coverUrl: string;
  serialText: string;
  explorerUrl: string;
  /** Button label ("Hold", "Put away", "In hand"…); null = no button. */
  actionLabel: string | null;
  actionDisabled?: boolean;
  onAction?: () => void;
}

export interface SoldItem {
  title: string;
  paidText: string;
  shortRecordId: string;
}

export function collectionBody(
  state: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: CollectionItem[]; sold: SoldItem[] },
): HTMLElement {
  if (state.kind === "loading") {
    return h("div", { class: "coll coll-loading", "aria-busy": "true" }, ...[0, 1, 2].map(() => h("div", { class: "coll-item skeleton" }, h("div", { class: "sk-cover" }), h("div", { class: "sk-lines" }, h("i"), h("i")))), h("p", { class: "dlg-p" }, "Reading your wallet…"));
  }
  if (state.kind === "error") return errorBody(state.message, "Your records are safe on chain. Try again in a moment.");
  const items = state.items.map((item) => {
    const button = item.actionLabel
      ? h("button", { class: "mini dlg-nav coll-hold", type: "button", disabled: item.actionDisabled ?? false }, item.actionLabel)
      : null;
    if (button && item.onAction) button.addEventListener("click", item.onAction);
    return h(
      "div",
      { class: "coll-item", "data-record-id": item.recordId },
      h("img", { src: item.coverUrl, alt: "", onerror: coverFallback }),
      h(
        "div",
        { class: "coll-text" },
        h("strong", null, item.title),
        h("span", null, item.artist),
        h("small", null, `${item.serialText} · `, h("a", { class: "dlg-nav", href: item.explorerUrl, target: "_blank", rel: "noopener noreferrer" }, `${item.shortRecordId} ↗`)),
      ),
      button,
    );
  });
  return h(
    "div",
    { class: "coll" },
    items.length ? h("div", { class: "coll-list" }, ...items) : paragraph(state.sold.length ? "Nothing in your wallet right now. The shop restocks every release." : "No Records yet. Buy one at the counter in the shop."),
    state.sold.length
      ? h(
          "div",
          { class: "coll-sold" },
          h("div", { class: "coll-sold-title" }, "SOLD"),
          ...state.sold.map((s) => h("div", { class: "coll-sold-row" }, h("span", null, s.title), h("code", null, s.shortRecordId), h("b", null, s.paidText))),
        )
      : null,
  );
}

export function helpBody(): HTMLElement {
  const rows: [string, string][] = [
    ["W A S D", "Walk (arrow keys too)"],
    ["Shift", "Sprint"],
    ["E / Enter", "Interact with what's in front of you"],
    ["N", "Next track on the deck"],
    ["I", "Inspect the record in your hands"],
    ["C", "Your collection (read from the chain)"],
    ["M", "Mute / unmute"],
    ["L or drag", "Mouse look · + − zoom · Home reset camera"],
    ["↑↓ Enter Esc", "Menus: select, confirm, close"],
  ];
  return h(
    "div",
    { class: "help" },
    h("ol", { class: "help-loop" }, ...["Pick a record from the crates", "Spin it on the listening deck", "Buy it at the counter (on Sui)", "Smash a parked car with it", "Sell it to the collector"].map((t) => h("li", null, t))),
    h("p", { class: "dlg-p" }, "Short on FakeUSD? The ATM outside the shop dispenses testnet dollars."),
    h("dl", { class: "help-keys" }, ...rows.flatMap(([k, v]) => [h("dt", null, h("kbd", null, k)), h("dd", null, v)])),
  );
}
