/**
 * ATM flow: the FakeUSD ATM on the sidewalk outside the shop (the testnet faucet).
 * The only caller of `adapter.withdrawFakeUsd()`.
 *
 *   E at the ATM → "FakeUSD ATM" → Withdraw 50 FUSD
 *     → dispatch withdrawStart → pending screen
 *     → await adapter.withdrawFakeUsd(ATM_WITHDRAW_AMOUNT)   (resolves after finality)
 *     → re-read the wallet                                   (chain truth: balance)
 *     → dispatch withdrawSuccess → receipt (tx digest + explorer link), cash counts up
 *   or → dispatch withdrawFail → the adapter's friendly message + Retry / Cancel
 *
 * Works whether or not the player holds a record (it only moves money); refused
 * while any other transaction is pending (one at a time, state.ts).
 *
 * Owns: the ATM dialogs and the withdraw amount.
 * Must not: decide legality (state.ts does) or know any chain detail beyond the
 * MisoAdapter interface.
 */
import { formatAmount, shortId } from "../../miso/format";
import * as sfx from "../../audio/sfx";
import { errorBody, lineItems, paragraph, pendingBody, receiptBody } from "../../ui/dialogs";
import { message, type FlowContext } from "./context";

/** What one withdrawal dispenses: 50 FUSD (FakeUSD has 6 decimals). */
export const ATM_WITHDRAW_AMOUNT = 50_000_000n;
const FUSD_DECIMALS = 6;
/** "50 FUSD" (whole dollars: the ATM only dispenses round amounts). */
const AMOUNT_LABEL = formatAmount(ATM_WITHDRAW_AMOUNT, FUSD_DECIMALS, "FUSD", 0);

const EYEBROW = "STREET ATM · FAKEUSD";
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
      ctx.hud.toast("One transaction at a time. The ATM can wait a moment.", { tone: "bad" });
      return;
    }
    const balance = s.balance;
    ctx.dialogs.show({
      key: "atm",
      eyebrow: EYEBROW,
      title: TITLE,
      body: [
        paragraph(`Withdraw ${AMOUNT_LABEL} from ${this.faucetName()}`),
        lineItems([
          ["Your balance", balance === null ? "…" : ctx.money(balance)],
          ["After withdrawal", balance === null ? "…" : ctx.money(balance + ATM_WITHDRAW_AMOUNT)],
        ]),
        paragraph(`Testnet dollars, free to mint: no real money involved. Paid out on ${ctx.networkName()}.`),
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
        ctx.hud.toast(`Withdrew ${ctx.money(result.amount)} · tx ${shortId(result.digest, 6, 6)}`, {
          tone: "good",
          link: { href: ctx.adapter.explorerTxUrl(result.digest), label: "Receipt ↗" },
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

  private faucetName(): string {
    return this.ctx.adapter.network === "mock" ? "the mock faucet" : "the testnet faucet";
  }

  private showPending(): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "atm",
      tone: "pending",
      eyebrow: EYEBROW,
      title: TITLE,
      body: pendingBody("Counting out your FakeUSD", `Minting ${AMOUNT_LABEL} from ${this.faucetName()} on ${ctx.networkName()}. You can close this; the ATM keeps working.`),
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
        `${ctx.money(amount)} in your wallet.`,
        [
          { label: "Tx", value: shortId(digest, 6, 6), copy: digest, href: ctx.adapter.explorerTxUrl(digest), linkLabel: "Tx ↗" },
          { label: "Withdrew", value: ctx.money(amount) },
          { label: "Balance", value: ctx.money(balance) },
        ],
        ctx.adapter.network === "mock" ? "Mock chain: the digest is fake, the explorer link won't resolve." : undefined,
      ),
      actions: [{ id: "done", kind: "primary", label: "Back to the shop", run: () => ctx.dialogs.close() }],
    });
    return true;
  }

  private showError(error: string): void {
    const { ctx } = this;
    ctx.dialogs.show({
      key: "atm",
      tone: "error",
      eyebrow: "TRANSACTION FAILED",
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
