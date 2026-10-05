/**
 * ATM flow: the FakeUSD ATM in TriMart's vestibule, next door to Saisei Records (the
 * testnet faucet). Flavour (bible §7.4 step 5, the secret-identity beat): its CRT
 * greeting glitches on Gamer's real name before resolving to "ACCOUNT HOLDER: GAMER".
 * The only caller of `adapter.withdrawFakeUsd()`.
 *
 *   E at the ATM → "FakeUSD ATM" → Withdraw 50 FUSD
 *     → dispatch withdrawStart → pending screen
 *     → await adapter.withdrawFakeUsd(ATM_WITHDRAW_AMOUNT)   (resolves after finality)
 *     → re-read the wallet                                   (chain truth: balance)
 *     → dispatch withdrawSuccess → receipt ("Receipt no." + "View receipt ↗" explorer link), cash counts up
 *   or → dispatch withdrawFail → the adapter's friendly message + Retry / Cancel
 *
 * Works whether or not the player holds a record (it only moves money); refused
 * while any other transaction is pending (one at a time, state.ts).
 *
 * Owns: the ATM dialogs, the CRT greeting glitch and the withdraw amount.
 * Must not: decide legality (state.ts does) or know any chain detail beyond the
 * MisoAdapter interface.
 */
import { formatAmount } from "../../miso/format";
import * as sfx from "../../audio/sfx";
import { errorBody, paragraph, pendingBody, receiptLink } from "../../ui/dialogs";
import { h } from "../../ui/dom";
import { message, type FlowContext } from "./context";

/** What one withdrawal dispenses: 50 FUSD (FakeUSD has 6 decimals). */
export const ATM_WITHDRAW_AMOUNT = 50_000_000n;
const FUSD_DECIMALS = 6;
/** "50" (whole dollars: the ATM only dispenses round amounts). */
const AMOUNT_LABEL = formatAmount(ATM_WITHDRAW_AMOUNT, FUSD_DECIMALS, "", 0).trim();

/** The CRT greeting: glitches on the real name, then resolves (flavour only). */
const GREETING_GLITCH = "WELCOME BACK, KA\u2592\u2592\u2592 TAKAHA\u2592\u2592";
const GREETING = "ACCOUNT HOLDER: GAMER";
const GLITCH_MS = 1100;
const TITLE = "ATM";

export class AtmFlow {
  constructor(private readonly ctx: FlowContext) {}

  /** E at the ATM. */
  openAtm(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "withdraw" && s.op.status === "pending") return this.showPending();
    if (s.op?.kind === "withdraw" && s.op.status === "error") return this.showError(s.op.error);
    if (s.op?.status === "pending") {
      ctx.hud.toast("One thing at a time.", { tone: "bad" });
      return;
    }
    const balance = s.balance;
    const plain = (n: bigint) => ctx.money(n).replace(/\s*FUSD$/, "");
    ctx.dialogs.show({
      key: "atm",
      skin: "amber",
      title: TITLE,
      body: [
        crtGreeting(),
        paragraph(balance === null ? "Balance …" : `Balance ${plain(balance)} → ${plain(balance + ATM_WITHDRAW_AMOUNT)}`),
      ],
      actions: [
        { id: "withdraw", kind: "primary", key: "E", label: `Withdraw ${AMOUNT_LABEL}`, run: () => void this.withdraw() },
        { id: "cancel", key: "Esc", label: "Back", run: () => ctx.dialogs.close() },
      ],
    });
  }

  /** Withdraw from the faucet. Safe to call again as Retry after a failure. */
  async withdraw(): Promise<void> {
    const { ctx } = this;
    if (!ctx.dispatch({ type: "withdrawStart" })) return;
    this.showPending();
    try {
      const result = await ctx.adapter.withdrawFakeUsd(ATM_WITHDRAW_AMOUNT);
      // Re-read chain truth for the new balance.
      const wallet = await ctx.refreshWallet(false).catch(() => null);
      const known = ctx.state().balance;
      const balance = wallet?.fakeUsd ?? (known === null ? null : known + result.amount);
      // withdrawSuccess sets the balance → render() → the HUD counter counts up green.
      ctx.dispatch({ type: "withdrawSuccess", digest: result.digest, amount: result.amount, balance });
      sfx.cashRegister();
      if (!this.showDone(result.digest, result.amount)) {
        ctx.hud.toast(`+${ctx.money(result.amount)}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "View receipt ↗" },
          durationMs: 8000,
        });
      }
    } catch (error) {
      ctx.dispatch({ type: "withdrawFail", error: message(error) });
      // The cash may have come out even though the answer didn't: re-read the balance.
      void ctx.refreshWallet().catch(() => {});
      sfx.error();
      if (ctx.dialogs.openKey === "atm") this.showError(message(error));
      else ctx.hud.toast(message(error), { tone: "bad" });
    }
  }

  private showPending(): void {
    this.ctx.dialogs.show({ key: "atm", skin: "amber", tone: "pending", title: "PROCESSING", body: pendingBody() });
  }

  /** Returns false if the ATM screen was closed meanwhile. */
  private showDone(digest: string, amount: bigint): boolean {
    const { ctx } = this;
    if (ctx.dialogs.openKey !== "atm") return false;
    ctx.dialogs.show({
      key: "atm",
      skin: "amber",
      tone: "success",
      titleJp: "済",
      title: "CASH OUT",
      body: [paragraph(`+${ctx.money(amount)}`), receiptLink({ href: ctx.adapter.explorerTxUrl(digest) })],
      actions: [{ id: "done", kind: "primary", key: "E", label: "OK", run: () => ctx.dialogs.close() }],
    });
    return true;
  }

  private showError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "atm",
      skin: "amber",
      tone: "error",
      title: TITLE,
      body: errorBody(error),
      actions: [
        { id: "retry", kind: "primary", key: "E", label: "Retry", run: () => void this.withdraw() },
        { id: "cancel", key: "Esc", label: "Back", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        ctx.dispatch({ type: "dismissError" });
      },
    });
  }
}

/**
 * The ATM's CRT greeting: "WELCOME BACK, KA▒▒▒ TAKAHA▒▒" flickers, then resolves to
 * "ACCOUNT HOLDER: GAMER". Pure flavour; the screen header line of the CRT.
 */
function crtGreeting(): HTMLElement {
  const line = h("span", { class: "atm-crt-line glitch" }, GREETING_GLITCH);
  setTimeout(() => {
    line.textContent = GREETING;
    line.classList.remove("glitch");
  }, GLITCH_MS);
  return h("div", { class: "atm-greeting" }, h("div", { class: "atm-crt", "aria-live": "polite" }, line));
}
