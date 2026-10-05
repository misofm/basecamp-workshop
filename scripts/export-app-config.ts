// Write the apps' view of the published catalog from releases/registry.testnet.json:
//   apps/game/public/shop.testnet.json   [{ releaseId, edition, section }] in catalog order
//
//   bun scripts/export-app-config.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(readFileSync(join(root, "catalog/catalog.json"), "utf8"));
const registry = JSON.parse(readFileSync(join(root, "releases/registry.testnet.json"), "utf8"));

// In-store bin labels (the game's ten sections), by release.
const SECTION: Record<string, string> = {
  "low-tide-tapes": "HIP HOP", "night-drive-atlas": "SYNTHWAVE", kindling: "FOLK", "lagos-after-dark": "AFROBEATS",
  "blue-hours": "JAZZ", "field-notes": "AMBIENT", "summer-static": "CITY POP", "third-rail": "DRUM & BASS",
  "sun-bleached": "SURF ROCK", "warehouse-gospel": "HOUSE",
};

const shop = catalog.releases
  .map((r: any) => ({ entry: registry[`${r.artist}-${r.slug}`], section: SECTION[r.slug] }))
  .filter((x: any) => x.entry)
  .map((x: any) => ({ releaseId: x.entry.releaseId, edition: x.entry.edition, section: x.section }));
writeFileSync(join(root, "apps/game/public/shop.testnet.json"), "[\n" + shop.map((s: any) => "  " + JSON.stringify(s)).join(",\n") + "\n]\n");
console.log(`shop.testnet.json: ${shop.length} releases`);
