import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import { ConnectModal } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { useEffect, useRef } from "react";
import { SUI_FULLNODE } from "../config";
import { createWalletApi } from "./actions";
import { getWalletState, setWalletState, type WalletStatus } from "./store";

// Loaded lazily (see Layout.tsx): the wallet kit and the transaction code stay out of the main bundle.
// Testnet only. The kit finds browser wallets via the Wallet Standard and adds the Slush web wallet.

const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: SUI_FULLNODE }),
  autoConnect: true,
  slushWalletConfig: { appName: "Open Catalog" },
});

const BALANCE_POLL_MS = 15_000;

function mirrorConnection() {
  const connection = dAppKit.stores.$connection.get();
  const status: WalletStatus = connection.isConnected
    ? "connected"
    : connection.isConnecting || connection.isReconnecting
      ? "connecting"
      : "disconnected";
  const address = connection.isConnected ? connection.account.address : null;
  const previous = getWalletState();
  setWalletState({
    status,
    address,
    walletName: connection.isConnected ? connection.wallet.name : null,
    // Balances belong to one address: drop them when the account changes.
    balances: address && address === previous.address ? previous.balances : null,
  });
}

export default function WalletRuntime() {
  const modal = useRef<HTMLElement & { show(): Promise<void> }>(null);

  useEffect(() => {
    const api = createWalletApi(dAppKit, () => void modal.current?.show());
    setWalletState({ api });
    mirrorConnection();
    const unsubscribe = dAppKit.stores.$connection.listen(() => {
      const before = getWalletState().address;
      mirrorConnection();
      const after = getWalletState().address;
      if (after && after !== before) void api.refreshBalances();
    });
    void api.refreshBalances();

    // Balances every 15 s while the tab is visible (and after every transaction, see actions.ts).
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void api.refreshBalances();
    }, BALANCE_POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
      setWalletState({ api: null });
    };
  }, []);

  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <ConnectModal ref={modal as never} />
    </DAppKitProvider>
  );
}
