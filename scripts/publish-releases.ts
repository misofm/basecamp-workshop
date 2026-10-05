// Publish every release whose media is on Walrus to testnet with the `miso` CLI,
// self-paid by SUI_PRIVATE_KEY (the CLI's default unless you configure a gas sponsor;
// see the CLI README). Results are recorded like this:
//
//   releases/<folder>/publication-<yyyymmdd>.testnet.json   CLI result
//   releases/<folder>/publication-<yyyymmdd>.testnet.log    CLI progress log
//   releases/registry.testnet.json                          release/pressing/listing ids for the apps
//
// Skips releases already in the registry and releases whose media is not ready
// (cover.blobId plus a master and streamingTranscode for every track; see
// scripts/store-media.ts). The intents are rebuilt first with
// scripts/build-release-intents.ts, which derives the owner from SUI_PRIVATE_KEY.
//
//   bun scripts/publish-releases.ts [--only <folder>] [--dry-run]

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { $ } from "bun";
import { misoIn, misoRaw, requireSigner } from "./lib/miso.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const dryRun = args.includes("--dry-run");
requireSigner();
const registryPath = join(root, "releases/registry.testnet.json");
const registry: Record<string, any> = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : {};
const catalog = JSON.parse(readFileSync(join(root, "catalog/catalog.json"), "utf8"));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

for (const folder of readdirSync(join(root, "releases")).filter((f) => !f.endsWith(".json")).sort()) {
  if (only && folder !== only) continue;
  if (registry[folder]) continue;
  const dir = join(root, "releases", folder);
  const rel = catalog.releases.find((x: any) => `${x.artist}-${x.slug}` === folder);
  const masters = existsSync(join(dir, "masters.json")) ? JSON.parse(readFileSync(join(dir, "masters.json"), "utf8")) : null;
  const tracks: any[] = Object.values(masters?.tracks ?? {});
  const ready =
    rel && masters?.cover?.blobId && tracks.length === rel.tracks.length &&
    tracks.every((t) => t.master?.blobId && t.streamingTranscode);
  if (!ready) { console.log(`skip  ${folder}: media not on Walrus yet (run scripts/store-media.ts)`); continue; }

  await $`bun ${join(root, "scripts/build-release-intents.ts")} --only ${folder}`.quiet();
  const plan = await misoIn(dir, "release", "publish", "release.json", "--config", "release-config.testnet.json", "--dry-run");
  console.log(`plan  ${folder}: ${plan.plan.ptbs.total} PTBs, ${plan.plan.credits.recording} recording credits`);
  if (dryRun) continue;

  const out = join(dir, `publication-${stamp}.testnet.json`);
  const log = join(dir, `publication-${stamp}.testnet.log`);
  const res = await misoRaw(
    ["release", "publish", "release.json", "--config", "release-config.testnet.json", "--state", "release.testnet.state.json"],
    { cwd: dir },
  );
  writeFileSync(out, res.stdout);
  writeFileSync(log, res.stderr);
  if (res.exitCode !== 0 || !res.json?.ok) throw new Error(`${folder} publish failed (exit ${res.exitCode}); see ${log}`);

  const r = res.json.result;
  const pressing = r.releaseExtensions.pressing;
  registry[folder] = {
    title: rel.title,
    artist: rel.artist,
    genre: rel.genre,
    releaseId: r.release.releaseId,
    pressingId: pressing.pressingId,
    edition: pressing.edition,
    maxSupply: pressing.maxSupply,
    listingId: pressing.listing.listingId,
    pricing: pressing.listing.pricing,
    digest: r.digest,
    gasUsedMist: String(r.totalGasUsed),
    publishedAt: new Date().toISOString(),
  };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  console.log(`done  ${folder}: release ${r.release.releaseId} (${(Number(r.totalGasUsed) / 1e9).toFixed(3)} SUI)`);
}
