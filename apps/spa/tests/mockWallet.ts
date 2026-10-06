import type { Page } from "@playwright/test";

// A tiny mock Wallet Standard wallet for the tests. It connects with a fixed (real, read-only) testnet
// address and REJECTS every signing request, so a test can never sign or execute anything.
//
// It doubles as documentation of what dApp Kit needs from a browser wallet:
//   - register through the Wallet Standard events (`wallet-standard:register-wallet` and
//     `wallet-standard:app-ready`), with a name, a data: URI icon and chains including "sui:testnet";
//   - features `standard:connect`, `standard:events` and `sui:signTransaction` (or `...Block`) to be listed;
//   - `standard:connect({ silent: true })` returning the already authorized accounts, for autoConnect
//     after a reload;
//   - on the account: the address, a public key, its chains and the features it can sign with
//     (the kit looks up `sui:signAndExecuteTransaction` on the account, not only on the wallet).
// A wallet rejection is just a thrown Error; the app recognizes it by its text (/reject|denied|declin|cancel/i).

export type MockWalletOptions = {
  address: string;
  name?: string;
  signBehavior: "reject";
};

export const MOCK_WALLET_NAME = "Mock Wallet";

export async function installMockWallet(page: Page, { address, name = MOCK_WALLET_NAME }: MockWalletOptions) {
  await page.addInitScript(
    ({ address, name }) => {
      const w = window as unknown as Record<string, unknown> & Window;
      w.__mockWalletSignCalls = 0;
      const icon =
        "data:image/svg+xml;base64," +
        btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#6d28d9"/></svg>');
      const chains = ["sui:testnet"] as const;
      const account = {
        address,
        publicKey: new Uint8Array(32),
        chains,
        features: ["sui:signTransaction", "sui:signAndExecuteTransaction", "sui:signPersonalMessage"],
      };
      // "Authorized" survives a reload (like a real wallet remembering the site), so silent connect works.
      const AUTH_KEY = "__mockWalletAuthorized";
      let accounts: (typeof account)[] = [];
      const listeners = new Set<(change: { accounts: (typeof account)[] }) => void>();
      const emit = () => listeners.forEach((listener) => listener({ accounts }));

      // Every signing feature counts the call, then rejects as a user would.
      const reject = async () => {
        w.__mockWalletSignCalls = (w.__mockWalletSignCalls as number) + 1;
        throw new Error("User rejected the request");
      };

      const wallet = {
        version: "1.0.0",
        name,
        icon,
        chains,
        get accounts() {
          return accounts;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async ({ silent }: { silent?: boolean } = {}) => {
              if (silent && localStorage.getItem(AUTH_KEY) !== "1") return { accounts: [] };
              localStorage.setItem(AUTH_KEY, "1");
              accounts = [account];
              emit();
              return { accounts };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              localStorage.removeItem(AUTH_KEY);
              accounts = [];
              emit();
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event: "change", listener: (change: { accounts: (typeof account)[] }) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "sui:signTransaction": { version: "2.0.0", signTransaction: reject },
          "sui:signAndExecuteTransaction": { version: "2.0.0", signAndExecuteTransaction: reject },
          "sui:signPersonalMessage": { version: "1.1.0", signPersonalMessage: reject },
        },
      };

      // Register now (if the app is already listening) and whenever the app announces it is ready.
      const register = ({ register }: { register: (wallet: unknown) => void }) => register(wallet);
      try {
        window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
      } catch {
        /* no listener yet */
      }
      window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
    },
    { address, name },
  );
}

/** How many times the app asked the mock wallet to sign anything. */
export function mockWalletSignCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __mockWalletSignCalls: number }).__mockWalletSignCalls);
}
