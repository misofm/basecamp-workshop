/**
 * State safety: the nasty sequences from docs/STATE-MODEL.md §2-3 in a real build,
 * MockAdapter (e2e test build) only. Black-box: keyboard / DOM plus the public `__game.state()` slice,
 * so these survive a rewrite of the controller internals.
 *
 * Each game start costs ~1 min on SwiftShader, so scenarios that share a setup share a
 * test (one `test.step` per intent).
 */
import { expect, test, type Page } from "@playwright/test";
import { chooseAction, frames, goTo, pageErrors, shot, startGame, state, teleport, until } from "./helpers";

const RECORD = "low-tide-tapes"; // 12.00 FUSD → Stonks pays 18.00
const RECORD_2 = "field-notes"; // 8.00 FUSD → Stonks pays 12.00
const CAR = "car:0";
/** On the north sidewalk in front of Saisei Records, facing its door. */
const SHOP_FRONT = { x: 0, z: 1.8, heading: Math.PI };
/** Just inside the shop doorway, facing out (south). */
const DOORWAY_INSIDE = { x: 0, z: -1.6, heading: 0 };
/** Inside the shop. */
const SHOP_INSIDE = { x: 0, z: -2, heading: Math.PI };

const fusd = (n: number) => String(Math.round(n * 1_000_000));

const dlg = (page: Page) => page.locator("dialog.dlg[open]");

async function setLatency(page: Page, ms: number): Promise<void> {
  await page.evaluate((v) => (window as any).__game.setLatency(v), ms);
}

async function playerPos(page: Page): Promise<{ x: number; z: number }> {
  return page.evaluate(() => {
    const p = (window as any).__game.world.getPlayer();
    return { x: p.x, z: p.z };
  });
}

/** Pick `id` off the shelf (record menu → "Pick up"). Assumes you are in the shop. */
async function pickUp(page: Page, id: string): Promise<void> {
  await goTo(page, `record:${id}`);
  await page.keyboard.press("KeyE");
  await expect(dlg(page)).toBeVisible();
  await page.keyboard.press("Enter"); // "Pick up" is focused
  await until(page, (s) => s.hand?.shopRecordId === id && s.hand.recordId === null, `picked up ${id}`);
  await expect(dlg(page)).toHaveCount(0);
}

/** Open the counter's "Ring it up?" screen for the held unpaid record. */
async function openCashier(page: Page, { uiHidden = false } = {}): Promise<void> {
  if (uiHidden) {
    // U-hidden overlay: the prompt is hidden too, so wait on the world's "near" only.
    await teleport(page, "cashier");
    await page.waitForFunction(() => (window as any).__game.controller.near?.id === "cashier");
  } else await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await expect(dlg(page).locator(".dlg-action:focus")).toHaveText(/Pay/);
}

/** Buy the held record at normal speed and close the receipt. */
async function buyHeld(page: Page): Promise<void> {
  await openCashier(page);
  await page.keyboard.press("Enter");
  await expect(dlg(page).locator("[data-receipt-link]").first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
}

async function simulateHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event(h ? "blur" : "focus"));
  }, hidden);
}

test("double confirm: Pay (Enter Enter, dblclick), Withdraw and Sell each happen once", async ({ page }) => {
  await startGame(page, "?latency=600");

  await test.step("Pay: Enter, Enter with no wait → one Record, 88.00", async () => {
    await teleport(page, SHOP_INSIDE);
    await pickUp(page, RECORD);
    await openCashier(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".pending")).toBeVisible();
    await shot(page, "safety-01-double-pay-pending");
    await expect(dlg(page).locator("[data-receipt-link]").first()).toBeVisible({ timeout: 30_000 });
    const s = await until(page, (x) => x.op === null, "purchase settled");
    expect(s.owned).toHaveLength(1);
    expect(s.hand?.recordId).toBe(s.owned[0]!.recordId);
    expect(s.balance).toBe(fusd(88));
    await page.waitForTimeout(1500); // a stray second purchase would have landed by now
    expect((await state(page)).owned).toHaveLength(1);
    expect((await state(page)).balance).toBe(fusd(88));
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("Pay: dblclick on the Pay button → one Record, 80.00", async () => {
    await page.keyboard.press("KeyI");
    await chooseAction(page, /Put away/);
    await until(page, (x) => x.hand === null, "stowed");
    await pickUp(page, RECORD_2);
    await openCashier(page);
    await dlg(page).locator(".dlg-action", { hasText: /Pay/ }).dblclick();
    await expect(dlg(page).locator("[data-receipt-link]").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const s = await until(page, (x) => x.op === null, "purchase settled");
    expect(s.owned).toHaveLength(2);
    expect(s.owned.filter((o) => o.shopRecordId === RECORD_2)).toHaveLength(1);
    expect(s.balance).toBe(fusd(80));
    await shot(page, "safety-02-dblclick-pay-receipt");
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("Withdraw: Enter, Enter → +50 once", async () => {
    await teleport(page, SHOP_FRONT);
    await until(page, (x) => x.zone === "street", "outside");
    await goTo(page, "atm");
    await page.keyboard.press("KeyE");
    await expect(dlg(page).locator(".dlg-title")).toHaveText("ATM");
    await expect(dlg(page).locator(".dlg-action:focus .dlg-action-label")).toHaveText("Withdraw 50");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator('[data-receipt-link="tx"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const s = await until(page, (x) => x.op === null, "withdraw settled");
    expect(s.balance).toBe(fusd(130));
    await expect(page.locator(".money-value")).toHaveText("130.00");
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("Sell: Enter, Enter → paid once, one sale", async () => {
    await goTo(page, "buyer:collector");
    await page.keyboard.press("KeyE");
    await expect(dlg(page).locator(".dlg-title")).toHaveText("Stonks wants it");
    await expect(dlg(page)).toContainText("12.00 FUSD");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".dlg-title")).toHaveText(/SOLD/, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const s = await until(page, (x) => x.op === null && x.sold.length >= 1, "sold");
    expect(s.sold).toHaveLength(1);
    expect(s.sold[0]!.paid).toBe(fusd(12));
    expect(s.balance).toBe(fusd(142));
    expect(s.owned).toHaveLength(1); // the low-tide Record is still ours
    await shot(page, "safety-03-double-sell-sold");
    await page.keyboard.press("Escape");
  });

  expect(pageErrors(page)).toEqual([]);
});

test("pending purchase: Esc keeps it running; hand, door, Reset and U stay safe until it settles", async ({ page }) => {
  await startGame(page, "?latency=400");
  await teleport(page, SHOP_INSIDE);
  await pickUp(page, RECORD);

  await test.step("U hides the overlay before paying", async () => {
    await page.keyboard.press("KeyU");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.ui)).toBe("off");
  });

  await test.step("Pay, then Esc the pending screen: overlay forced on, spinner, U ignored", async () => {
    await setLatency(page, 20_000); // purchase + re-read ≈ 40 s: room for the checks below on a slow box
    await openCashier(page, { uiHidden: true });
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".pending")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe("on");
    await expect(page.locator(".money-pending")).toBeVisible();
    const s = await state(page);
    expect(s.op).toMatchObject({ kind: "purchase", status: "pending" });
    expect(s.hand).toMatchObject({ shopRecordId: RECORD, recordId: null });
    await page.keyboard.press("KeyU");
    await frames(page, 2);
    expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe("on");
    await shot(page, "safety-04-pending-closed-spinner");
  });

  await test.step("I: inspect's Put back is disabled while paying", async () => {
    await page.keyboard.press("KeyI");
    await expect(dlg(page).locator(".dlg-action", { hasText: /Put back/ })).toBeDisabled();
    await shot(page, "safety-05-inspect-locked");
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    expect((await state(page)).hand).toMatchObject({ shopRecordId: RECORD, recordId: null });
  });

  await test.step("C opens the collection while paying", async () => {
    await page.keyboard.press("KeyC");
    await expect(dlg(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("walking out with the unpaid record is blocked", async () => {
    await teleport(page, DOORWAY_INSIDE);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyW");
    const s = await state(page);
    expect(s.zone).toBe("shop");
    expect(s.op).toMatchObject({ kind: "purchase", status: "pending" });
  });

  await test.step("H: Reset demo disabled while pending, enabled once it settles (help open)", async () => {
    await page.keyboard.press("KeyH");
    const reset = dlg(page).locator(".dlg-action", { hasText: /Reset demo/ });
    await expect(reset).toBeDisabled();
    await shot(page, "safety-06-help-reset-disabled");
    const s = await until(page, (x) => x.op === null, "purchase settled", 120_000);
    expect(s.hand?.recordId).toMatch(/^0x/);
    expect(s.owned).toHaveLength(1);
    expect(s.balance).toBe(fusd(88));
    await expect(reset).toBeEnabled();
    await expect(page.locator(".toast", { hasText: /Bought Low Tide Tapes/ })).toBeVisible();
    await shot(page, "safety-07-settled-toast-reset-enabled");
    await page.keyboard.press("Escape"); // never click Reset
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("U hides the overlay again once settled", async () => {
    await page.keyboard.press("KeyU");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.ui)).toBe("off");
    await page.keyboard.press("KeyU");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.ui)).toBe("on");
  });

  expect(pageErrors(page)).toEqual([]);
});

test("tab hidden during a purchase; window blur releases held movement keys", async ({ page }) => {
  await startGame(page, "?latency=2500");
  await teleport(page, SHOP_INSIDE);
  await pickUp(page, RECORD);

  await test.step("hide the tab mid-purchase, settle, un-hide: consistent state", async () => {
    await openCashier(page);
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".pending")).toBeVisible();
    await simulateHidden(page, true);
    await until(page, (x) => x.op === null, "purchase settled while hidden", 60_000);
    await simulateHidden(page, false);
    const s = await state(page);
    expect(s.owned).toHaveLength(1);
    expect(s.hand?.recordId).toBe(s.owned[0]!.recordId);
    expect(s.op).toBeNull();
    expect(s.balance).toBe(fusd(88));
    await expect(dlg(page).locator("[data-receipt-link]").first()).toBeVisible();
    await expect(page.locator(".money-value")).toHaveText("88.00");
    await shot(page, "safety-08-hidden-tab-receipt");
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("hold W, blur: the player stops (no stuck walking)", async () => {
    await teleport(page, { x: -3, z: 1.8, heading: Math.PI / 2 }); // sidewalk, facing east
    await until(page, (x) => x.zone === "street", "outside");
    const start = await playerPos(page);
    await page.keyboard.down("KeyW");
    try {
      await expect
        .poll(async () => {
          const p = await playerPos(page);
          return Math.hypot(p.x - start.x, p.z - start.z);
        })
        .toBeGreaterThan(0.2);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await page.waitForTimeout(400); // let any deceleration finish
      const a = await playerPos(page);
      await page.waitForTimeout(1000);
      const b = await playerPos(page);
      expect(Math.hypot(b.x - a.x, b.z - a.z), `moved from ${JSON.stringify(a)} to ${JSON.stringify(b)} after blur`).toBeLessThan(0.05);
    } finally {
      await page.keyboard.up("KeyW");
    }
  });

  expect(pageErrors(page)).toEqual([]);
});

test("lost answers: purchase and sale retried after a timeout are charged / paid once", async ({ page }) => {
  await startGame(page, "?latency=500");
  await teleport(page, SHOP_INSIDE);
  await pickUp(page, RECORD);
  let recordId = "";

  await test.step("purchase-lost → error, re-read balance 88.00, Retry → same single Record", async () => {
    await page.evaluate(() => (window as any).__game.failNext("purchase-lost"));
    await openCashier(page);
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".err-msg")).toContainText("Shop took too long", { timeout: 30_000 });
    await expect(page.locator(".money-value")).toHaveText("88.00", { timeout: 30_000 });
    let s = await until(page, (x) => x.owned.length === 1, "collection re-read shows the landed Record");
    expect(s.op).toMatchObject({ kind: "purchase", status: "error" });
    expect(s.hand).toMatchObject({ shopRecordId: RECORD, recordId: null });
    expect(s.balance).toBe(fusd(88));
    recordId = s.owned[0]!.recordId;
    await expect(dlg(page).locator(".dlg-action:focus")).toHaveText(/Retry/);
    await shot(page, "safety-09-purchase-lost");
    await page.keyboard.press("Enter"); // Retry
    await expect(dlg(page).locator("[data-receipt-link]").first()).toBeVisible({ timeout: 30_000 });
    s = await until(page, (x) => x.op === null, "retry settled");
    expect(s.owned).toHaveLength(1);
    expect(s.owned[0]!.recordId).toBe(recordId);
    expect(s.hand?.recordId).toBe(recordId);
    expect(s.balance).toBe(fusd(88));
    await shot(page, "safety-10-purchase-retry-receipt");
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
  });

  await test.step("sell-lost → error, Retry → paid once (106.00), one sale", async () => {
    await teleport(page, SHOP_FRONT);
    await until(page, (x) => x.zone === "street", "outside");
    await goTo(page, "buyer:collector");
    await page.evaluate(() => (window as any).__game.failNext("sell-lost"));
    await page.keyboard.press("KeyE");
    await expect(dlg(page).locator(".dlg-title")).toHaveText("Stonks wants it");
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".err-msg")).toContainText("Shop took too long", { timeout: 30_000 });
    await expect(page.locator(".money-value")).toHaveText("106.00", { timeout: 30_000 });
    let s = await state(page);
    expect(s.op).toMatchObject({ kind: "sell", status: "error" });
    expect(s.hand?.recordId).toBe(recordId);
    await shot(page, "safety-11-sell-lost");
    await expect(dlg(page).locator(".dlg-action:focus")).toHaveText(/Retry/);
    await page.keyboard.press("Enter"); // Retry
    await expect(dlg(page).locator(".dlg-title")).toHaveText(/SOLD/, { timeout: 30_000 });
    s = await until(page, (x) => x.op === null && x.sold.length >= 1, "sold after retry");
    expect(s.sold).toHaveLength(1);
    expect(s.sold[0]!.recordId).toBe(recordId);
    expect(s.balance).toBe(fusd(106));
    expect(s.owned).toHaveLength(0);
    expect(s.hand).toBeNull();
    await page.waitForTimeout(1500);
    expect((await state(page)).balance).toBe(fusd(106));
    await shot(page, "safety-12-sell-retry-sold");
    await page.keyboard.press("Escape");
  });

  expect(pageErrors(page)).toEqual([]);
});

test("loading screen eats keys; no smash mid-sale; exit beat refuses menus and runs once", async ({ page }) => {
  await test.step("keys on the loading screen do nothing", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    (page as any).__errors = errors;
    await page.goto("/?latency=400");
    await expect(page.locator(".intro")).toBeVisible({ timeout: 60_000 });
    for (const key of ["KeyE", "Space", "KeyC", "KeyH", "KeyU", "KeyW", "KeyI", "Escape"]) await page.keyboard.press(key);
    await page.waitForFunction(() => document.documentElement.dataset.gameReady === "true", null, { timeout: 60_000 });
    await expect(page.locator(".intro[data-ready='true'] .intro-start")).toBeVisible({ timeout: 120_000 });
    await page.waitForFunction(() => document.documentElement.dataset.character !== undefined, null, { timeout: 120_000 });
    // Mash again now that it is ready (but before Enter).
    for (const key of ["KeyE", "Space", "KeyC", "KeyH", "KeyU", "KeyW"]) await page.keyboard.press(key);
    await expect(page.locator(".intro")).toBeVisible();
    await frames(page, 4);
    await page.keyboard.press("Enter");
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator(".intro")).toHaveCount(0, { timeout: 5000 });
    await frames(page, 4);
    await expect(dlg(page)).toHaveCount(0);
    const s = await state(page);
    expect(s.hand).toBeNull();
    expect(s.op).toBeNull();
    expect(s.deck).toBeNull();
    expect(s.balance).toBe(fusd(100));
    expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe("on");
    await shot(page, "safety-13-after-loading-mash");
  });

  await test.step("buy a record", async () => {
    await teleport(page, SHOP_INSIDE);
    await pickUp(page, RECORD);
    await buyHeld(page);
    await teleport(page, SHOP_FRONT);
    await until(page, (x) => x.zone === "street", "outside");
  });

  await test.step("E on the car while the sale is pending → no smash, 'One thing at a time.'", async () => {
    await goTo(page, "buyer:collector");
    await setLatency(page, 9000);
    await page.keyboard.press("KeyE");
    await expect(dlg(page).locator(".dlg-title")).toHaveText("Stonks wants it");
    await page.keyboard.press("Enter");
    await expect(dlg(page).locator(".pending")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg(page)).toHaveCount(0);
    await goTo(page, CAR);
    expect((await state(page)).op).toMatchObject({ kind: "sell", status: "pending" });
    await page.keyboard.press("KeyE");
    await expect(page.locator(".toast", { hasText: "One thing at a time." })).toBeVisible();
    await shot(page, "safety-14-no-smash-mid-sale");
    let s = await state(page);
    expect(s.smashedCars).toEqual([]);
    s = await until(page, (x) => x.op === null && x.sold.length === 1, "sale settled", 60_000);
    expect(s.smashedCars).toEqual([]);
    expect(s.balance).toBe(fusd(106));
    expect(await page.evaluate((id) => (window as any).__game.world.getInteractable(id).enabled, CAR)).toBe(true);
    await setLatency(page, 400);
  });

  await test.step("exit beat: C / H refused during the boom, card once, door does nothing after", async () => {
    await goTo(page, "home");
    await page.keyboard.press("KeyE");
    await page.keyboard.press("KeyC");
    await page.keyboard.press("KeyH");
    await page.keyboard.press("KeyI");
    await expect(dlg(page)).toHaveCount(0);
    const card = page.locator(".title-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(dlg(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__game.state().wentHome)).toBe(true);
    await shot(page, "safety-15-title-card");
    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
    await expect(dlg(page)).toHaveCount(0);
    // The door again: disabled, E does nothing.
    await teleport(page, "home");
    await frames(page, 4);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(4500); // longer than boom + card delay
    await expect(card).toHaveCount(0);
    await expect(dlg(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__game.state().wentHome)).toBe(true);
    expect(await page.evaluate(() => (window as any).__game.world.getInteractable("home").enabled)).toBe(false);
    await shot(page, "safety-16-home-after");
  });

  expect(pageErrors(page)).toEqual([]);
});
