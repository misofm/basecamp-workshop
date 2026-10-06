import { useEffect, useState } from "react";
import { CopyAddressButton } from "../components/CopyAddressButton";
import { GasNote } from "../components/GasNote";
import { FAUCET_AMOUNT, SUI_WEB_FAUCET } from "../config";
import { formatFakeUsd, shortAddress, useWallet, type MintOutcome, type TxStep } from "../wallet/store";

const STEP_LABELS: Record<TxStep, string> = {
  checking: "Checking…",
  confirm: "Confirm in your wallet…",
  finishing: "Finishing…",
};

export function FaucetPage() {
  const wallet = useWallet();
  const [step, setStep] = useState<TxStep | null>(null);
  const [outcome, setOutcome] = useState<MintOutcome | null>(null);
  const amount = formatFakeUsd(FAUCET_AMOUNT).replace(/\.00$/, "");
  const connected = wallet.status === "connected" && wallet.address;

  useEffect(() => {
    setOutcome(null);
    setStep(null);
  }, [wallet.address]);

  async function mint() {
    if (!wallet.api) return;
    setOutcome(null);
    const result = await wallet.api.mintFakeUsd({ onStep: setStep });
    setStep(null);
    setOutcome(result);
  }

  return (
    <>
      <section className="page-intro">
        <h1>Faucet</h1>
        <p className="lead">
          FakeUSD is a testnet-only dollar. It has no value; you use it to buy records here. Get {amount} FakeUSD
          whenever you need more.
        </p>
      </section>

      <section className="record-box faucet-box" aria-live="polite">
        {!connected ? (
          <>
            <p>Connect a wallet to receive FakeUSD.</p>
            <button
              className="button"
              onClick={() => wallet.api?.openConnect()}
              disabled={!wallet.api || wallet.status !== "disconnected"}
            >
              {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              Wallet {shortAddress(wallet.address!)}
              {wallet.balances && ` · ${formatFakeUsd(wallet.balances.fakeUsd)} FakeUSD`}
            </p>
            <button className="button" onClick={mint} disabled={step !== null}>
              {step ? STEP_LABELS[step] : `Get ${amount} FakeUSD`}
            </button>
            {outcome && step === null && <MintMessage outcome={outcome} onRetry={mint} />}
          </>
        )}
      </section>

      <section className="faucet-gas">
        <h2>Need testnet SUI for gas?</h2>
        <p>
          Every transaction costs a little SUI for gas. Get it from the{" "}
          <a href={SUI_WEB_FAUCET} target="_blank" rel="noreferrer">
            Sui faucet
          </a>
          . It can't be prefilled: paste your address.
        </p>
        {connected && <CopyAddressButton address={wallet.address!} />}
      </section>
    </>
  );
}

function MintMessage({ outcome, onRetry }: { outcome: MintOutcome; onRetry: () => void }) {
  switch (outcome.status) {
    case "success":
      return (
        <div className="buy-note buy-success">
          <p>
            <strong>
              {outcome.fakeUsd !== null
                ? `Done. You now have ${formatFakeUsd(outcome.fakeUsd)} FakeUSD.`
                : `Done. ${formatFakeUsd(outcome.amount)} FakeUSD is on its way.`}
            </strong>
          </p>
          <p className="buy-links">
            <a href={outcome.explorerUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </p>
        </div>
      );
    case "needGas":
      // No copy button here: the "Need testnet SUI" section right below has one.
      return <GasNote needMist={outcome.needMist} address={null} />;
    case "failed":
      if (outcome.failure.kind === "rejected") return <p className="buy-note muted">You cancelled in your wallet.</p>;
      return (
        <div className="buy-note buy-error" role="alert">
          <p>{outcome.failure.message}</p>
          <button className="button-secondary" onClick={onRetry}>
            Try again
          </button>
        </div>
      );
    default:
      return null; // needFakeUsd / unavailable never happen for a mint
  }
}
