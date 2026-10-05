import { expect, test } from "@playwright/test";

const EXAMPLE_COLLECTOR = "0xad69173b206b5c0be6a83f6e6cde2a282d2ada46c4c81ab491b0fdc646e5795f";
// Media comes from the CDN, or from the Walrus aggregator when the CDN does not host it.
const MEDIA_HOST = /cdn\.miso\.fm|aggregator\.walrus-testnet\.walrus\.space/;

test("home shows release cards with covers", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("a.card").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator(".card-title")).not.toBeEmpty();
  const cover = card.locator("img");
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
});

test("release page lists tracks with durations", async ({ page }) => {
  await page.goto("/");
  await page.locator("a.card").first().click();
  await expect(page).toHaveURL(/\/release\/0x/);
  const firstTrack = page.locator(".track").first();
  await expect(firstTrack).toBeVisible({ timeout: 20_000 });
  await expect(firstTrack.locator(".track-duration")).toHaveText(/^\d+:\d{2}$/);
});

test("play streams the HLS preview", async ({ page }) => {
  await page.goto("/");
  await page.locator("a.card").first().click();
  await expect(page.locator(".track").first()).toBeVisible({ timeout: 20_000 });

  const manifest = page.waitForRequest((req) => MEDIA_HOST.test(req.url()) && req.url().endsWith("/aac-96.m3u8"));
  const segment = page.waitForResponse((res) => MEDIA_HOST.test(res.url()) && /\.m4s(\?|$)/.test(res.url()) && res.ok());
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await manifest;
  await segment;

  const canDecodeAac = await page.evaluate(() => MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'));
  if (!canDecodeAac) {
    test.info().annotations.push({ type: "note", description: "No AAC decoder in this browser; checked network only." });
    return;
  }
  const audio = page.locator("audio");
  const start = await audio.evaluate((el: HTMLAudioElement) => el.currentTime);
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime), { timeout: 15_000 }).toBeGreaterThan(start + 1);
  expect(await audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false);
});

test("collection shows records for the example wallet", async ({ page }) => {
  await page.goto(`/collection?address=${EXAMPLE_COLLECTOR}`);
  await expect(page.locator(".record-card").first()).toBeVisible({ timeout: 20_000 });
});
