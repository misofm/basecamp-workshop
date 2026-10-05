/**
 * Screenshots of every UI moment in docs/UI-STYLE.md (1600×900, mock mode), named by moment.
 *   SHOTS_DIR=/some/dir npx playwright test tests/e2e/ui-shots.spec.ts
 * Also asserts the U toggle: everything hidden, the 3D world kept, dialogs unaffected.
 */
import { expect, test } from "@playwright/test";
import { chooseAction, goTo, shot, startGame, teleport, until } from "./helpers";

const RECORD = "low-tide-tapes";

test("ui moments", async ({ page }) => {
  await page.goto("/?chain=mock&latency=2500");
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === "true", null, { timeout: 60_000 });
  await expect(page.locator(".intro[data-ready='true'] .intro-start")).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(600);
  await shot(page, "01-intro");
  await page.keyboard.press("Enter");
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 5000 });
  const dialog = page.locator("dialog.dlg[open]");

  await page.waitForTimeout(800);
  await shot(page, "13-hud-street");

  // ATM
  await goTo(page, "atm");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".atm-crt")).toHaveText("ACCOUNT HOLDER: GAMER", { timeout: 5000 });
  await page.waitForTimeout(300);
  await shot(page, "02-atm");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".pending")).toBeVisible();
  await expect(dialog.locator('[data-receipt-link="tx"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot(page, "03-atm-done");
  await page.keyboard.press("Enter");

  // Record tag
  await teleport(page, { x: 0, z: -2, heading: Math.PI });
  await goTo(page, `record:${RECORD}`);
  await page.keyboard.press("KeyE");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, "04-record-tag");
  await page.keyboard.press("Enter");
  await until(page, (x) => x.hand?.shopRecordId === RECORD, "picked up");

  // Turntable
  await goTo(page, "deck");
  await page.keyboard.press("KeyE");
  await page.keyboard.press("Enter"); // put it on
  await until(page, (x) => x.deck?.shopRecordId === RECORD, "on deck");
  await page.keyboard.press("Enter"); // drop the needle (closes)
  await until(page, (x) => x.playing !== null, "playing");
  await page.waitForTimeout(800);
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Now playing");
  await page.waitForTimeout(300);
  await shot(page, "05-turntable");
  await chooseAction(page, /Lift needle/);
  await chooseAction(page, /Take it back/);
  await until(page, (x) => x.hand?.shopRecordId === RECORD && x.deck === null, "took it back");

  // Counter, paying, receipt
  await goTo(page, "cashier");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Low Tide Tapes");
  await page.waitForTimeout(300);
  await shot(page, "06-counter");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".pending")).toBeVisible();
  await page.waitForTimeout(700);
  await shot(page, "07-paying");
  await expect(dialog.locator("[data-receipt-link]")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await shot(page, "08-receipt");
  await page.keyboard.press("Enter");

  // Collection while holding the new record.
  await page.keyboard.press("KeyC");
  await expect(dialog.locator(".coll-item")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await shot(page, "11-collection");
  await page.keyboard.press("Escape");

  // Sell
  await teleport(page, { x: 0, z: -1.6, heading: 0 });
  await page.keyboard.down("KeyW");
  await until(page, (x) => x.zone === "street", "outside", 30_000);
  await page.keyboard.up("KeyW");
  await goTo(page, "car:0");
  await page.keyboard.press("KeyE");
  await expect(page.locator(".big-toast")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot(page, "09a-smash-banner");
  await goTo(page, "buyer:collector");
  await page.keyboard.press("KeyE");
  await expect(dialog.locator(".dlg-title")).toHaveText("Stonks wants it");
  await page.waitForTimeout(300);
  await shot(page, "09-stonks-offer");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".dlg-title")).toHaveText(/済 SOLD/, { timeout: 20_000 });
  await page.waitForTimeout(500);
  await shot(page, "10-sold");
  await page.keyboard.press("Enter");

  await page.keyboard.press("KeyH");
  await expect(dialog.locator(".help")).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, "12-help");
  await page.keyboard.press("Escape");

  // U: hide everything, keep the world; dialogs ignore U.
  await page.keyboard.press("KeyU");
  await expect(page.locator("#hud")).toBeHidden();
  await expect(page.locator(".minimap")).toBeHidden();
  await expect(page.locator(".prompt")).toBeHidden();
  await page.waitForTimeout(500);
  await shot(page, "15-ui-hidden");
  await page.keyboard.press("KeyH");
  await expect(dialog.locator(".help")).toBeVisible();
  await page.keyboard.press("KeyU");
  await expect(dialog.locator(".help")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#hud")).toBeHidden(); // back to hidden after the dialog
  await page.keyboard.press("KeyU");
  await expect(page.locator("#hud")).toBeVisible();
});

test("error moment", async ({ page }) => {
  await startGame(page, "?chain=mock&latency=300&fail=withdraw");
  await goTo(page, "atm");
  await page.keyboard.press("KeyE");
  const dialog = page.locator("dialog.dlg[open]");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".err-msg")).toContainText("Card reader jammed", { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, "14-error");
});

test("?ui=0 shows the loading screen, then starts hidden", async ({ page }) => {
  await page.goto("/?chain=mock&ui=0");
  await expect(page.locator(".intro[data-ready='true'] .intro-start")).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator("#hud")).toBeHidden();
  await page.keyboard.press("KeyU");
  await expect(page.locator("#hud")).toBeVisible();
});
