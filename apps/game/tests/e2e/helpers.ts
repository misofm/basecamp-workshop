/**
 * Shared helpers for the e2e tests: start the game, read state, wait for things,
 * save numbered screenshots. Everything goes through `window.__game` (src/debug.ts).
 */
import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const SHOTS =
  process.env.SHOTS_DIR ??
  new URL("../../test-results/shots-loop", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

/** A JSON-safe slice of GameState (bigints as strings). */
export interface StateView {
  zone: string;
  hand: { shopRecordId: string; recordId: string | null } | null;
  deck: { shopRecordId: string; recordId: string | null } | null;
  playing: { trackIndex: number } | null;
  owned: { recordId: string; shopRecordId: string; serial: number }[];
  sold: { recordId: string; paid: string | null }[];
  smashedCars: string[];
  balance: string | null;
  op: { kind: string; status: string; error?: string } | null;
  near: string | null;
}

export async function state(page: Page): Promise<StateView> {
  return page.evaluate(() => {
    const g = (window as any).__game;
    const s = g.state();
    return {
      zone: s.zone,
      hand: s.hand,
      deck: s.deck,
      playing: s.playing,
      owned: s.owned.map((o: any) => ({ recordId: o.recordId, shopRecordId: o.shopRecordId, serial: o.serial })),
      sold: s.sold.map((x: any) => ({ recordId: x.recordId, paid: x.paid?.toString() ?? null })),
      smashedCars: s.smashedCars,
      balance: s.balance === null ? null : s.balance.toString(),
      op: s.op,
      near: g.controller.near?.id ?? null,
    };
  });
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 120_000, animations: "disabled" });
}

/** Load the page, wait for catalog + wallet, press Enter on the intro. */
export async function startGame(page: Page, query: string, introShot?: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await page.goto(`/${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.gameReady === "true", null, { timeout: 60_000 });
  await expect(page.locator(".intro")).toBeVisible();
  // catalog + cash + the street (GPU pipelines compiled; Enter waits for it).
  await expect(page.locator(".intro-status .st-ok")).toHaveCount(3, { timeout: 120_000 });
  // Let the character load and a few frames render (shader compiles are slow on SwiftShader).
  await page.waitForFunction(() => document.documentElement.dataset.character !== undefined, null, { timeout: 120_000 });
  await frames(page, 4);
  if (introShot) await shot(page, introShot);
  await page.keyboard.press("Enter");
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 5000 });
}

/** Wait until the page has rendered `n` more animation frames. */
export async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

export function pageErrors(page: Page): string[] {
  return (page as any).__errors ?? [];
}

export async function teleport(page: Page, target: string | { x: number; z: number; heading?: number }): Promise<void> {
  const ok = await page.evaluate((t) => (window as any).__game.teleportTo(t), target);
  expect(ok, `teleport target ${JSON.stringify(target)}`).toBe(true);
}

/** Teleport next to an interactable and wait until the world reports it as near. */
export async function goTo(page: Page, id: string): Promise<void> {
  await teleport(page, id);
  await page.waitForFunction((want) => (window as any).__game.controller.near?.id === want, id);
  await expect(page.locator(".prompt")).toBeVisible();
}

export async function until(page: Page, predicate: (s: StateView) => boolean, message: string, timeout = 20_000): Promise<StateView> {
  const start = Date.now();
  for (;;) {
    const s = await state(page);
    if (predicate(s)) return s;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${message}\nstate: ${JSON.stringify(s)}`);
    await page.waitForTimeout(100);
  }
}

/** Focus the dialog action with this label (keyboard ↓ until it is focused) and press Enter. */
export async function chooseAction(page: Page, label: RegExp): Promise<void> {
  const dialog = page.locator("dialog.dlg[open]");
  await expect(dialog).toBeVisible();
  const target = dialog.locator(".dlg-action", { hasText: label });
  await expect(target).toBeEnabled();
  for (let i = 0; i < 12; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`Could not focus dialog action ${label}`);
}
