import { expect, test, type Page } from "@playwright/test";
import { installMockWallet, MOCK_WALLET_NAME, mockWalletSignCalls } from "./mockWallet";

// Wallet features against Sui testnet and the live Miso API, with a mock wallet that rejects every
// signature (see mockWallet.ts). Nothing is ever signed or executed. The balances below are real and
// can drift, so the tests read them first and skip (with a note) when a precondition no longer holds.

const T = 20_000; // testnet + API
const SIM = 60_000; // fresh reads + a live simulation on testnet

const REHEARSAL = "0x09fc758d6cce80ec4dafedb1e2bb8f52d5a5687eceafa130e1e4e42fae04571e"; // SUI + some FakeUSD
const STAGE = "0xf5ef55754ed5a2ab4cac85f0370c77417b8ac406fbbe620616e53981b3095446"; // SUI, 0 FakeUSD
const EXAMPLE_COLLECTOR = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f"; // owns records
const NEON_OVERPASS = "/release/0x8b783a8e66a4f3fed771294b1f00bfebd50fc6db217b3dbf2862aa55e953ffe5"; // 5.00 FakeUSD
const SUI_FAUCET = "https://faucet.sui.io/?network=testnet";

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A fresh, unused address: no SUI, no FakeUSD. */
function randomAddress() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Clicks "Connect wallet" in the header and picks the mock wallet in the dApp Kit modal. */
async function connectMock(page: Page, address: string) {
  const connect = page.locator(".wallet-connect");
  await expect(connect).toBeEnabled({ timeout: T });
  await connect.click();
  const modal = page.locator("mysten-dapp-kit-connect-modal");
  await modal.getByText(MOCK_WALLET_NAME, { exact: true }).click({ timeout: T });
  const pill = page.locator(".wallet-pill");
  await expect(pill.locator(".wallet-address")).toHaveText(short(address), { timeout: T });
  return pill;
}

/** The connected wallet's FakeUSD balance as shown in the header pill (waits until loaded). */
async function pillFakeUsd(page: Page): Promise<number> {
  const balance = page.locator(".wallet-pill .wallet-balance");
  await expect(balance).toHaveText(/^\d+\.\d{2} FakeUSD$/, { timeout: T });
  return Number((await balance.textContent())!.split(" ")[0]);
}

test.describe("without a wallet", () => {
  test("header Connect wallet opens the dApp Kit modal with Slush", async ({ page }) => {
    await page.goto("/");
    const connect = page.locator(".wallet-connect");
    await expect(connect).toHaveText("Connect wallet");
    await expect(connect).toBeEnabled({ timeout: T }); // the lazy wallet chunk has loaded
    await connect.click();
    const modal = page.locator("mysten-dapp-kit-connect-modal");
    await expect(modal).toHaveAttribute("open", "", { timeout: T });
    await expect(modal.getByText(/Slush/).first()).toBeVisible({ timeout: T });
  });

  test("faucet page: nav link, connect prompt, Sui faucet link", async ({ page }) => {
    await page.goto("/");
    const nav = page.locator("nav.nav");
    await nav.getByRole("link", { name: "Faucet" }).click();
    await expect(page).toHaveURL(/\/faucet$/);
    await expect(page.getByRole("heading", { level: 1, name: "Faucet" })).toBeVisible();
    await expect(page.getByText("Connect a wallet to receive FakeUSD.")).toBeVisible();
    await expect(page.locator(".faucet-box .button")).toHaveText("Connect wallet");
    await expect(page.getByRole("link", { name: "Sui faucet" })).toHaveAttribute("href", SUI_FAUCET);
  });

  test("release page shows the price and Connect wallet to buy", async ({ page }) => {
    await page.goto(NEON_OVERPASS);
    await expect(page.locator(".record-box .record-price").first()).toHaveText("5.00 FakeUSD", { timeout: T });
    await expect(page.locator(".buy-panel .button")).toHaveText("Connect wallet to buy", { timeout: T });
    await expect(page.locator(".buy-panel .button")).toBeEnabled();
  });

  test("How this works mentions the write path and the keyless reads", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "How this works" }).click();
    const drawer = page.getByRole("dialog", { name: "How this works" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("listing::purchase");
    await expect(drawer).toContainText("faucet::mint");
    await expect(drawer).toContainText(/Buying a record and the faucet are the only writes/);
    await expect(drawer).toContainText("No API key. No signup. No backend. Reading needs no wallet.");
    await expect(drawer).toContainText("Sui GraphQL");
  });
});

test.describe("with a mock wallet", () => {
  test("connect, menu, disconnect, and autoConnect after reload", async ({ page }) => {
    await installMockWallet(page, { address: EXAMPLE_COLLECTOR, signBehavior: "reject" });
    await page.goto("/");
    const pill = await connectMock(page, EXAMPLE_COLLECTOR);
    await pillFakeUsd(page);

    await pill.click();
    const menu = page.locator("#wallet-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText(EXAMPLE_COLLECTOR);
    await expect(menu.getByRole("button", { name: "Copy address" })).toBeVisible();
    await menu.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.locator(".wallet-connect")).toHaveText("Connect wallet", { timeout: T });
    await expect(page.locator(".wallet-pill")).toHaveCount(0);

    // Connect again, reload: the kit reconnects silently.
    await connectMock(page, EXAMPLE_COLLECTOR);
    await page.reload();
    await expect(page.locator(".wallet-pill .wallet-address")).toHaveText(short(EXAMPLE_COLLECTOR), { timeout: T });
  });

  test("buy: live simulation passes, the wallet is asked once and the cancel is shown", async ({ page }) => {
    test.setTimeout(120_000);
    await installMockWallet(page, { address: REHEARSAL, signBehavior: "reject" });
    await page.goto(NEON_OVERPASS);
    await connectMock(page, REHEARSAL);
    const fakeUsd = await pillFakeUsd(page);
    if (fakeUsd < 5) {
      test.info().annotations.push({ type: "skip", description: `REHEARSAL has only ${fakeUsd} FakeUSD (< 5.00)` });
      test.skip();
    }

    const buy = page.locator(".buy-panel .button");
    await expect(buy).toHaveText("Buy for 5.00 FakeUSD", { timeout: T });
    await expect(buy).toBeEnabled();
    await buy.click();
    // The wallet only opens after fresh reads, the balance check, the simulation and the gas check.
    await expect(page.locator(".buy-panel")).toContainText("You cancelled in your wallet.", { timeout: SIM });
    expect(await mockWalletSignCalls(page)).toBe(1);
    await expect(buy).toHaveText("Buy for 5.00 FakeUSD");
    await expect(buy).toBeEnabled();
  });

  test("buy: not enough FakeUSD disables the button and links to the faucet", async ({ page }) => {
    await installMockWallet(page, { address: STAGE, signBehavior: "reject" });
    await page.goto(NEON_OVERPASS);
    await connectMock(page, STAGE);
    const fakeUsd = await pillFakeUsd(page);
    if (fakeUsd >= 5) {
      test.info().annotations.push({ type: "skip", description: `STAGE now has ${fakeUsd} FakeUSD` });
      test.skip();
    }

    const buy = page.locator(".buy-panel .button");
    await expect(buy).toHaveText("Buy for 5.00 FakeUSD", { timeout: T });
    await expect(buy).toBeDisabled();
    const note = page.locator(".buy-panel .buy-note");
    await expect(note).toContainText(`You need 5.00 FakeUSD; you have ${fakeUsd.toFixed(2)}.`);
    await expect(note.getByRole("link", { name: "Get FakeUSD" })).toHaveAttribute("href", "/faucet");
    expect(await mockWalletSignCalls(page)).toBe(0);
  });

  test("faucet: the mint reaches the wallet once and the cancel is shown", async ({ page }) => {
    test.setTimeout(120_000);
    await installMockWallet(page, { address: STAGE, signBehavior: "reject" });
    await page.goto("/faucet");
    await connectMock(page, STAGE);

    const mint = page.locator(".faucet-box .button");
    await expect(mint).toHaveText("Get 100 FakeUSD", { timeout: T });
    await mint.click();
    await expect(page.locator(".faucet-box")).toContainText("You cancelled in your wallet.", { timeout: SIM });
    expect(await mockWalletSignCalls(page)).toBe(1);
    await expect(mint).toBeEnabled();
    // Connected: the gas section offers to copy the address.
    await expect(page.locator(".faucet-gas").getByRole("button", { name: "Copy address" })).toBeVisible();
  });

  test("faucet: a wallet with no SUI gets a gas message, never the wallet", async ({ page }) => {
    test.setTimeout(120_000);
    const empty = randomAddress();
    await installMockWallet(page, { address: empty, signBehavior: "reject" });
    await page.goto("/faucet");
    await connectMock(page, empty);

    await page.locator(".faucet-box .button").click();
    const note = page.locator(".faucet-box .buy-note");
    await expect(note).toContainText(/Not enough SUI to pay for gas/, { timeout: SIM });
    await expect(note.getByRole("link", { name: /Sui faucet/ })).toHaveAttribute("href", SUI_FAUCET);
    // One Copy address button on the page: in the "Need testnet SUI" section, not repeated in the note.
    await expect(page.getByRole("button", { name: "Copy address" })).toHaveCount(1);
    await expect(page.locator(".faucet-gas").getByRole("button", { name: "Copy address" })).toBeVisible();
    expect(await mockWalletSignCalls(page)).toBe(0);
  });

  test("collection defaults to the connected wallet", async ({ page }) => {
    await installMockWallet(page, { address: EXAMPLE_COLLECTOR, signBehavior: "reject" });
    await page.goto("/collection");
    await expect(page.getByRole("link", { name: "Try an example wallet" })).toBeVisible({ timeout: T });

    await connectMock(page, EXAMPLE_COLLECTOR);
    await expect(page.locator(".collection-owner")).toContainText(`Your wallet ${short(EXAMPLE_COLLECTOR)}`, { timeout: T });
    await expect(page.locator(".record-card").first()).toBeVisible({ timeout: T });
    await expect(page).toHaveURL(/\/collection$/);

    await page.locator(".wallet-pill").click();
    await page.locator("#wallet-menu").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("link", { name: "Try an example wallet" })).toBeVisible({ timeout: T });
  });
});
