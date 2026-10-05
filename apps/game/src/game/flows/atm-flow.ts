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
import { formatAmount, shortId } from "../../miso/format";
import * as sfx from "../../audio/sfx";
import { errorBody, lineItems, paragraph, pendingBody, receiptBody } from "../../ui/dialogs";
import { h } from "../../ui/dom";
import { message, type FlowContext } from "./context";

/** What one withdrawal dispenses: 50 FUSD (FakeUSD has 6 decimals). */
export const ATM_WITHDRAW_AMOUNT = 50_000_000n;
const FUSD_DECIMALS = 6;
/** "50 FUSD" (whole dollars: the ATM only dispenses round amounts). */
const AMOUNT_LABEL = formatAmount(ATM_WITHDRAW_AMOUNT, FUSD_DECIMALS, "FUSD", 0);

const EYEBROW = "TRIMART VESTIBULE · ATM";
/** The CRT greeting: glitches on the real name, then resolves (flavour only). */
const GREETING_GLITCH = "WELCOME BACK, KA\u2592\u2592\u2592 TAKAHA\u2592\u2592";
const GREETING = "ACCOUNT HOLDER: GAMER";
const GLITCH_MS = 1100;
const TITLE = "FakeUSD ATM";

export class AtmFlow {
  constructor(private readonly ctx: FlowContext) {}

  /** E at the ATM. */
  openAtm(): void {
    const { ctx } = this;
    const s = ctx.state();
    if (s.op?.kind === "withdraw" && s.op.status === "pending") return this.showPending();
    if (s.op?.kind === "withdraw" && s.op.status === "error") return this.showError(s.op.error ?? "Something went wrong.");
    if (s.op?.status === "pending") {
      ctx.hud.toast("One thing at a time. The ATM can wait a moment.", { tone: "bad" });
      return;
    }
    const balance = s.balance;
    ctx.dialogs.show({
      key: "atm",
      eyebrow: EYEBROW,
      title: TITLE,
      body: [
        crtGreeting(),
        paragraph(`Withdraw ${AMOUNT_LABEL} in cash.`),
        lineItems([
          ["Your balance", balance === null ? "…" : ctx.money(balance)],
          ["After withdrawal", balance === null ? "…" : ctx.money(balance + ATM_WITHDRAW_AMOUNT)],
        ]),
        paragraph("FakeUSD is play money: free to withdraw, no real money involved."),
      ],
      actions: [
        { id: "withdraw", kind: "primary", label: `Withdraw ${AMOUNT_LABEL}`, run: () => void this.withdraw() },
        { id: "cancel", label: "Cancel", run: () => ctx.dialogs.close() },
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
      const balance = wallet?.fakeUsd ?? (ctx.state().balance ?? 0n) + result.amount;
      // withdrawSuccess sets the balance → render() → the HUD counter counts up green.
      ctx.dispatch({ type: "withdrawSuccess", digest: result.digest, amount: result.amount, balance });
      sfx.cashRegister();
      if (!this.showReceipt(result.digest, result.amount, balance)) {
        ctx.hud.toast(`Withdrew ${ctx.money(result.amount)}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "View receipt ↗" },
          durationMs: 8000,
        });
      }
    } catch (error) {
      ctx.dispatch({ type: "withdrawFail", error: message(error) });
      sfx.error();
      if (ctx.dialogs.openKey === "atm") this.showError(message(error));
      else ctx.hud.toast(`Withdrawal failed: ${message(error)}`, { tone: "bad" });
    }
  }

  private showPending(): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "atm",
      tone: "pending",
      eyebrow: EYEBROW,
      title: TITLE,
      body: pendingBody("Counting out your FakeUSD", `${AMOUNT_LABEL} coming right up. You can close this; the ATM keeps working.`),
      actions: [{ id: "hide", label: "Close (keeps processing)", run: () => ctx.dialogs.close() }],
    });
  }

  /** Returns false if the ATM screen was closed meanwhile. */
  private showReceipt(digest: string, amount: bigint, balance: bigint): boolean {
    const { ctx } = this;
    if (ctx.dialogs.openKey !== "atm") return false;
    ctx.dialogs.show({
      key: "atm",
      tone: "success",
      eyebrow: "CASH OUT · RECEIPT",
      title: TITLE,
      body: receiptBody(
        `${ctx.money(amount)} in your pocket.`,
        [
          { label: "Withdrew", value: ctx.money(amount) },
          { label: "Balance", value: ctx.money(balance) },
          { label: "Receipt no.", value: shortId(digest), href: ctx.adapter.explorerTxUrl(digest), linkLabel: "View receipt ↗", linkId: "tx" },
        ],
        ctx.adapter.network === "mock" ? "Offline demo: the receipt link is just for show." : undefined,
      ),
      actions: [{ id: "done", kind: "primary", label: "Back to the street", run: () => ctx.dialogs.close() }],
    });
    return true;
  }

  private showError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "atm",
      tone: "error",
      eyebrow: "ATM ERROR",
      title: TITLE,
      body: errorBody(error, "Nothing was withdrawn. Give it another go."),
      actions: [
        { id: "retry", kind: "primary", label: "Retry", run: () => void this.withdraw() },
        { id: "cancel", label: "Cancel", run: () => ctx.dialogs.close() },
      ],
      onClose: () => {
        ctx.dispatch({ type: "dismissError" });
      },
    });
  }
}

/**
 * The ATM's CRT greeting: "WELCOME BACK, KA▒▒▒ TAKAHA▒▒" flickers, then resolves to
 * "ACCOUNT HOLDER: GAMER" and Gamer angles the screen away. Pure flavour.
 */
function crtGreeting(): HTMLElement {
  const line = h("span", { class: "atm-crt-line glitch" }, GREETING_GLITCH);
  const aside = h("em", { class: "atm-crt-aside", hidden: true }, "(You angle the screen away.)");
  setTimeout(() => {
    line.textContent = GREETING;
    line.classList.remove("glitch");
    aside.hidden = false;
  }, GLITCH_MS);
  return h("div", { class: "atm-greeting" }, h("div", { class: "atm-crt", "aria-live": "polite" }, line), aside);
}
