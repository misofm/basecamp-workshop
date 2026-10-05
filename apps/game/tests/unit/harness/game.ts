/**
 * Node-side helpers for input-routing.spec.ts: bundle the browser entries once, load them
 * into a blank page, and a few player-like steps (start the game, pick up, pay...).
 * Everything here talks to the page through `window.__h` (harness/game-entry.ts).
 */
import { expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const cache = new Map<string, Promise<string>>();

/** Bundle a browser entry (IIFE) with the same `import.meta.env` the dev build sees. */
export function bundle(entry: string): Promise<string> {
  let p = cache.get(entry);
  if (!p) {
    p = build({
      entryPoints: [path.join(process.cwd(), "tests/unit/harness", entry)],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      logLevel: "silent",
      define: { "import.meta.env": JSON.stringify({ DEV: true }) },
    }).then((out) => out.outputFiles[0]!.text);
    cache.set(entry, p);
  }
  return p;
}

/** Blank page with the UI kit (`window.__ui`) loaded; nothing constructed yet. */
export async function loadUi(page: Page): Promise<void> {
  await page.setContent(`<!doctype html><html><body><button id="outside">outside</button><div id="app"></div></body></html>`);
  await page.addScriptTag({ content: await bundle("game-entry.ts") });
}

/** Build the game, let boot() finish, then start it the way a player does (ready → Enter). */
export async function startGame(page: Page, opts: { latencyMs?: number } = {}): Promise<void> {
  await loadUi(page);
  await page.evaluate(async (o) => {
    const h = (window as any).__ui.makeGame(o);
    await h.booted;
    h.intro.setReady();
  }, opts);
  await page.keyboard.press("Enter");
  await expect.poll(() => snap(page).then((s) => s.started)).toBe(true);
  // The intro button kept focus; the world ignores E on a focused button (like world.ts).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

export type Snapshot = {
  balance: string | null;
  hand: { shopRecordId: string; recordId: string | null } | null;
  deck: unknown;
  op: { kind: string; status: string; error?: string } | null;
  ownedIds: string[];
  sold: { recordId: string; paid: string }[];
  smashedCars: string[];
  wentHome: boolean;
  openKey: string | null;
  titleCard: boolean;
  started: boolean;
};

export const snap = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).__h.snapshot());
export const openKey = (page: Page) => snap(page).then((s) => s.openKey);
export const stand = (page: Page, id: string | null) => page.evaluate((i) => (window as any).__h.stand(i), id);
export const interact = (page: Page) => page.evaluate(() => (window as any).__h.interact());
export const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__h.toasts());
export const actions = (page: Page): Promise<{ id: string; disabled: boolean }[]> => page.evaluate(() => (window as any).__h.actions());
export const focusedAction = (page: Page): Promise<string | null> => page.evaluate(() => (window as any).__h.focusedAction());
export const dialogText = (page: Page): Promise<string> => page.evaluate(() => (window as any).__h.dialogText());
export const calls = (page: Page): Promise<{ purchase: number; sellToNpc: number; withdrawFakeUsd: number }> =>
  page.evaluate(() => ({ ...(window as any).__h.calls }));
export const uiFlag = (page: Page) => page.evaluate(() => document.documentElement.dataset.ui);

/** Dispatch a synthetic keydown on window target (document.activeElement); returns defaultPrevented. */
export function keydown(page: Page, init: KeyboardEventInit & { code: string }): Promise<boolean> {
  return page.evaluate((i) => {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...i });
    (document.activeElement ?? document.body).dispatchEvent(e);
    return e.defaultPrevented;
  }, init);
}

export const RECORD = "low-tide-tapes";
export const PRICE = 12_000_000n;
export const START = 100_000_000n;

export async function waitIdle(page: Page): Promise<void> {
  await expect.poll(() => snap(page).then((s) => s.op?.status ?? "idle")).not.toBe("pending");
}

/** Walk to a record, E, Enter on "Pick up". */
export async function pickUp(page: Page, id = RECORD): Promise<void> {
  await stand(page, `record:${id}`);
  await interact(page);
  expect(await openKey(page)).toBe("record");
  expect(await focusedAction(page)).toBe("pick");
  await page.keyboard.press("Enter");
  expect((await snap(page)).hand?.shopRecordId).toBe(id);
  expect(await openKey(page)).toBeNull();
}

/** At the counter with unpaid stock: E → the Pay screen (Pay focused). */
export async function openPay(page: Page): Promise<void> {
  await stand(page, "cashier");
  await interact(page);
  expect(await openKey(page)).toBe("purchase");
  expect(await focusedAction(page)).toBe("pay");
}

/** Pick up, pay, wait for the receipt, close it: holding an owned Record. */
export async function buyOne(page: Page, id = RECORD): Promise<void> {
  await pickUp(page, id);
  await openPay(page);
  await page.keyboard.press("Enter");
  await waitIdle(page);
  expect((await snap(page)).hand?.recordId).toBeTruthy();
  if (await openKey(page)) await page.keyboard.press("Escape");
}

/** Holding an owned Record: sell it to Stonks and close the result. */
export async function sellHeld(page: Page): Promise<void> {
  await stand(page, "buyer:collector");
  await interact(page);
  expect(await openKey(page)).toBe("sell");
  await page.keyboard.press("Enter");
  await waitIdle(page);
  expect((await snap(page)).sold.length).toBeGreaterThan(0);
  if (await openKey(page)) await page.keyboard.press("Escape");
}
