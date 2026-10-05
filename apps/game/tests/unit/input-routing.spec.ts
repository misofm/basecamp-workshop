/**
 * Input routing: which UI layer owns the keyboard (docs/STATE-MODEL.md §2) and the
 * transaction rules that depend on it (§3), in a real headless-Chromium DOM.
 *
 * The real game modules are bundled with esbuild and injected into a blank page. All the
 * wiring (real controller + dialogs + HUD + intro + title card + MockAdapter, fake world /
 * deck / ambience / minimap) lives in ONE place: tests/unit/harness/game-entry.ts
 * (`makeGame()`), exposed as `window.__h`. The assertions only look at the DOM, the
 * <html data-ui> flag, controller.state (via a JSON snapshot) and the fakes' records.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  START,
  PRICE,
  RECORD,
  actions,
  buyOne,
  bundle,
  calls,
  dialogText,
  focusedAction,
  interact,
  keydown,
  loadUi,
  openKey,
  openPay,
  pickUp,
  sellHeld,
  snap,
  stand,
  startGame,
  toasts,
  uiFlag,
  waitIdle,
} from "./harness/game";

const SWALLOWED = ["KeyE", "Enter", "Space", "KeyC", "KeyH", "KeyW", "Escape"];
const SHORTCUTS = [{ code: "F5" }, { code: "F11" }, { code: "KeyR", ctrlKey: true }, { code: "KeyR", metaKey: true }];
const OFFER = (PRICE * 3n) / 2n; // Stonks pays 1.5× the shop price
const WITHDRAW = 50_000_000n;

/** A bubbling window keydown listener = "the game" for the overlay tests. */
async function listenAsGame(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.seen = [];
    window.addEventListener("keydown", (e) => w.seen.push(e.code));
  });
}
const seen = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).seen);

// ═════════════════════════════ 1. Loading screen ═════════════════════════════

test.describe("loading screen (Intro)", () => {
  test.beforeEach(async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
      const w = window as any;
      w.starts = 0;
      w.intro = new w.__ui.Intro(document.getElementById("app"), "mock");
      w.intro.onStart = () => w.starts++;
    });
    await listenAsGame(page);
  });
  const starts = (page: Page) => page.evaluate(() => (window as any).starts as number);

  test("before ready: every key is swallowed and Enter does not start", async ({ page }) => {
    for (const k of SWALLOWED) await page.keyboard.press(k);
    expect(await seen(page)).toEqual([]);
    expect(await starts(page)).toBe(0);
    for (const code of SWALLOWED) expect(await keydown(page, { code }), code).toBe(true);
    expect(await seen(page)).toEqual([]);
  });

  test("after ready: Enter starts exactly once; auto-repeat never starts", async ({ page }) => {
    await page.evaluate(() => (window as any).intro.setReady());
    await keydown(page, { code: "Enter", key: "Enter", repeat: true });
    expect(await starts(page)).toBe(0);
    await page.keyboard.press("Enter");
    expect(await starts(page)).toBe(1);
    await page.keyboard.press("Enter");
    await keydown(page, { code: "Enter", key: "Enter", repeat: true });
    expect(await starts(page)).toBe(1);
  });

  test("browser shortcuts keep their default but never reach the game; other keys are prevented", async ({ page }) => {
    for (const ready of [false, true]) {
      if (ready) await page.evaluate(() => (window as any).intro.setReady());
      for (const s of SHORTCUTS) expect(await keydown(page, s), JSON.stringify(s)).toBe(false);
      expect(await keydown(page, { code: "KeyW" })).toBe(true);
      expect(await seen(page)).toEqual([]);
    }
    expect(await starts(page)).toBe(0);
  });
});

// ═════════════════════════════ 2. Title card ═════════════════════════════

test.describe("title card", () => {
  test.beforeEach(async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
      const w = window as any;
      w.resolved = 0;
      w.card = new w.__ui.TitleCard(document.getElementById("app"));
      w.card.show().then(() => w.resolved++);
    });
    await listenAsGame(page);
  });
  const state = (page: Page) =>
    page.evaluate(async () => {
      await Promise.resolve();
      const w = window as any;
      return { open: w.card.isOpen as boolean, resolved: w.resolved as number };
    });

  test("swallows every key; non-dismiss keys keep it up", async ({ page }) => {
    for (const k of ["KeyE", "KeyC", "KeyH", "KeyW", "KeyI", "KeyU"]) await page.keyboard.press(k);
    expect(await seen(page)).toEqual([]);
    expect(await state(page)).toEqual({ open: true, resolved: 0 });
  });

  for (const key of ["Enter", "Space", "Escape"]) {
    test(`${key} dismisses and resolves show()`, async ({ page }) => {
      await page.keyboard.press(key);
      await expect.poll(() => state(page)).toEqual({ open: false, resolved: 1 });
      expect(await seen(page)).toEqual([]);
    });
  }

  test("click dismisses", async ({ page }) => {
    await page.click(".title-card");
    await expect.poll(() => state(page)).toEqual({ open: false, resolved: 1 });
  });

  test("auto-repeat is ignored; shortcuts are not prevented and not seen", async ({ page }) => {
    for (const code of ["Enter", "Space", "Escape"]) await keydown(page, { code, repeat: true });
    expect(await state(page)).toEqual({ open: true, resolved: 0 });
    for (const s of SHORTCUTS) expect(await keydown(page, s), JSON.stringify(s)).toBe(false);
    expect(await keydown(page, { code: "KeyA" })).toBe(true);
    expect(await seen(page)).toEqual([]);
  });

  test("show() while open does not stack a second card", async ({ page }) => {
    await page.evaluate(() => (window as any).card.show());
    expect(await page.locator(".title-card").count()).toBe(1);
    await page.keyboard.press("Enter");
    await expect.poll(() => state(page)).toEqual({ open: false, resolved: 1 });
  });
});

// ═════════════════════════════ 3. Dialogs ═════════════════════════════

test.describe("dialogs", () => {
  test.beforeEach(async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
      const w = window as any;
      w.log = [];
      w.dlg = new w.__ui.Dialogs(document.getElementById("app"));
    });
    await listenAsGame(page);
  });
  const log = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).log);
  /** "Pay": run() swaps synchronously to an action-less pending screen (like the flows do). */
  const showPay = (page: Page) =>
    page.evaluate(() => {
      const w = window as any;
      w.dlg.show({
        key: "purchase",
        title: "Pay?",
        actions: [
          {
            id: "pay",
            kind: "primary",
            label: "Pay",
            run: () => {
              w.log.push("pay");
              w.dlg.show({ key: "purchase", tone: "pending", title: "PROCESSING" });
            },
          },
          { id: "cancel", label: "Not yet", run: () => w.dlg.close() },
        ],
      });
    });

  test("auto-repeat Enter / E / Space never runs an action", async ({ page }) => {
    await showPay(page);
    for (const code of ["Enter", "KeyE", "Space", "NumpadEnter"]) await keydown(page, { code, repeat: true });
    expect(await log(page)).toEqual([]);
  });

  test("a fast double Enter runs a self-replacing action once", async ({ page }) => {
    await showPay(page);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    expect(await log(page)).toEqual(["pay"]);
    // Same task, no frame in between.
    await showPay(page);
    await page.evaluate(() => {
      for (let i = 0; i < 2; i++) (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", bubbles: true, cancelable: true }));
    });
    expect(await log(page)).toEqual(["pay", "pay"]);
  });

  test("a mouse dblclick runs a self-replacing action once", async ({ page }) => {
    await showPay(page);
    await page.dblclick('[data-action-id="pay"]');
    expect(await log(page)).toEqual(["pay"]);
  });

  test("Escape closes only the dialog; the game never sees it", async ({ page }) => {
    await showPay(page);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as any).dlg.openKey)).toBeNull();
    expect(await seen(page)).toEqual([]);
    expect(await log(page)).toEqual([]);
  });

  test("disabled actions never run (keyboard, hotkey or click)", async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any;
      const run = () => w.log.push("reset");
      w.dlg.show({ key: "help", title: "Help", actions: [{ id: "reset", label: "Reset", disabled: true, hotkey: "KeyN", run }] });
    });
    for (const k of ["Enter", "KeyE", "Space", "KeyN", "Tab", "Home", "Enter"]) await page.keyboard.press(k);
    await page.click('[data-action-id="reset"]', { force: true });
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-action-id="reset"]')!.click());
    expect(await log(page)).toEqual([]);
  });
});

// ═════════════════════════════ 4. The controller ═════════════════════════════

test.describe("controller", () => {
  test.describe.configure({ timeout: 20_000 });
  test.beforeAll(async () => {
    await bundle("game-entry.ts");
  });
  test.afterEach(async ({ page }) => {
    // Never a broken invariant along any of these sequences.
    const warnings: string[] = await page.evaluate(() => (window as any).__h?.warnings ?? []);
    expect(warnings.filter((w) => w.includes("invariant"))).toEqual([]);
  });

  const press = (page: Page, key: string) => page.keyboard.press(key);
  const balance = (page: Page) => snap(page).then((s) => (s.balance === null ? null : BigInt(s.balance)));

  test("a. C / H / I and E do nothing during the smash swing; work again after", async ({ page }) => {
    await startGame(page);
    await pickUp(page);
    await stand(page, "car:0");
    await interact(page);
    expect(await page.evaluate(() => (window as any).__h.world.smashCalls)).toEqual(["car:0"]);
    for (const k of ["KeyC", "KeyH", "KeyI"]) {
      await press(page, k);
      expect(await openKey(page), k).toBeNull();
    }
    await stand(page, "atm");
    await press(page, "KeyE");
    await interact(page);
    expect(await openKey(page)).toBeNull();
    await page.evaluate(() => (window as any).__h.world.smash.resolve());
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await press(page, "KeyC");
    expect(await openKey(page)).toBe("collection");
    await press(page, "KeyC");
    expect(await openKey(page)).toBeNull();
    await press(page, "KeyH");
    expect(await openKey(page)).toBe("help");
    await press(page, "KeyH");
    await press(page, "KeyI");
    expect(await openKey(page)).toBe("inspect");
    await press(page, "KeyI");
    await press(page, "KeyE"); // at the ATM
    expect(await openKey(page)).toBe("atm");
  });

  test("a. C / H / I and E do nothing during the exit beat; title card owns keys; then C / H work", async ({ page }) => {
    await startGame(page);
    await buyOne(page);
    await sellHeld(page);
    await pickUp(page, "kindling"); // something in hand so I would otherwise open
    await stand(page, "home");
    await interact(page);
    await expect.poll(() => page.evaluate(() => (window as any).__h.world.homeBeatCalls)).toBe(1);
    expect((await snap(page)).wentHome).toBe(true);
    for (const k of ["KeyC", "KeyH", "KeyI"]) {
      await press(page, k);
      expect(await openKey(page), k).toBeNull();
    }
    await stand(page, "atm");
    await press(page, "KeyE");
    await interact(page);
    expect(await openKey(page)).toBeNull();
    expect(await page.evaluate(() => (window as any).__h.world.blocked)).toBe(true);
    await page.evaluate(() => (window as any).__h.world.beat.resolve());
    await expect.poll(() => snap(page).then((s) => s.titleCard)).toBe(true);
    await press(page, "KeyC");
    expect(await openKey(page)).toBeNull();
    expect((await snap(page)).titleCard).toBe(true);
    await press(page, "Enter");
    await expect.poll(() => snap(page).then((s) => s.titleCard)).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).__h.world.blocked)).toBe(false);
    // The card fades out for 500 ms with its button still focused (see the fixme below).
    await expect(page.locator(".title-card")).toHaveCount(0);
    await press(page, "KeyC");
    expect(await openKey(page)).toBe("collection");
    await press(page, "KeyC");
    await press(page, "KeyH");
    expect(await openKey(page)).toBe("help");
    await press(page, "KeyH");
    await press(page, "KeyE");
    expect(await openKey(page)).toBe("atm");
  });
  // REGRESSION (fixed on this branch): TitleCard.dismiss() used to leave its "Continue" button focused while the card fades
  // FINDING: TitleCard.dismiss() leaves its "Continue" button focused while the card fades
  // out (removed after 500 ms). A dialog opened in that window remembers the button as its
  // return focus and gives focus back to it on close; the world ignores E / Enter whose
  // target is a button, so E is dead until the node is removed. STATE-MODEL §2: "Closing a
  // dialog returns focus to where it was (or nowhere), never to a removed node."
  test("a. right after dismissing the title card, E reaches the world (focus not left on the leaving card)", async ({ page }) => {
    await startGame(page);
    await buyOne(page);
    await sellHeld(page);
    await stand(page, "home");
    await interact(page);
    await page.evaluate(() => (window as any).__h.world.beat.resolve());
    await expect.poll(() => snap(page).then((s) => s.titleCard)).toBe(true);
    await press(page, "Enter");
    await expect.poll(() => snap(page).then((s) => s.titleCard)).toBe(false);
    await press(page, "KeyH");
    await press(page, "KeyH");
    await stand(page, "atm");
    await press(page, "KeyE");
    expect(await openKey(page)).toBe("atm");
  });

  test("b. I toggles inspect like C and H; C does nothing over another dialog", async ({ page }) => {
    await startGame(page);
    await pickUp(page);
    await press(page, "KeyI");
    expect(await openKey(page)).toBe("inspect");
    await press(page, "KeyI");
    expect(await openKey(page)).toBeNull();
    await press(page, "KeyH");
    expect(await openKey(page)).toBe("help");
    await press(page, "KeyC");
    expect(await openKey(page)).toBe("help");
    await press(page, "KeyI");
    expect(await openKey(page)).toBe("help");
    await press(page, "Escape");
    await press(page, "KeyC");
    expect(await openKey(page)).toBe("collection");
    await press(page, "KeyH");
    expect(await openKey(page)).toBe("collection");
    await press(page, "KeyC");
    expect(await openKey(page)).toBeNull();
  });

  /** Start a transaction of `kind` by keyboard and close its pending screen with Esc. */
  async function startTx(page: Page, kind: "purchase" | "sell" | "withdraw") {
    if (kind === "purchase") {
      await openPay(page);
    } else if (kind === "sell") {
      await stand(page, "buyer:collector");
      await interact(page);
      expect(await focusedAction(page)).toBe("sell");
    } else {
      await stand(page, "atm");
      await interact(page);
      expect(await focusedAction(page)).toBe("withdraw");
    }
    await press(page, "Enter");
    expect((await snap(page)).op).toMatchObject({ kind, status: "pending" });
  }

  for (const kind of ["purchase", "sell", "withdraw"] as const) {
    test(`c. ${kind} pending: overlay forced visible, U ignored, U works after`, async ({ page }) => {
      await startGame(page, { latencyMs: 300 });
      expect(await uiFlag(page)).toBe("on");
      if (kind === "purchase") await pickUp(page);
      if (kind === "sell") await buyOne(page);
      await press(page, "KeyU");
      expect(await uiFlag(page)).toBe("off");
      await startTx(page, kind);
      expect(await uiFlag(page)).toBe("on");
      await press(page, "Escape");
      expect(await openKey(page)).toBeNull();
      await press(page, "KeyU");
      expect(await uiFlag(page)).toBe("on");
      await waitIdle(page);
      expect((await snap(page)).op).toBeNull();
      await press(page, "KeyU");
      expect(await uiFlag(page)).toBe("off");
      await press(page, "KeyU");
      expect(await uiFlag(page)).toBe("on");
    });
  }

  test("d. Reset demo is disabled while a transaction is pending and enables when it settles", async ({ page }) => {
    await startGame(page, { latencyMs: 400 });
    await pickUp(page);
    await startTx(page, "purchase");
    await press(page, "Escape");
    await press(page, "KeyH");
    expect(await openKey(page)).toBe("help");
    expect((await actions(page)).find((a) => a.id === "reset")?.disabled).toBe(true);
    await waitIdle(page);
    expect(await openKey(page)).toBe("help");
    await expect.poll(async () => (await actions(page)).find((a) => a.id === "reset")?.disabled).toBe(false);
  });

  test("e. double confirm on Pay (two Enters): one Record, one charge", async ({ page }) => {
    await startGame(page);
    await pickUp(page);
    await openPay(page);
    await press(page, "Enter");
    await press(page, "Enter");
    await waitIdle(page);
    const s = await snap(page);
    expect(s.ownedIds).toHaveLength(1);
    expect(s.hand?.recordId).toBe(s.ownedIds[0]);
    expect(await balance(page)).toBe(START - PRICE);
    expect((await calls(page)).purchase).toBe(1);
  });

  test("e. double confirm on Pay (dblclick): one Record, one charge", async ({ page }) => {
    await startGame(page);
    await pickUp(page);
    await openPay(page);
    await page.dblclick('[data-action-id="pay"]');
    await waitIdle(page);
    expect((await snap(page)).ownedIds).toHaveLength(1);
    expect(await balance(page)).toBe(START - PRICE);
    expect((await calls(page)).purchase).toBe(1);
  });

  test("e. double confirm on Withdraw (Enters and dblclick): +50 once each", async ({ page }) => {
    await startGame(page);
    await stand(page, "atm");
    await interact(page);
    await press(page, "Enter");
    await press(page, "Enter");
    await waitIdle(page);
    expect(await balance(page)).toBe(START + WITHDRAW);
    expect((await calls(page)).withdrawFakeUsd).toBe(1);
    await press(page, "Escape");
    await interact(page);
    await page.dblclick('[data-action-id="withdraw"]');
    await waitIdle(page);
    expect(await balance(page)).toBe(START + 2n * WITHDRAW);
    expect((await calls(page)).withdrawFakeUsd).toBe(2);
  });

  test("e. double confirm on Sell (Enters): paid once", async ({ page }) => {
    await startGame(page);
    await buyOne(page);
    await stand(page, "buyer:collector");
    await interact(page);
    await press(page, "Enter");
    await press(page, "Enter");
    await waitIdle(page);
    const s = await snap(page);
    expect(s.sold).toHaveLength(1);
    expect(s.ownedIds).toHaveLength(0);
    expect(await balance(page)).toBe(START - PRICE + OFFER);
    expect((await calls(page)).sellToNpc).toBe(1);
  });

  test("e. double confirm on Sell (dblclick): paid once", async ({ page }) => {
    await startGame(page);
    await buyOne(page);
    await stand(page, "buyer:collector");
    await interact(page);
    await page.dblclick('[data-action-id="sell"]');
    await waitIdle(page);
    expect((await snap(page)).sold).toHaveLength(1);
    expect(await balance(page)).toBe(START - PRICE + OFFER);
    expect((await calls(page)).sellToNpc).toBe(1);
  });

  test("f. Esc on the pending purchase screen: it still completes, toast, owned Record in hand", async ({ page }) => {
    await startGame(page, { latencyMs: 200 });
    await pickUp(page);
    await startTx(page, "purchase");
    await press(page, "Escape");
    expect(await openKey(page)).toBeNull();
    expect((await snap(page)).op).toMatchObject({ kind: "purchase", status: "pending" });
    await waitIdle(page);
    const s = await snap(page);
    expect(s.op).toBeNull();
    expect(s.hand?.shopRecordId).toBe(RECORD);
    expect(s.hand?.recordId).toBeTruthy();
    expect(s.ownedIds).toContain(s.hand!.recordId);
    expect(await openKey(page)).toBeNull();
    expect((await toasts(page)).some((t) => t.includes("Bought Low Tide Tapes"))).toBe(true);
  });

  test("g. counter while an ATM withdrawal is pending: no Pay dialog, 'One thing at a time.'", async ({ page }) => {
    await startGame(page, { latencyMs: 400 });
    await pickUp(page);
    await startTx(page, "withdraw");
    await press(page, "Escape");
    await stand(page, "cashier");
    await interact(page);
    expect(await openKey(page)).toBeNull();
    expect(await toasts(page)).toContain("One thing at a time.");
    expect((await snap(page)).op).toMatchObject({ kind: "withdraw", status: "pending" });
  });

  test("g. Stonks while an ATM withdrawal is pending (holding an owned Record): 'One thing at a time.'", async ({ page }) => {
    await startGame(page);
    await buyOne(page);
    await page.evaluate(() => (window as any).__h.adapter.setLatency(400));
    await startTx(page, "withdraw");
    await press(page, "Escape");
    await stand(page, "buyer:collector");
    await interact(page);
    expect(await openKey(page)).toBeNull();
    expect(await toasts(page)).toContain("One thing at a time.");
    expect((await calls(page)).sellToNpc).toBe(0);
  });

  test("h. purchase fails → Retry focused → Enter → success, charged once", async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => (window as any).__h.adapter.failNext("purchase"));
    await pickUp(page);
    await startTx(page, "purchase");
    await expect.poll(() => snap(page).then((s) => s.op?.status)).toBe("error");
    expect(await openKey(page)).toBe("purchase");
    expect(await dialogText(page)).toContain("Register jammed");
    expect(await focusedAction(page)).toBe("retry");
    await press(page, "Enter");
    await waitIdle(page);
    const s = await snap(page);
    expect(s.op).toBeNull();
    expect(s.hand?.recordId).toBeTruthy();
    expect(s.ownedIds).toHaveLength(1);
    expect(await balance(page)).toBe(START - PRICE);
  });

  test("h. lost answer → 'Shop took too long', balance re-read, Retry returns the same Record, charged once", async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => (window as any).__h.adapter.failNext("purchase-lost"));
    await pickUp(page);
    await startTx(page, "purchase");
    await expect.poll(() => snap(page).then((s) => s.op?.status)).toBe("error");
    expect(await dialogText(page)).toContain("Shop took too long");
    expect(await focusedAction(page)).toBe("retry");
    // The re-read shows the charge (and the Record in the collection) although the answer was lost.
    await expect.poll(() => balance(page)).toBe(START - PRICE);
    await expect.poll(() => snap(page).then((s) => s.ownedIds.length)).toBe(1);
    const landed = (await snap(page)).ownedIds[0];
    expect((await snap(page)).hand?.recordId).toBeNull();
    await press(page, "Enter");
    await waitIdle(page);
    const s = await snap(page);
    expect(s.op).toBeNull();
    expect(s.hand?.recordId).toBe(landed);
    expect(s.ownedIds).toEqual([landed]);
    expect(await balance(page)).toBe(START - PRICE);
  });

  test("i. a refused dispatch logs a [game] warning and never throws", async ({ page }) => {
    await startGame(page);
    const result = await page.evaluate(() => {
      const h = (window as any).__h;
      const before = h.warnings.length;
      const accepted = h.controller.dispatch({ type: "putBack" });
      return { accepted, logged: h.warnings.slice(before) as string[] };
    });
    expect(result.accepted).toBe(false);
    expect(result.logged).toHaveLength(1);
    expect(result.logged[0]!.startsWith("[game]")).toBe(true);
    expect(result.logged[0]).toContain("putBack");
  });
});

// ═════════════════════════════ 5. Player held keys ═════════════════════════════

test.describe("player input (real Player, no renderer)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(`<!doctype html><html><body><canvas width="64" height="64"></canvas></body></html>`);
    await page.addScriptTag({ content: await bundle("player-entry.ts") });
    await page.evaluate(() => (window as any).__playerKit.makePlayer());
  });
  const held = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__p.held());
  const moved = (page: Page) =>
    page.evaluate(() => {
      const p = (window as any).__p;
      const a = p.pos();
      p.step(10);
      const b = p.pos();
      return Math.hypot(b.x - a.x, b.z - a.z) > 0.01;
    });
  const phase = (page: Page): Promise<string> => page.evaluate(() => (window as any).__p.phase());

  test("window blur releases held keys", async ({ page }) => {
    await page.keyboard.down("KeyW");
    expect(await held(page)).toEqual(["KeyW"]);
    expect(await moved(page)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    expect(await held(page)).toEqual([]);
    expect(await moved(page)).toBe(false);
    await page.keyboard.up("KeyW");
  });

  test("tab hidden (visibilitychange) releases held keys", async ({ page }) => {
    await page.keyboard.down("KeyD");
    await page.keyboard.down("ShiftLeft");
    expect((await held(page)).sort()).toEqual(["KeyD", "ShiftLeft"]);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await held(page)).toEqual([]);
    await page.keyboard.up("KeyD");
    await page.keyboard.up("ShiftLeft");
  });

  test("Cmd+W does not start walking; a Meta keyup drops everything held", async ({ page }) => {
    await keydown(page, { code: "KeyW", metaKey: true });
    expect(await held(page)).toEqual([]);
    expect(await moved(page)).toBe(false);
    await keydown(page, { code: "KeyA" });
    await keydown(page, { code: "MetaLeft", metaKey: true });
    expect(await held(page)).toEqual(["KeyA"]);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "MetaLeft" })));
    expect(await held(page)).toEqual([]);
  });

  test("setBlocked(true) clears held keys and refuses jumping", async ({ page }) => {
    await page.keyboard.down("KeyW");
    expect(await held(page)).toEqual(["KeyW"]);
    const jumped = await page.evaluate(() => {
      const p = (window as any).__p;
      p.player.setBlocked(true);
      return p.player.jump();
    });
    expect(jumped).toBe(false);
    expect(await held(page)).toEqual([]);
    await keydown(page, { code: "Space", key: " " });
    expect(await phase(page)).toBe("grounded");
    await page.keyboard.up("KeyW");
  });

  test("Space auto-repeat does not jump; a fresh Space does", async ({ page }) => {
    await keydown(page, { code: "Space", key: " ", repeat: true });
    expect(await phase(page)).toBe("grounded");
    await keydown(page, { code: "Space", key: " " });
    expect(await phase(page)).not.toBe("grounded");
  });
});
