import { lazy, Suspense, useState, type ComponentType } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { PlayerBar } from "../player/PlayerBar";
import { HowItWorks } from "./HowItWorks";
import { WalletButton } from "./WalletButton";

// The wallet kit is a separate chunk, loaded after the page: reading the catalog never waits for it.
// If it fails to load, the app stays read-only (the wallet buttons stay disabled).
const WalletRuntime = lazy(
  (): Promise<{ default: ComponentType }> =>
    import("../wallet/WalletRuntime").catch((error) => {
      console.error("Wallet failed to load", error);
      return { default: () => null };
    }),
);

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <span className="brand-name">Open Catalog</span>
            <span className="brand-tagline">Miso on Sui testnet · no signup, no API key</span>
          </Link>
          <nav className="nav">
            <NavLink to="/" end>
              Catalog
            </NavLink>
            <NavLink to="/collection">Collection</NavLink>
            <NavLink to="/faucet">Faucet</NavLink>
            <button className="button-secondary" onClick={() => setDrawerOpen(true)}>
              How this works
            </button>
          </nav>
          <WalletButton />
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <PlayerBar />
      {drawerOpen && <HowItWorks onClose={() => setDrawerOpen(false)} />}
      <Suspense fallback={null}>
        <WalletRuntime />
      </Suspense>
    </>
  );
}
