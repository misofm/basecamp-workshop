import { useEffect, useRef, useState } from "react";
import { formatFakeUsd, shortAddress, useWallet } from "../wallet/store";
import { CopyAddressButton } from "./CopyAddressButton";

/** Header wallet widget: "Connect wallet", or the connected address + FakeUSD balance with a small menu. */
export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close the menu on Escape or a click outside it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (wallet.status !== "connected") setOpen(false);
  }, [wallet.status]);

  if (wallet.status !== "connected" || !wallet.address) {
    const busy = wallet.status === "connecting";
    return (
      <button
        className="button wallet-connect"
        onClick={() => wallet.api?.openConnect()}
        disabled={!wallet.api || wallet.status === "loading" || busy}
      >
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const address = wallet.address;
  return (
    <div className="wallet-widget" ref={root}>
      <button
        className="wallet-pill"
        aria-expanded={open}
        aria-controls="wallet-menu"
        aria-label={`Wallet ${address}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="wallet-dot" aria-hidden="true" />
        <span className="wallet-address">{shortAddress(address)}</span>
        <span className="wallet-balance">
          {wallet.balances ? `${formatFakeUsd(wallet.balances.fakeUsd)} FakeUSD` : "…"}
        </span>
      </button>
      {open && (
        <div className="wallet-menu" id="wallet-menu">
          <div className="wallet-menu-head">
            <span className="muted small">{wallet.walletName ?? "Wallet"} · testnet</span>
            <code className="wallet-full-address">{address}</code>
          </div>
          <CopyAddressButton address={address} />
          <button
            className="button-secondary"
            onClick={() => {
              setOpen(false);
              void wallet.api?.disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
