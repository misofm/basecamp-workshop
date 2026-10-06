import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Listing, Pressing } from "../lib/types";
import { formatFakeUsd, useWallet, type BuyOutcome, type TxStep } from "../wallet/store";
import { GasNote } from "./GasNote";

// The Buy button under the pressings. Lazily loaded by RecordBox: it only does anything once the wallet
// chunk has loaded, so it stays out of the main bundle too.

export type Row = { pressing: Pressing; listing: Listing | null };

const STEP_LABELS: Record<TxStep, string> = {
  checking: "Checking…",
  confirm: "Confirm in your wallet…",
  finishing: "Finishing…",
};

/** "Next available edition" = the first pressing that isn't sold out and has an enabled FakeUSD listing. */
export default function BuyPanel({
  releaseId,
  rows,
  onRefresh,
}: {
  releaseId: string;
  rows: Row[];
  onRefresh: (until?: { edition: number; minSupply: number }) => Promise<void>;
}) {
  const wallet = useWallet();
  const [step, setStep] = useState<TxStep | null>(null);
  const [outcome, setOutcome] = useState<BuyOutcome | null>(null);

  // A new release, or another account, starts from a clean slate.
  useEffect(() => {
    setOutcome(null);
    setStep(null);
  }, [releaseId, wallet.address]);

  const listed = rows.filter((row) => row.listing);
  if (listed.length === 0) return null; // nothing for sale: no button at all

  const next = rows.find(
    (row) => row.pressing.supply < row.pressing.maxSupply && row.listing?.state === "enabled",
  );
  const success = outcome?.status === "success" ? outcome : null;

  const soldOut = listed.every((row) => row.pressing.supply >= row.pressing.maxSupply);
  if (!next && !success) {
    return (
      <div className="buy-panel">
        <button className="button" disabled>
          {soldOut ? "Sold out" : "Listing paused"}
        </button>
      </div>
    );
  }

  const price = next ? BigInt(next.listing!.pricing.amount) : null;
  const busy = step !== null;
  const connected = wallet.status === "connected" && wallet.address;
  const short = connected && price !== null && wallet.balances && wallet.balances.fakeUsd < price;

  async function buy() {
    if (!next || !wallet.api) return;
    setOutcome(null);
    const supplyBefore = next.pressing.supply;
    const result = await wallet.api.buyRecord({ releaseId, edition: next.pressing.edition, onStep: setStep });
    setStep(null);
    setOutcome(result);
    if (result.status === "success") {
      void onRefresh({ edition: result.edition, minSupply: supplyBefore + 1 });
    } else if (result.status === "unavailable" || (result.status === "failed" && result.failure.kind !== "rejected")) {
      void onRefresh();
    }
  }

  let button;
  if (!next) {
    button = (
      <button className="button" disabled>
        {soldOut ? "Sold out" : "Listing paused"}
      </button>
    );
  } else if (!wallet.api || wallet.status === "loading") {
    button = (
      <button className="button" disabled>
        Buy
      </button>
    );
  } else if (!connected) {
    button = (
      <button className="button" onClick={() => wallet.api?.openConnect()} disabled={wallet.status === "connecting"}>
        Connect wallet to buy
      </button>
    );
  } else if (price !== null) {
    button = (
      <button className="button" onClick={buy} disabled={busy || Boolean(short)}>
        {step ? STEP_LABELS[step] : `Buy for ${formatFakeUsd(price)} FakeUSD`}
      </button>
    );
  }

  return (
    <div className="buy-panel" aria-live="polite">
      {button && (
        <div className="buy-row">
          {button}
          {next && !busy && <span className="muted small">Edition {next.pressing.edition}, next copy</span>}
        </div>
      )}
      {short && !busy && wallet.balances && price !== null && (
        <p className="buy-note">
          You need {formatFakeUsd(price)} FakeUSD; you have {formatFakeUsd(wallet.balances.fakeUsd)}.{" "}
          <Link to="/faucet">Get FakeUSD</Link>
        </p>
      )}
      {outcome && !busy && <OutcomeMessage outcome={outcome} address={wallet.address} onRetry={buy} />}
    </div>
  );
}

function OutcomeMessage({
  outcome,
  address,
  onRetry,
}: {
  outcome: BuyOutcome;
  address: string | null;
  onRetry: () => void;
}) {
  switch (outcome.status) {
    case "success":
      return (
        <div className="buy-note buy-success">
          <p>
            <strong>
              {outcome.recordNumber !== null
                ? `You own Record #${outcome.recordNumber} of Edition ${outcome.edition}.`
                : `You own a record from Edition ${outcome.edition}.`}
            </strong>
          </p>
          <p className="buy-links">
            <a href={outcome.explorerUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
            <Link to="/collection">See your collection</Link>
          </p>
        </div>
      );
    case "needFakeUsd":
      return (
        <p className="buy-note">
          You need {formatFakeUsd(outcome.need)} FakeUSD; you have {formatFakeUsd(outcome.have)}.{" "}
          <Link to="/faucet">Get FakeUSD</Link>
        </p>
      );
    case "needGas":
      return <GasNote needMist={outcome.needMist} address={address} />;
    case "unavailable":
      return (
        <p className="buy-note">
          {outcome.reason === "soldOut"
            ? "That edition just sold out."
            : outcome.reason === "paused"
              ? "That listing was just paused."
              : "That edition isn't for sale here."}
        </p>
      );
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
  }
}
