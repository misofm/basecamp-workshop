/**
 * Dialog keyboard behaviour in a real (headless) browser DOM: arrow selection + wrap,
 * Enter / E / Esc, keycap hotkeys, Tab focus trap, focus return, lists.
 * The Dialogs module is bundled with esbuild (ships with vite) and injected into a blank page.
 */
import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

let code = "";
test.beforeAll(async () => {
  const out = await build({
    stdin: { contents: `import { Dialogs, receiptLink, collectionBody } from "./src/ui/dialogs"; window.D = { Dialogs, receiptLink, collectionBody };`, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, format: "iife", platform: "browser",
  });
  code = out.outputFiles[0]!.text;
});

async function setup(page: Page) {
  await page.setContent(`<button id="outside">outside</button><div id="host"></div>`);
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    const w = window as any;
    w.log = [];
    w.dlg = new w.D.Dialogs(document.getElementById("host")!);
    const act = (id: string, extra: object = {}) => ({ id, label: id, run: () => w.log.push(id), ...extra });
    w.act = act;
    w.dlg.show({ key: "t", title: "T", body: w.D.receiptLink({ href: "#x" }), actions: [act("a", { kind: "primary" }), act("b", { key: "N", hotkey: "KeyN" }), act("c")] });
  });
}
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement).dataset.actionId ?? document.activeElement!.textContent);
const log = (page: Page) => page.evaluate(() => (window as any).log as string[]);

test("arrows move and wrap; primary starts focused", async ({ page }) => {
  await setup(page);
  expect(await focused(page)).toBe("a");
  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toBe("b");
  await page.keyboard.press("ArrowDown");
  expect(await focused(page)).toBe("c");
  await page.keyboard.press("ArrowRight"); // receipt link is the last stop in DOM order? body precedes actions
  const afterWrap = await focused(page);
  expect(afterWrap).toBe("View receipt ↗");
  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toBe("c");
  await page.keyboard.press("End");
  expect(await focused(page)).toBe("c");
  await page.keyboard.press("Home");
  expect(await focused(page)).toBe("View receipt ↗");
  await page.keyboard.press("ArrowUp"); // wraps backwards
  expect(await focused(page)).toBe("c");
});

test("Enter and E activate, keycap hotkey works, Esc closes and returns focus", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).dlg.close(); document.getElementById("outside")!.focus(); (window as any).dlg.show({ key: "t", title: "T", actions: [(window as any).act("a"), (window as any).act("b", { hotkey: "KeyN" })] }); });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("KeyE");
  await page.keyboard.press("KeyN");
  expect(await log(page)).toEqual(["b", "a", "b"]);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as any).dlg.openKey)).toBeNull();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("outside");
});

test("Tab / Shift+Tab stay inside the dialog", async ({ page }) => {
  await setup(page);
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    seen.add((await focused(page)) ?? "");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  }
  expect([...seen].sort()).toEqual(["View receipt ↗", "a", "b", "c"]);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  }
});

test("focus pulled back if it escapes; disabled actions are skipped", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { const w = window as any; w.dlg.show({ key: "u", title: "U", actions: [w.act("x"), w.act("y", { disabled: true }), w.act("z")] }); });
  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toBe("z");
  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toBe("x");
  await page.evaluate(() => document.getElementById("outside")!.focus());
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
});

test("collection rows: Up/Down walks the per-row actions", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    const item = (n: string) => ({ recordId: n, title: n, artist: "", coverUrl: "", serialText: "", actionLabel: "Hold " + n, onAction: () => w.log.push(n) });
    w.dlg.show({ key: "collection", title: "MY RECORDS", body: w.D.collectionBody({ kind: "ready", items: [item("r1"), item("r2"), item("r3")], sold: [] }), actions: [w.act("close")] });
  });
  const f = () => page.evaluate(() => document.activeElement!.textContent);
  await page.keyboard.press("Home");
  expect(await f()).toBe("Hold r1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await f()).toBe("Hold r3");
  await page.keyboard.press("Enter");
  expect(await log(page)).toEqual(["r3"]);
  await page.keyboard.press("ArrowDown");
  expect(await focused(page)).toBe("close");
  await page.keyboard.press("ArrowDown");
  expect(await f()).toBe("Hold r1");
});

test("arrow keys and WASD never reach the game while open", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as any).seen = []; window.addEventListener("keydown", (e) => (window as any).seen.push(e.code)); });
  for (const k of ["ArrowLeft", "ArrowUp", "KeyW", "KeyA", "KeyS", "KeyD", "Tab"]) await page.keyboard.press(k);
  expect(await page.evaluate(() => (window as any).seen)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate(() => (window as any).seen)).toEqual(["ArrowLeft"]);
});
