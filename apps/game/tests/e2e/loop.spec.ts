/**
 * The full game loop on the e2e build's MockAdapter, driven like a player: keyboard for menus and
 * interactions (E / Enter / arrows), a real W-walk through the shop door, and
 * __game.teleportTo for the long walks. Screenshots of every step go to SHOTS.
 */
import { expect, test } from "@playwright/test";
import { chooseAction, goTo, pageErrors, shot, startGame, state, teleport, until } from "./helpers";

const RECORD = "low-tide-tapes"; // 12.00 FUSD in the mock catalog → Stonks pays 18.00
const CAR = "car:0"; // the dead Triangle sedan across the street
/** On the north sidewalk in front of Saisei Records, facing its door. */
const SHOP_FRONT = { x: 0, z: 1.8, heading: Math.PI };

test("full loop: ATM → shop → deck → buy → smash → sell → collection → home", async ({ page }) => {
  await startGame(page, "?latency=400", "01-intro");

  // 1. Spawn at the hotel side door, west end of the street.
  let s = await state(page);
  expect(s.zone).toBe("street");
  expect(s.balance).toBe("100000000");
  await expect(page.locator(".mission-text")).toHaveText(/Find a record/i);
  await expect(page.locator(".money-value")).toHaveText("100.00");
  // Player-facing copy reads like a normal game: no connection sticker, no chain jargon.
  await expect(page.locator("#hud .net-status")).toBeHidden();
  await expect(page.locator(".intro .net-status")).toHaveCount(0);
  await expect(page.locator("#hud .controls")).toContainText("Space");
  expect(await page.locator("#hud").innerText()).not.toMatch(/\b(sui|chain|testnet|wallet|digest)\b/i);
  await page.waitForTimeout(600);
  await shot(page, "02-street-spawn"); // looking east down the street towards Saisei Records

  // 1a. Jump (Space). Implemented in the world; just exercise it and take a picture.
  await page.evaluate(() => (window as any).__game.world.player.jump?.());
  await page.waitForTimeout(250);
  await shot(page, "02a-jump");

  // 1b. The ATM in TriMart's vestibule, next door: withdraw 50 FUSD (mock faucet under the hood).
  const dialog = page.locator("dialog.dlg[open]");
  await goTo(page, "atm");
  await expect(page.locator(".prompt-label")).toHaveText("ATM");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("ATM");
  await expect(dialog).toContainText("Balance 100.00 → 150.00");
  // The CRT greeting glitches on Gamer's real name, then resolves (flavour only).
  await expect(dialog.locator(".atm-crt")).toHaveText("ACCOUNT HOLDER: GAMER", { timeout: 5000 });
  expect(await dialog.innerText()).not.toMatch(/\b(sui|chain|testnet|wallet|digest|object|explorer|faucet|gas)\b/i);
  await expect(dialog.locator(".dlg-action:focus .dlg-action-label")).toHaveText("Withdraw 50");
  await shot(page, "02b-atm-menu");
  await page.keyboard.press("Enter"); // Withdraw
  await expect(dialog.locator(".pending")).toBeVisible();
  expect((await state(page)).op).toMatchObject({ kind: "withdraw", status: "pending" });
  await expect(page.locator(".money-pending")).toBeVisible();
  await expect(dialog.locator('[data-receipt-link="tx"]')).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveText("View receipt ↗");
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveAttribute("href", /^https:\/\/devxplorer\.io\/\?search=[1-9A-HJ-NP-Za-km-z]{44}&network=testnet$/);
  await expect(dialog).toContainText("CASH OUT");
  await expect(dialog).toContainText("+50.00 FUSD");
  s = await state(page);
  expect(s.op).toBeNull();
  expect(s.balance).toBe("150000000");
  await expect(page.locator(".money-value")).toHaveText("150.00"); // counted up
  await shot(page, "02c-atm-receipt");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await teleport(page, SHOP_FRONT); // in front of Saisei Records, facing the door

  // 2. Real keyboard walk through the door.
  await page.keyboard.down("KeyW");
  await until(page, (x) => x.zone === "shop", "walked into the shop", 40_000);
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  await shot(page, "03-shop-entrance");

  // 3. Record menu → Pick up.
  await goTo(page, `record:${RECORD}`);
  await expect(page.locator(".prompt-label")).toHaveText(/Low Tide Tapes/);
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Low Tide Tapes");
  await expect(dialog.locator(".rec-artist")).toContainText("#106/250");
  await expect(dialog.locator(".rec-price")).toHaveText("12.00 FUSD");
  await shot(page, "04-record-menu");
  await page.keyboard.press("Enter"); // "Pick up" is focused
  s = await until(page, (x) => x.hand?.shopRecordId === RECORD, "picked up");
  expect(s.hand?.recordId).toBeNull();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".held-status")).toHaveText(/UNPAID/);
  await page.waitForTimeout(400);
  await shot(page, "05-holding");

  // 4. Exit is blocked while unpaid: walk into the doorway from inside.
  await teleport(page, { x: 0, z: -1.6, heading: 0 });
  await page.keyboard.down("KeyW");
  await expect(page.locator(".toast", { hasText: "Pay for that first" })).toBeVisible({ timeout: 20_000 });
  await page.keyboard.up("KeyW");
  s = await state(page);
  expect(s.zone).toBe("shop");
  await shot(page, "09-exit-blocked");

  // 5. Deck: place → drop the needle → next track → take back.
  await goTo(page, "deck");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Turntable");
  await page.keyboard.press("Enter"); // place
  await until(page, (x) => x.deck?.shopRecordId === RECORD && x.hand === null, "on deck");
  await expect(dialog.locator(".dlg-action:focus")).toHaveText(/Drop the needle/);
  await shot(page, "06a-deck-menu");
  await page.keyboard.press("Enter"); // play
  s = await until(page, (x) => x.playing !== null, "playing");
  expect(s.playing?.trackIndex).toBe(0);
  await expect(page.locator(".now-playing")).toHaveAttribute("data-source", /synth|hls/, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot(page, "06-deck-playing");
  await page.keyboard.press("KeyN");
  await until(page, (x) => x.playing?.trackIndex === 1, "next track");
  await page.keyboard.press("KeyE");
  await chooseAction(page, /Take it back/);
  s = await until(page, (x) => x.hand?.shopRecordId === RECORD && x.playing === null, "took it back");
  expect(s.deck).toBeNull();

  // 6. Cashier: summary → pending → receipt.
  await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Low Tide Tapes");
  await page.keyboard.press("Enter"); // Pay
  await expect(dialog.locator(".pending")).toBeVisible();
  s = await state(page);
  expect(s.op).toMatchObject({ kind: "purchase", status: "pending" });
  await expect(page.locator(".money-pending")).toBeVisible();
  await shot(page, "07-purchase-pending");
  await expect(dialog.locator("[data-receipt-link]").first()).toBeVisible({ timeout: 20_000 });
  s = await state(page);
  expect(s.op).toBeNull();
  expect(s.hand?.recordId).toMatch(/^0x[0-9a-f]{64}$/);
  expect(s.owned[0]?.recordId).toBe(s.hand?.recordId);
  expect(s.balance).toBe("138000000"); // 150 after the ATM − 12
  await expect(dialog.locator(".dlg-title")).toHaveText(/領収 PAID/);
  await expect(dialog).toContainText("Low Tide Tapes · #106/250");
  await expect(dialog).toContainText("12.00 FUSD");
  await expect(dialog.locator("[data-receipt-link]")).toHaveCount(1);
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveText("View receipt ↗");
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveAttribute("href", /^https:\/\/devxplorer\.io\/\?search=[1-9A-HJ-NP-Za-km-z]{44}&network=testnet$/);
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveAttribute("target", "_blank");
  expect(await dialog.innerText()).not.toMatch(/\b(sui|chain|testnet|wallet|digest|object|minted|explorer|tx)\b/i);
  await page.waitForTimeout(1100); // money counter finishes counting down
  await shot(page, "08-receipt");
  const recordId = s.hand!.recordId!;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".held-status")).toHaveText(/OWNED · #106\/250/);

  // Collection lists the owned Record (read back from the adapter).
  await page.keyboard.press("KeyC");
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toBeVisible();
  await shot(page, "08b-collection-owned");
  await page.keyboard.press("Escape");

  // 7. Outside: the door is open now that it's paid for.
  await teleport(page, { x: 0, z: -1.6, heading: 0 });
  await page.keyboard.down("KeyW");
  await until(page, (x) => x.zone === "street", "walked out", 30_000);
  await page.keyboard.up("KeyW");
  await goTo(page, CAR);
  await expect(page.locator(".prompt-label")).toHaveText("Smash");
  await shot(page, "10-outside-holding");

  // 8. Smash.
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(450);
  await shot(page, "11-smash");
  await expect(page.locator(".big-toast")).toContainText("RECORD CONDITION: STILL MINT", { timeout: 15_000 });
  await shot(page, "12-mint-toast");
  s = await state(page);
  expect(s.smashedCars).toContain(CAR);
  expect(await page.evaluate((id) => (window as any).__game.world.getInteractable(id).enabled, CAR)).toBe(false);

  // 9. Sell to Stonks at his BUYING table across the street.
  await goTo(page, "buyer:collector");
  await expect(page.locator(".prompt-label")).toHaveText("Sell to Stonks");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Stonks wants it");
  await expect(dialog).toContainText("18.00 FUSD");
  await expect(dialog).toContainText("for Low Tide Tapes");
  await shot(page, "13-buyer-offer");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".pending")).toBeVisible();
  expect((await state(page)).op).toMatchObject({ kind: "sell", status: "pending" });
  await shot(page, "14-sell-pending");
  await expect(dialog.locator(".dlg-title")).toHaveText(/済 SOLD/, { timeout: 20_000 });
  await expect(dialog).toContainText("+18.00 FUSD");
  await expect(dialog.locator('[data-receipt-link="tx"]')).toHaveAttribute("href", /^https:\/\/devxplorer\.io\/\?search=[1-9A-HJ-NP-Za-km-z]{44}&network=testnet$/);
  await shot(page, "15-sold-cash");
  await page.keyboard.press("Enter"); // OK
  await expect(dialog).toHaveCount(0);
  s = await until(page, (x) => x.sold.length === 1 && x.op === null, "sold");
  expect(s.balance).toBe("156000000");
  expect(s.hand).toBeNull();
  expect(s.owned.find((o) => o.recordId === recordId)).toBeUndefined();
  await expect(page.locator(".money-value")).toHaveText("156.00");

  // 10. Collection: the sale shows in history, the Record is gone from the wallet.
  await page.keyboard.press("KeyC");
  await expect(dialog.locator(".coll-sold-row")).toContainText("Low Tide Tapes");
  await expect(dialog.locator(`.coll-item[data-record-id="${recordId}"]`)).toHaveCount(0);
  await shot(page, "16-collection");
  await page.keyboard.press("Escape");
  await expect(page.locator(".mission-text")).toHaveText(/Head home with Inicio/);
  await page.keyboard.press("KeyH");
  await expect(dialog.locator(".help")).toBeVisible();
  await expect(dialog.locator(".dlg-action", { hasText: /Reset demo/ })).toBeEnabled();
  await shot(page, "17-help");
  await page.keyboard.press("Escape");

  // 10b. Exit beat: head home with Inicio → the boom → title card → "Home."
  await expect(page.locator(".mission-text")).toHaveText(/Head home with Inicio/);
  await goTo(page, "home");
  await expect(page.locator(".prompt-label")).toHaveText("Head home with Inicio");
  await page.keyboard.press("KeyE");
  const card = page.locator(".title-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText("Dawn of the Machin");
  await expect(card).toContainText("Tamashi and Nozomi © Studio Mirai");
  expect(await page.evaluate(() => (window as any).__game.state().wentHome)).toBe(true);
  await page.waitForTimeout(1700); // fade-in
  await shot(page, "17b-title-card");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.locator(".mission-text")).toHaveText(/Home/);
  await expect(page.locator(".mission-text")).toHaveText(/Press H to reset/);
  // Still free to walk, and the door is closed again.
  expect(await page.evaluate(() => (window as any).__game.world.getInteractable("home").enabled)).toBe(false);

  // 11. Repeatable demo: ~20 s after the sale Stonks walks back to the spot and
  // the sold release is back on the shelf (no reload needed for a second run).
  await page.waitForFunction(() => (window as any).__game.state().buyerAway === null, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window as any).__game.world.getInteractable("buyer:collector").enabled, null, { timeout: 300_000 });
  await goTo(page, "buyer:collector");
  await expect(page.locator(".prompt-label")).toHaveText("Talk to Stonks");
  await page.waitForTimeout(800);
  await shot(page, "18-collector-returned");

  expect(pageErrors(page)).toEqual([]);
});

test("purchase failure shows Retry; retry succeeds once the chain recovers; sell retry too", async ({ page }) => {
  await startGame(page, "?latency=300&fail=purchase");
  await teleport(page, { x: 0, z: -2, heading: Math.PI });
  await goTo(page, `record:${RECORD}`);
  await page.keyboard.press("KeyE");
  await page.keyboard.press("Enter");
  await until(page, (x) => x.hand?.shopRecordId === RECORD, "picked");

  await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await page.keyboard.press("Enter"); // Pay
  const dialog = page.locator("dialog.dlg[open]");
  await expect(dialog.locator(".err-msg")).toContainText("Register jammed", { timeout: 15_000 });
  let s = await state(page);
  expect(s.op).toMatchObject({ kind: "purchase", status: "error" });
  expect(s.hand?.recordId).toBeNull();
  expect(s.balance).toBe("100000000");
  await expect(dialog.locator(".dlg-action:focus")).toHaveText(/Retry/);
  await shot(page, "err-01-purchase-failed");

  await page.evaluate(() => (window as any).__game.setFailureMode("none"));
  await page.keyboard.press("Enter"); // Retry
  await expect(dialog.locator("[data-receipt-link]").first()).toBeVisible({ timeout: 15_000 });
  s = await state(page);
  expect(s.hand?.recordId).toMatch(/^0x/);
  await shot(page, "err-02-retry-receipt");
  await page.keyboard.press("Escape");

  // Sell: fail once, then Retry succeeds.
  await teleport(page, SHOP_FRONT);
  await until(page, (x) => x.zone === "street", "outside");
  await goTo(page, "buyer:collector");
  await page.evaluate(() => (window as any).__game.failNext("sell"));
  await page.keyboard.press("KeyE");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".err-msg")).toContainText("You still own it", { timeout: 15_000 });
  expect((await state(page)).op).toMatchObject({ kind: "sell", status: "error" });
  await shot(page, "err-03-sell-failed");
  await page.keyboard.press("Enter"); // Retry
  s = await until(page, (x) => x.sold.length === 1, "sold after retry");
  expect(s.balance).toBe("106000000");
  await shot(page, "err-04-sell-retry-sold");
  expect(pageErrors(page)).toEqual([]);
});

test("ATM withdraw failure shows Retry; retry succeeds once the faucet recovers", async ({ page }) => {
  await startGame(page, "?latency=300&fail=withdraw");
  await goTo(page, "atm");
  await page.keyboard.press("KeyE");
  const dialog = page.locator("dialog.dlg[open]");
  await expect(dialog.locator(".dlg-title")).toHaveText("ATM");
  await page.keyboard.press("Enter"); // Withdraw 50
  await expect(dialog.locator(".err-msg")).toContainText("Card reader jammed", { timeout: 15_000 });
  let s = await state(page);
  expect(s.op).toMatchObject({ kind: "withdraw", status: "error" });
  expect(s.balance).toBe("100000000");
  await expect(dialog.locator(".dlg-action:focus")).toHaveText(/Retry/);
  await shot(page, "err-05-atm-failed");

  await page.evaluate(() => (window as any).__game.setFailureMode("none"));
  await page.keyboard.press("Enter"); // Retry
  await expect(dialog.locator('[data-receipt-link="tx"]')).toBeVisible({ timeout: 15_000 });
  s = await state(page);
  expect(s.op).toBeNull();
  expect(s.balance).toBe("150000000");
  await shot(page, "err-06-atm-retry-receipt");
  expect(pageErrors(page)).toEqual([]);
});
