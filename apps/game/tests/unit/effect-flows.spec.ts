/**
 * Flows as Effects (docs/EFFECT.md step 5): what happens on the paths the port added.
 * A bug (defect) inside a transaction ends in that op's error + Retry with its own copy,
 * closing the app scope never leaves a transaction pending, and the error boundary keeps
 * a throwing world callback out of the render loop.
 *
 * Same harness as input-routing.spec.ts (tests/unit/harness/game-entry.ts, window.__h).
 */
import { expect, test, type Page } from "@playwright/test";
import { TIMEOUT_MESSAGE } from "../../src/app/errors";
import { JAMMED_TOAST } from "../../src/app/boundary";
import { RECORD, START, dialogText, focusedAction, openPay, pickUp, snap, startGame, toasts } from "./harness/game";

/** console.error lines from the page (the boundary logs "[app] <context>"). */
function consoleErrors(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") lines.push(m.text());
  });
  return lines;
}

const invariantWarnings = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as any).__h.warnings as string[]).filter((w) => w.includes("invariant broken")));

const balance = (page: Page) => snap(page).then((s) => (s.balance === null ? null : BigInt(s.balance)));

test.describe("flows as Effects", () => {
  test("a defect in the purchase (adapter resolves garbage) ends in purchase error with 'Register jammed. Try again.'", async ({ page }) => {
    const errors = consoleErrors(page);
    await startGame(page);
    // A wrapped bug: the adapter resolves without a result, so reading it throws inside the flow.
    await page.evaluate(() => {
      (window as any).__h.adapter.purchase = () => Promise.resolve(null);
    });
    await pickUp(page);
    await openPay(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => snap(page).then((s) => s.op?.status)).toBe("error");
    const s = await snap(page);
    expect(s.op).toMatchObject({ kind: "purchase", status: "error", error: "Register jammed. Try again." });
    expect(s.hand).toEqual({ shopRecordId: RECORD, recordId: null });
    expect(s.ownedIds).toEqual([]);
    expect(await dialogText(page)).toContain("Register jammed. Try again.");
    expect(await focusedAction(page)).toBe("retry");
    expect(await balance(page)).toBe(START);
    expect(await invariantWarnings(page)).toEqual([]);
    expect(errors.some((e) => e.startsWith("[app] purchase"))).toBe(true);
    expect((await toasts(page)).some((t) => t.includes(JAMMED_TOAST))).toBe(true);
  });

  test("a synchronous non-Error throw from adapter.purchase shows its text, as before the port", async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
      (window as any).__h.adapter.purchase = () => {
        throw "register on fire";
      };
    });
    await pickUp(page);
    await openPay(page);
    await page.keyboard.press("Enter");
    await expect.poll(() => snap(page).then((s) => s.op?.status)).toBe("error");
    expect((await snap(page)).op).toMatchObject({ kind: "purchase", status: "error", error: "register on fire" });
    expect(await invariantWarnings(page)).toEqual([]);
  });

  test("a defect in the withdrawal ends in withdraw error with 'Card reader jammed. Try again.'", async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
      (window as any).__h.adapter.withdrawFakeUsd = () => Promise.resolve(undefined);
    });
    await page.evaluate(() => {
      const h = (window as any).__h;
      h.stand("atm");
      h.interact();
    });
    await page.keyboard.press("Enter");
    await expect.poll(() => snap(page).then((s) => s.op?.status)).toBe("error");
    expect((await snap(page)).op).toMatchObject({ kind: "withdraw", status: "error", error: "Card reader jammed. Try again." });
    expect(await dialogText(page)).toContain("Card reader jammed. Try again.");
    expect(await invariantWarnings(page)).toEqual([]);
  });

  test("closing the app scope mid-purchase: op = purchase error with the timeout copy, hand unchanged", async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => (window as any).__h.adapter.setLatency(60_000));
    await pickUp(page);
    await openPay(page);
    await page.keyboard.press("Enter");
    // The pending screen swapped in within the key press.
    expect((await snap(page)).op).toMatchObject({ kind: "purchase", status: "pending" });
    const before = (await snap(page)).hand;
    await page.evaluate(() => (window as any).__ui.closeScope());
    const s = await snap(page);
    expect(s.op).toMatchObject({ kind: "purchase", status: "error", error: TIMEOUT_MESSAGE });
    expect(s.hand).toEqual(before);
    expect(s.hand).toEqual({ shopRecordId: RECORD, recordId: null });
    expect(s.ownedIds).toEqual([]);
    expect(await balance(page)).toBe(START);
    expect(await invariantWarnings(page)).toEqual([]);
  });

  test("the boundary guards a throwing world.onMove: reported, not rethrown, one toast", async ({ page }) => {
    const errors = consoleErrors(page);
    await startGame(page);
    const result = await page.evaluate(() => {
      const h = (window as any).__h;
      // onMove → updateWaypoint → world.getPlayer(): make the app layer throw.
      h.world.getPlayer = () => {
        throw new Error("player went missing");
      };
      const thrown: unknown[] = [];
      const returned: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        try {
          returned.push(h.world.onMove(1, 2, 0));
        } catch (error) {
          thrown.push(String(error));
        }
      }
      return { thrown, allUndefined: returned.every((r) => r === undefined) };
    });
    expect(result.thrown).toEqual([]);
    expect(result.allUndefined).toBe(true);
    expect((await toasts(page)).filter((t) => t.includes(JAMMED_TOAST))).toHaveLength(1);
    await expect.poll(() => errors.filter((e) => e.startsWith("[app] world.onMove")).length).toBe(3);
  });
});
