import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { observeMediaRequests } from "./lib/requestLog";
import { ArtistPage } from "./pages/ArtistPage";
import { CollectionPage } from "./pages/CollectionPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ReleasePage } from "./pages/ReleasePage";
import { PlayerProvider } from "./player/PlayerProvider";
import "./styles.css";

// Only useful with a wallet, so it loads with the wallet code, not with the catalog.
const FaucetPage = lazy(() => import("./pages/FaucetPage").then((m) => ({ default: m.FaucetPage })));

observeMediaRequests();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PlayerProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="release/:id" element={<ReleasePage />} />
            <Route path="artist/:id" element={<ArtistPage />} />
            <Route path="collection" element={<CollectionPage />} />
            <Route
              path="faucet"
              element={
                <Suspense fallback={null}>
                  <FaucetPage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </PlayerProvider>
    </BrowserRouter>
  </StrictMode>,
);
