import { expect, test } from "@playwright/test";
import { UiVisibility, uiVisibleFromSearch } from "../../src/ui/ui-visibility";

test("U toggles the overlay and is ignored while a dialog is open", () => {
  const ui = new UiVisibility();
  expect(ui.visible).toBe(true);
  expect(ui.toggle()).toBe(false);
  expect(ui.toggle(true)).toBe(false); // dialog open: unchanged
  expect(ui.toggle()).toBe(true);
  expect(ui.toggle(true)).toBe(true);
});

test("?ui=0 starts hidden", () => {
  expect(uiVisibleFromSearch("")).toBe(true);
  expect(uiVisibleFromSearch("?latency=0")).toBe(true);
  expect(uiVisibleFromSearch("?ui=0")).toBe(false);
  expect(uiVisibleFromSearch("?latency=0&ui=off")).toBe(false);
  expect(uiVisibleFromSearch("?ui=1")).toBe(true);
});
