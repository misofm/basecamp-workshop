/**
 * TestnetAdapter against live Sui TESTNET + the Miso API (network required). No server:
 * the game signs with two keys baked in at build time (VITE_PLAYER_SUI_PRIVATE_KEY,
 * VITE_GAME_SUI_PRIVATE_KEY from apps/game/.env.local; see README "Sui testnet").
 *
 * Always runs (spends no gas), with or without keys in the build:
 *  - mock mode never downloads the Sui SDK chunk (`assets/backend-*.js`) or touches the chain;
 *  - `?chain=testnet` loads the real catalog from shop.testnet.json (titles from chain,
 *    cdn.miso.fm covers, tracks with quilt ids + durations) and gRPC works from the browser
 *    origin (CORS); the purchase PTB resolves for a funded sender (build + simulate, unsigned);
 *  - keyless build: the intro says "Cash: The shop's till is offline right now. …" (the
 *    developer hint "Testnet keys missing: …" goes to the console) and every wallet call
 *    rejects with that message; keyed build: the HUD shows a quiet "online" indicator (the
 *    player's address only in data-address) and the collector is the GAME address.
 *
 * Opt-in full loop (spends testnet gas; needs a keyed build with both addresses funded with
 * testnet SUI): ATM (+50 FUSD) → shop → buy the cheapest record → smash → sell.
 *   npm run stage   # in another shell: keyed testnet build + vite preview on :4173
 *   MISO_E2E_BASE_URL=http://127.0.0.1:4173 MISO_TESTNET_E2E=1 npx playwright test tests/e2e/testnet.spec.ts
 * Without MISO_E2E_BASE_URL the default webServer builds with `vite build`, which also reads
 * .env.local. MISO_TESTNET_RECORD=<releaseId> picks the record instead of the cheapest.
 * Screenshots go to $SHOTS_DIR.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { chooseAction, frames, goTo, startGame, state, teleport, until } from "./helpers";

const SHOTS =
  process.env.SHOTS_DIR ??
  new URL("../../test-results/shots-testnet", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120_000, animations: "disabled" });

/** The shop as shipped (public/shop.testnet.json), so the test follows whatever is on the shelves. */
const SHOP: { releaseId: string; section: string }[] = JSON.parse(readFileSync(new URL("../../public/shop.testnet.json", import.meta.url), "utf8"));
const RELEASES = SHOP.map((s) => s.releaseId);
/** A testnet wallet that has bought records before (holds FakeUSD + SUI as address balance). */
const FUNDED_SENDER = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";
const FULL_LOOP = process.env.MISO_TESTNET_E2E === "1";
/** What the PLAYER sees for a keyless build (the "set VITE_…" hint is console-only). */
const KEYS_MISSING = /^The shop's till is offline right now\. Try again later\.$/;
const ATM_AMOUNT = 50_000_000n;

function watchConsole(page: Page): { errors: string[]; warnings: string[] } {
  const out = { errors: [] as string[], warnings: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error") out.errors.push(`${m.text()} @ ${m.location().url}`);
    if (m.type() === "warning") out.warnings.push(m.text());
  });
  page.on("pageerror", (e) => out.errors.push(`pageerror: ${e.message}`));
  return out;
}

/** Call an adapter method in the page; rejections come back as { error }. */
async function call<T = any>(page: Page, method: string, ...args: unknown[]): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return page.evaluate(
    async ([m, a]) => {
      try {
        const v = await (window as any).__game.adapter[m as string](...(a as unknown[]));
        // bigints aren't serializable: stringify them
        return { ok: true, value: JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
    [method, args] as const,
  );
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

test("testnet: real catalog, gRPC from the browser, keys or a clear 'keys missing', purchase PTB resolves", async ({ page }) => {
  test.skip(FULL_LOOP, "read-only checks run without MISO_TESTNET_E2E");
  const log = watchConsole(page);
  const requests: { url: string; status: number | null }[] = [];
  page.on("requestfinished", async (r) => requests.push({ url: r.url(), status: (await r.response())?.status() ?? null }));
  page.on("requestfailed", (r) => requests.push({ url: r.url(), status: null }));

  await page.goto("/?chain=testnet");
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === "true", null, { timeout: 60_000 });
  await expect(page.locator(".intro")).toBeVisible();
  await expect(page.locator('.intro-status [data-id="catalog"]')).toHaveClass("st-ok");
  expect(requests.some((r) => /\/assets\/backend-[^/]*\.js/.test(r.url))).toBe(true);
  expect(requests.filter((r) => /\/api\//.test(r.url))).toEqual([]);

  // Catalog: every shelf entry, hydrated from the Miso API / chain (needs no keys).
  const catalogCall = await call<any[]>(page, "loadShopCatalog");
  expect(catalogCall.ok).toBe(true);
  const catalog = (catalogCall as { value: any[] }).value;
  console.log("catalog:", JSON.stringify(catalog.map((r) => ({ id: r.id.slice(0, 10), title: r.title, artist: r.artist, section: r.section, price: r.price.amount, minted: r.minted, tracks: r.tracks.length }))));
  expect(catalog.map((r) => r.id)).toEqual(RELEASES);
  expect(catalog.map((r) => r.section)).toEqual(SHOP.map((s) => s.section));
  for (const r of catalog) {
    expect(r.title).toBeTruthy();
    expect(r.artist).toBeTruthy();
    expect(r.coverUrl).toMatch(/^https:\/\/cdn\.miso\.fm\/v1\/blobs\/[\w-]+\?w=512&f=webp$/);
    expect(BigInt(r.price.amount)).toBeGreaterThan(0n);
    expect(r.maxSupply).toBeGreaterThan(0);
    expect(r.pressingId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.tracks.length).toBeGreaterThan(0);
    for (const t of r.tracks) {
      expect(t.quiltId).toMatch(/^[\w-]{20,}$/);
      expect(t.durationSec).toBeGreaterThan(30);
    }
  }

  const wallet = await call<{ address: string; fakeUsd: string; sui: string }>(page, "getWallet");
  const keyed = wallet.ok;
  console.log("keys in this build:", keyed);
  const walletLine = page.locator('.intro-status [data-id="wallet"]');
  if (!wallet.ok) {
    // Keyless build: catalog works, everything wallet-related says the till is offline.
    expect(wallet.error).toMatch(KEYS_MISSING);
    await expect(walletLine).toHaveClass("st-error");
    await expect(walletLine).toHaveText(`Cash: ${wallet.error}`);
    for (const m of ["collectorAddress", "listOwnedRecords"]) {
      const r = await call(page, m);
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toMatch(KEYS_MISSING);
    }
    expect(await call(page, "withdrawFakeUsd", 1n)).toMatchObject({ ok: false, error: expect.stringMatching(KEYS_MISSING) });
    const sim = await page.evaluate((id) => (window as any).__game.adapter.debugSimulatePurchase(id), RELEASES[0]);
    expect(sim.playerMessage).toMatch(KEYS_MISSING);
  } else {
    const w = wallet.value;
    expect(w.address).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(walletLine).toHaveClass("st-ok");
    const collector = await call<string>(page, "collectorAddress");
    expect(collector.ok).toBe(true);
    expect((collector as { value: string }).value).toMatch(/^0x[0-9a-f]{64}$/);
    expect((collector as { value: string }).value).not.toBe(w.address);
    const owned = await call<unknown[]>(page, "listOwnedRecords");
    expect(owned.ok).toBe(true);
    // A player who can't afford the record gets pointed at the ATM (nothing is minted silently).
    const price = BigInt(catalog[0].price.amount);
    if (BigInt(w.fakeUsd) < price) {
      const sim = await page.evaluate((id) => (window as any).__game.adapter.debugSimulatePurchase(id), RELEASES[0]);
      console.log("simulate (player):", JSON.stringify(sim));
      expect(sim.built).toBe(false);
      expect(sim.playerMessage).toMatch(/^Jazz frowns: short on cash\.$/);
    }
  }

  // The purchase PTB resolves against the live listing for a funded sender (unsigned).
  const funded = await page.evaluate(([id, sender]) => (window as any).__game.adapter.debugSimulatePurchase(id, sender), [RELEASES[0], FUNDED_SENDER] as const);
  console.log("simulate (funded sender):", JSON.stringify(funded));
  // The sender may have spent its FakeUSD by now; either way the result must be explained.
  if (funded.built) expect(funded).toMatchObject({ success: true, createsRecord: true });
  else expect(funded.playerMessage).toMatch(/short on cash|till is offline/);

  // gRPC-web from the browser origin (CORS) worked.
  const grpc = requests.filter((r) => r.url.startsWith("https://fullnode.testnet.sui.io/"));
  expect(grpc.length).toBeGreaterThan(0);
  expect(grpc.every((r) => r.status === 200)).toBe(true);

  // Into the game: a quiet "online" indicator; the address is only a data attribute (keyed).
  await page.waitForFunction(() => document.documentElement.dataset.character !== undefined, null, { timeout: 120_000 });
  await frames(page, 4);
  await shot(page, "tn-01-intro");
  await page.keyboard.press("Enter");
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#hud .net-status")).toHaveText("online");
  if (wallet.ok) await expect(page.locator("#hud .net-status")).toHaveAttribute("data-address", wallet.value.address);
  await shot(page, "tn-02-hud");
  await teleport(page, `record:${RELEASES[0]}`);
  await page.waitForTimeout(800);
  await shot(page, "tn-03-shop");

  const unexpected = log.errors.filter((e) => !/Failed to load resource/.test(e));
  expect(unexpected).toEqual([]);
});

test("testnet full loop: ATM → buy → smash → sell (opt-in, spends testnet gas)", async ({ page }) => {
  test.skip(!FULL_LOOP, "set MISO_TESTNET_E2E=1 (with a keyed build) to run");
  test.setTimeout(1_200_000);
  const log = watchConsole(page);
  await startGame(page, "?chain=testnet"); // needs the wallet line OK: a keyed build
  await shot(page, "tnl-01-hud");
  await until(page, (s) => s.balance !== null, "wallet loaded", 120_000);
  const dialog = page.locator("dialog.dlg[open]");

  // Pick the record: MISO_TESTNET_RECORD, else the cheapest on the shelves.
  const catalog: { id: string; title: string; price: string }[] = await page.evaluate(async () =>
    ((await (window as any).__game.adapter.loadShopCatalog()) as any[]).map((r) => ({ id: r.id, title: r.title, price: r.price.amount.toString() })),
  );
  const pick = process.env.MISO_TESTNET_RECORD
    ? catalog.find((r) => r.id === process.env.MISO_TESTNET_RECORD)
    : [...catalog].sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1))[0];
  if (!pick) throw new Error(`MISO_TESTNET_RECORD=${process.env.MISO_TESTNET_RECORD} is not in the catalog`);
  const RECORD = pick.id;
  const TITLE = pick.title;
  const PRICE = BigInt(pick.price);
  const offer = (PRICE * 3n) / 2n;
  const EXPECTED_PAID = offer > 150_000_000n ? 150_000_000n : offer;
  console.log("record", TITLE, RECORD, "price", PRICE.toString());

  // 1. ATM: +50 FUSD from the faucet, signed by the player.
  let s = await state(page);
  const beforeAtm = BigInt(s.balance!);
  await goTo(page, "atm");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("ATM");
  await expect(dialog.locator(".dlg-action", { hasText: "Withdraw 50" })).toBeVisible();
  await shot(page, "tnl-02-atm");
  await page.keyboard.press("Enter"); // Withdraw 50 FUSD
  await expect(dialog.locator(".pending")).toBeVisible();
  await expect(dialog.locator("[data-receipt-link], .err-msg").first()).toBeVisible({ timeout: 180_000 });
  if (await dialog.locator(".err-msg").count()) {
    await shot(page, "tnl-02b-atm-error");
    throw new Error(`ATM failed: ${await dialog.locator(".err-msg").innerText()}`);
  }
  await shot(page, "tnl-03-atm-receipt");
  const atm = await page.evaluate(() => (window as any).__game.state().lastReceipt);
  expect(atm.kind).toBe("withdraw");
  console.log("ATM digest", atm.digest);
  // The UI never shows digests; the receipt link carries the transaction.
  await expect(dialog.locator("[data-receipt-link]")).toHaveAttribute("href", new RegExp(atm.digest));
  s = await until(page, (x) => x.balance !== null && BigInt(x.balance) >= beforeAtm + ATM_AMOUNT, "ATM balance", 60_000);
  expect(BigInt(s.balance!) - beforeAtm).toBe(ATM_AMOUNT);
  await page.keyboard.press("Escape");
  const before = BigInt(s.balance!);
  expect(before).toBeGreaterThanOrEqual(PRICE);

  // 2. Shop: pick up and pay.
  await teleport(page, { x: 0, z: -2, heading: Math.PI });
  await goTo(page, `record:${RECORD}`);
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText(TITLE);
  await page.keyboard.press("Enter"); // Pick up
  await until(page, (x) => x.hand?.shopRecordId === RECORD, "picked up");

  await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText(TITLE);
  await page.keyboard.press("Enter"); // Pay
  await expect(dialog.locator(".pending")).toBeVisible();
  await shot(page, "tnl-04-purchase-pending");
  await expect(dialog.locator("[data-receipt-link], .err-msg").first()).toBeVisible({ timeout: 180_000 });
  if (await dialog.locator(".err-msg").count()) {
    await shot(page, "tnl-04b-purchase-error");
    throw new Error(`purchase failed: ${await dialog.locator(".err-msg").innerText()}`);
  }
  s = await state(page);
  const recordId = s.hand!.recordId!;
  expect(recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(s.owned.some((o) => o.recordId === recordId)).toBe(true);
  await shot(page, "tnl-05-receipt");
  await page.keyboard.press("Escape");
  const purchase = await page.evaluate(() => (window as any).__game.state().lastReceipt);
  const afterBuy = BigInt(s.balance!);
  console.log("purchase digest", purchase?.digest, "recordId", recordId, "balance", afterBuy.toString());
  expect(before - afterBuy).toBe(PRICE);

  // The collection (read back from chain) shows the new Record.
  await page.keyboard.press("KeyC");
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toHaveCount(1, { timeout: 60_000 });
  await page.keyboard.press("Escape");

  // 3. Smash the dead Triangle sedan with it.
  await teleport(page, { x: 0, z: -1.6, heading: 0 });
  await page.keyboard.down("KeyW");
  await until(page, (x) => x.zone === "street", "walked out", 60_000);
  await page.keyboard.up("KeyW");
  await goTo(page, "car:0");
  await page.keyboard.press("KeyE");
  await expect(page.locator(".big-toast")).toContainText("STILL MINT", { timeout: 30_000 });
  await shot(page, "tnl-06-smash");

  // 4. Sell: player transfer to the GAME, GAME payout.
  await goTo(page, "buyer:collector");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Stonks wants it");
  await chooseAction(page, /Sell/);
  await expect(dialog.locator(".pending")).toBeVisible();
  await shot(page, "tnl-07-sell-pending");
  const sold = await Promise.race([
    dialog.locator(".dlg-title", { hasText: /済 SOLD/ }).waitFor({ timeout: 240_000 }).then(() => true),
    dialog.locator(".err-msg").waitFor({ timeout: 240_000 }).then(() => false),
  ]);
  if (!sold) {
    await shot(page, "tnl-07b-sell-error");
    throw new Error(`sale failed: ${await dialog.locator(".err-msg").innerText()}`);
  }
  s = await until(page, (x) => x.sold.length === 1 && x.op === null, "sold", 60_000);
  expect(s.owned.find((o) => o.recordId === recordId)).toBeUndefined();
  const paid = BigInt(s.sold[0]!.paid!);
  const sale = await page.evaluate(() => (window as any).__game.state().lastReceipt);
  console.log("sale digest", sale?.digest, "paid", paid.toString());
  expect(paid).toBe(EXPECTED_PAID);
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveAttribute("href", /^https:\/\/devxplorer\.io\/\?search=/);
  await shot(page, "tnl-08-sold");
  await page.keyboard.press("Enter"); // OK closes the sold card; C is ignored while a dialog is open
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press("KeyC");
  await expect(dialog.locator(".coll-sold-row")).toContainText(TITLE, { timeout: 60_000 });
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toHaveCount(0);
  await shot(page, "tnl-09-collection");
  const end = await until(page, (x) => x.balance !== null && BigInt(x.balance) > afterBuy, "FakeUSD increased", 60_000);
  console.log("end balance", end.balance);
  expect(BigInt(end.balance!) - afterBuy).toBe(paid);
  expect(log.errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
