import { expect, test } from "@playwright/test";
import { JAZZ_NOTES, jazzNote } from "../../src/game/jazz-notes";
import { MOCK_CATALOG } from "../../src/miso/mock-catalog";

const BLOCKCHAIN = /\b(sui|chain|testnet|wallet|digest|object|mint|explorer|faucet|gas|crypto|token|nft)\b/i;

test("Jazz has exactly one short line for every catalog section", () => {
  const sections = MOCK_CATALOG.map((r) => r.section);
  expect(Object.keys(JAZZ_NOTES).sort()).toEqual([...new Set(sections)].sort());
  for (const section of sections) {
    const note = jazzNote(section);
    expect(note, section).toBeTruthy();
    expect(note!.length).toBeLessThanOrEqual(80);
    expect(note).not.toMatch(BLOCKCHAIN);
  }
});

test("unknown section → no line", () => {
  expect(jazzNote("POLKA")).toBeNull();
  expect(jazzNote("")).toBeNull();
});
