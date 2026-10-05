/**
 * TestnetAdapter against live Sui TESTNET + the Miso API (network required).
 *
 * Always runs (spends no gas):
 *  - mock mode never downloads the Sui SDK chunk (`assets/backend-*.js`);
 *  - `?chain=testnet` loads the real catalog from shop.testnet.json (titles from chain,
 *    cdn.miso.fm covers, tracks with quilt ids + durations), creates a burner wallet with
 *    0 balances while /api is unreachable (auto-fund fails gracefully), gRPC reads work
 *    from the browser origin (CORS), the purchase PTB resolves for a funded sender
 *    (build + simulate, unsigned) and fails for the empty burner with the friendly
 *    "Not enough FakeUSD" message.
 *
 * Opt-in full loop (spends testnet gas and FakeUSD; needs `npm run server` with a funded
 * operator, proxied at /api by `vite preview`):
 *   MISO_TESTNET_E2E=1 MISO_BURNER_KEY_FILE=/path/to/burner.key npx playwright test tests/e2e/testnet.spec.ts
 * MISO_BURNER_KEY_FILE holds one `suiprivkey1…` line (TESTNET ONLY) and is seeded into
 * localStorage so repeated runs reuse one burner. Screenshots go to $SHOTS_DIR.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { chooseAction, goTo, startGame, state, teleport, until } from "./helpers";

const SHOTS =
  process.env.SHOTS_DIR ??
  new URL("../../test-results/shots-testnet", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120_000, animations: "disabled" });

/** The shop as shipped (public/shop.testnet.json), so the test follows whatever is on the shelves. */
const SHOP: { releaseId: string; section: string }[] = JSON.parse(readFileSync(new URL("../../public/shop.testnet.json", import.meta.url), "utf8"));
const RELEASES = SHOP.map((s) => s.releaseId);
/** Title of the first shelf entry, read from the keyless Miso API. */
const firstTitle = async (): Promise<string> =>
  (await (await fetch(`https://api.testnet.miso.fm/v1/protocol/releases/${RELEASES[0]}`)).json()).title;
/** A testnet wallet that has bought records before (holds FakeUSD + SUI as address balance). */
const FUNDED_SENDER = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";
const FULL_LOOP = process.env.MISO_TESTNET_E2E === "1";
const BURNER_KEY_SLOT = "miso-game:burner:testnet";

function watchConsole(page: Page): { errors: string[]; warnings: string[] } {
  const out = { errors: [] as string[], warnings: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error") out.errors.push(`${m.text()} @ ${m.location().url}`);
    if (m.type() === "warning") out.warnings.push(m.text());
  });
  page.on("pageerror", (e) => out.errors.push(`pageerror: ${e.message}`));
  return out;
}

/** Seed (or clear) the TESTNET burner before any page script runs. */
async function seedBurner(page: Page): Promise<boolean> {
  const file = process.env.MISO_BURNER_KEY_FILE;
  if (!file) return false;
  const key = readFileSync(file, "utf8").trim(); // never logged
  await page.addInitScript(([slot, k]) => localStorage.setItem(slot, k), [BURNER_KEY_SLOT, key] as const);
  return true;
}

test("mock mode does not load the Sui SDK chunk", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto("/?chain=mock&latency=0");
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === "true", null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  expect(urls.filter((u) => /\/assets\/backend-[^/]*\.js/.test(u))).toEqual([]);
  expect(urls.filter((u) => /fullnode\.testnet\.sui\.io|api\.testnet\.miso\.fm|\/api\//.test(u))).toEqual([]);
});

test("testnet: real catalog, burner wallet, gRPC from the browser, purchase PTB resolves", async ({ page }) => {
  test.skip(FULL_LOOP, "read-only checks run without MISO_TESTNET_E2E");
  const log = watchConsole(page);
  const requests: { url: string; status: number | null }[] = [];
  page.on("requestfinished", async (r) => requests.push({ url: r.url(), status: (await r.response())?.status() ?? null }));
  page.on("requestfailed", (r) => requests.push({ url: r.url(), status: null }));
  // Simulate "bank server down" so this test never asks a live bank for gas.
  await page.route("**/api/**", (route) => route.fulfill({ status: 502, body: "" }));

  await startGame(page, "?chain=testnet");
  await shot(page, "tn-01-hud");
  expect(requests.some((r) => /\/assets\/backend-[^/]*\.js/.test(r.url))).toBe(true);

  // Catalog: both releases, hydrated from the Miso API / chain.
  const catalog = await page.evaluate(async () => {
    const records = await (window as any).__game.adapter.loadShopCatalog();
    return records.map((r: any) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      section: r.section,
      coverUrl: r.coverUrl,
      price: r.price.amount.toString(),
      minted: r.minted,
      maxSupply: r.maxSupply,
      listingId: r.listingId,
      pressingId: r.pressingId,
      tracks: r.tracks.map((t: any) => ({ quiltId: t.quiltId, durationSec: t.durationSec })),
    }));
  });
  console.log("catalog:", JSON.stringify(catalog.map((r: any) => ({ id: r.id.slice(0, 10), title: r.title, artist: r.artist, section: r.section, price: r.price, minted: r.minted, tracks: r.tracks.length }))));
  expect(catalog.map((r: any) => r.id)).toEqual(RELEASES);
  expect(catalog.map((r: any) => r.section)).toEqual(SHOP.map((s) => s.section));
  for (const r of catalog) {
    expect(r.title).toBeTruthy();
    expect(r.artist).toBeTruthy();
    expect(r.coverUrl).toMatch(/^https:\/\/cdn\.miso\.fm\/v1\/blobs\/[\w-]+\?w=512&f=webp$/);
    expect(BigInt(r.price)).toBeGreaterThan(0n);
    expect(r.maxSupply).toBeGreaterThan(0);
    expect(r.pressingId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.tracks.length).toBeGreaterThan(0);
    for (const t of r.tracks) {
      expect(t.quiltId).toMatch(/^[\w-]{20,}$/);
      expect(t.durationSec).toBeGreaterThan(30);
    }
  }

  // Wallet: burner address, 0 balances, HUD shows the short address.
  const wallet = await page.evaluate(async () => {
    const w = await (window as any).__game.adapter.getWallet();
    return { address: w.address, fakeUsd: w.fakeUsd.toString(), sui: w.sui.toString() };
  });
  expect(wallet.address).toMatch(/^0x[0-9a-f]{64}$/);
  const seeded = await page.evaluate((slot) => localStorage.getItem(slot) !== null, BURNER_KEY_SLOT);
  expect(seeded).toBe(true);
  if (!process.env.MISO_BURNER_KEY_FILE) {
    expect(wallet).toMatchObject({ fakeUsd: "0", sui: "0" });
  }
  const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
  await expect(page.locator(".wallet-address")).toHaveText(short);
  await expect(page.locator(".net-badge")).toHaveText("SUI TESTNET");
  expect(log.warnings.some((w) => /bank top-up failed: The bank server isn't running/.test(w))).toBe(true);

  // gRPC-web from the browser origin (CORS) worked.
  const grpc = requests.filter((r) => r.url.startsWith("https://fullnode.testnet.sui.io/"));
  expect(grpc.length).toBeGreaterThan(0);
  expect(grpc.every((r) => r.status === 200)).toBe(true);

  // The purchase PTB resolves against the live listing for a funded sender (unsigned).
  const funded = await page.evaluate(([id, sender]) => (window as any).__game.adapter.debugSimulatePurchase(id, sender), [RELEASES[0], FUNDED_SENDER] as const);
  console.log("simulate (funded sender):", JSON.stringify(funded));
  // The sender may have spent its FakeUSD by now; either way the result must be explained.
  if (funded.built) expect(funded).toMatchObject({ success: true, createsRecord: true });
  else expect(funded.playerMessage).toMatch(/Not enough (FakeUSD|SUI)/);

  // …and for the empty burner it stops at FakeUSD resolution with the friendly message.
  if (wallet.fakeUsd === "0") {
    const burner = await page.evaluate((id) => (window as any).__game.adapter.debugSimulatePurchase(id), RELEASES[0]);
    console.log("simulate (burner):", JSON.stringify(burner));
    expect(burner.built).toBe(false);
    expect(burner.playerMessage).toMatch(/^Not enough FakeUSD — you have 0\.00 FUSD, this costs \d+\.\d{2} FUSD\.$/);
  }

  // Collection read (gRPC listOwnedObjects) works for the empty burner.
  const owned = await page.evaluate(async () => (await (window as any).__game.adapter.listOwnedRecords()).length);
  expect(owned).toBeGreaterThanOrEqual(0);

  await teleport(page, `record:${RELEASES[0]}`);
  await page.waitForTimeout(800);
  await shot(page, "tn-02-shop");

  // Only the expected console errors: the browser's own "Failed to load resource" for /api.
  const unexpected = log.errors.filter((e) => !/Failed to load resource.*502|\/api\//.test(e));
  expect(unexpected).toEqual([]);
});

test("testnet full loop: buy → smash → sell → collection (opt-in, spends testnet gas)", async ({ page }) => {
  test.skip(!FULL_LOOP, "set MISO_TESTNET_E2E=1 (and MISO_BURNER_KEY_FILE) to run");
  test.setTimeout(1_200_000);
  const log = watchConsole(page);
  await seedBurner(page);
  const RECORD = RELEASES[0];
  const TITLE = await firstTitle();
  await startGame(page, "?chain=testnet");
  await shot(page, "tnl-01-hud");
  await until(page, (s) => s.balance !== null, "wallet loaded", 120_000);
  let s = await state(page);
  const before = BigInt(s.balance!);
  console.log("start balance", before.toString());
  test.skip(before < 20_000_000n, "burner has < 20 FUSD (is the bank server running and funded?)");

  const dialog = page.locator("dialog.dlg[open]");
  await teleport(page, { x: 0, z: -2, heading: Math.PI });
  await goTo(page, `record:${RECORD}`);
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText(TITLE);
  await shot(page, "tnl-02-record-menu");
  await page.keyboard.press("Enter"); // Pick up
  await until(page, (x) => x.hand?.shopRecordId === RECORD, "picked up");

  await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Ring it up?");
  await page.keyboard.press("Enter"); // Pay
  await expect(dialog.locator(".pending")).toBeVisible();
  await shot(page, "tnl-03-purchase-pending");
  await expect(dialog.locator("[data-receipt-link], .err-msg").first()).toBeVisible({ timeout: 180_000 });
  if (await dialog.locator(".err-msg").count()) {
    await shot(page, "tnl-03b-purchase-error");
    throw new Error(`purchase failed: ${await dialog.locator(".err-msg").innerText()}`);
  }
  s = await state(page);
  const recordId = s.hand!.recordId!;
  expect(recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(s.owned.some((o) => o.recordId === recordId)).toBe(true);
  await shot(page, "tnl-04-receipt");
  await page.keyboard.press("Escape");
  const afterBuy = BigInt(s.balance!);
  console.log("purchase", s.lastReceipt?.digest, "record", recordId, "balance", afterBuy.toString());
  expect(afterBuy).toBeLessThan(before);

  // The collection (read back from chain) shows the new Record.
  await page.keyboard.press("KeyC");
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toHaveCount(1, { timeout: 60_000 });
  await shot(page, "tnl-04b-collection-owned");
  await page.keyboard.press("Escape");

  await teleport(page, { x: 0, z: -1.6, heading: 0 });
  await page.keyboard.down("KeyW");
  await until(page, (x) => x.zone === "street", "walked out", 60_000);
  await page.keyboard.up("KeyW");
  await goTo(page, "car:2");
  await page.keyboard.press("KeyE");
  await expect(page.locator(".big-toast")).toContainText("STILL MINT", { timeout: 30_000 });
  await shot(page, "tnl-05-smash");

  await goTo(page, "buyer:collector");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText(new RegExp(`^Sell ${TITLE} for`));
  await chooseAction(page, /^Sell for/);
  await expect(dialog.locator(".pending")).toBeVisible();
  await shot(page, "tnl-06-sell-pending");
  const sold = await Promise.race([
    page.locator(".big-toast", { hasText: "SOLD" }).waitFor({ timeout: 240_000 }).then(() => true),
    dialog.locator(".err-msg").waitFor({ timeout: 240_000 }).then(() => false),
  ]);
  if (!sold) {
    await shot(page, "tnl-06b-sell-error");
    throw new Error(`sale failed: ${await dialog.locator(".err-msg").innerText()}`);
  }
  s = await until(page, (x) => x.sold.length === 1 && x.op === null, "sold", 60_000);
  expect(s.owned.find((o) => o.recordId === recordId)).toBeUndefined();
  await shot(page, "tnl-07-sold");

  await page.keyboard.press("KeyC");
  await expect(dialog.locator(".coll-sold-row")).toContainText(TITLE, { timeout: 60_000 });
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toHaveCount(0);
  await shot(page, "tnl-08-collection");
  const end = await until(page, (x) => x.balance !== null && BigInt(x.balance) > afterBuy, "FakeUSD increased", 60_000);
  console.log("sale", end.lastReceipt?.digest, "paid", end.sold[0]?.paid, "end balance", end.balance);
  expect(BigInt(end.balance!) - afterBuy).toBe(BigInt(end.sold[0]!.paid));
  expect(log.errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
