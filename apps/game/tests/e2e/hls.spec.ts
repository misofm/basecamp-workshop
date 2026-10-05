/**
 * Real audio in the game: with ?mockhls=1 every track streams a real testnet HLS
 * quilt from cdn.miso.fm. Needs network access to cdn.miso.fm and a Chromium with
 * AAC (the Playwright bundle has it). Checks the HUD says HLS and that the deck's
 * <audio> element is actually advancing from the middle of the track.
 */
import { expect, test } from "@playwright/test";
import { goTo, pageErrors, startGame, teleport, until } from "./helpers";

const RECORD = "low-tide-tapes";

interface DeckDebug {
  kind: "hls" | "synth" | null;
  windowStart: number | null;
  currentTime: number | null;
  duration: number | null;
  paused: boolean | null;
}

const deckDebug = (page: import("@playwright/test").Page): Promise<DeckDebug> =>
  page.evaluate(() => (window as any).__game.deckDebug());

test("HLS preview streams from mid-track and advances", async ({ page }) => {
  await startGame(page, "?chain=mock&mockhls=1&latency=200&quality=low");
  expect(await page.evaluate(() => document.documentElement.dataset.quality)).toBe("low");

  // Pick the record.
  await teleport(page, { x: 0, z: -2, heading: Math.PI });
  await goTo(page, `record:${RECORD}`);
  await page.keyboard.press("KeyE");
  await page.keyboard.press("Enter"); // Pick up
  await until(page, (s) => s.hand?.shopRecordId === RECORD, "picked up");

  // Deck: place → drop the needle.
  await goTo(page, "deck");
  await page.keyboard.press("KeyE");
  const dialog = page.locator("dialog.dlg[open]");
  await expect(dialog.locator(".dlg-title")).toHaveText("The listening deck.");
  await page.keyboard.press("Enter"); // place
  await until(page, (s) => s.deck?.shopRecordId === RECORD, "on deck");
  await expect(dialog.locator(".dlg-action:focus")).toHaveText(/Drop the needle/);
  await page.keyboard.press("Enter"); // play
  await until(page, (s) => s.playing !== null, "playing");

  // The HUD badge switches from LOADING to HLS once sound starts.
  await expect(page.locator(".np-badge")).toHaveText("HLS", { timeout: 60_000 });

  const first = await deckDebug(page);
  expect(first.kind).toBe("hls");
  expect(first.windowStart).not.toBeNull();
  // The preview window starts mid-track (141 s quilt → ~55 s in), not at 0.
  expect(first.windowStart!).toBeGreaterThan(20);
  expect(first.currentTime!).toBeGreaterThanOrEqual(first.windowStart! - 0.5);

  // Media time keeps moving past the window start.
  await expect
    .poll(async () => (await deckDebug(page)).currentTime ?? 0, { timeout: 60_000, intervals: [500] })
    .toBeGreaterThan(first.windowStart! + 2);
  const later = await deckDebug(page);
  expect(later.kind).toBe("hls");
  expect(later.paused).toBe(false);
  expect(later.currentTime!).toBeGreaterThan(first.currentTime!);

  expect(pageErrors(page)).toEqual([]);
});
