import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { PlayerBar } from "../player/PlayerBar";
import { HowItWorks } from "./HowItWorks";

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
            <button className="button-secondary" onClick={() => setDrawerOpen(true)}>
              How this works
            </button>
          </nav>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <PlayerBar />
      {drawerOpen && <HowItWorks onClose={() => setDrawerOpen(false)} />}
    </>
  );
}
