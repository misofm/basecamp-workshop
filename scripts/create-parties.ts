// Create every party in parties/parties.json on testnet with the `miso` CLI,
// set its profile, and wire group memberships (invite + accept; one signer holds
// every admin cap, so it can do both sides). Self-paid by SUI_PRIVATE_KEY.
// The CLI command comes from MISO_CLI (see scripts/lib/miso.ts).
//
// Results: parties/parties.testnet.json  { <slug>: { partyId, name, group, ... } }
// Resumable: parties already recorded are skipped.
//
//   bun scripts/create-parties.ts [--dry-run]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { miso, requireSigner } from "./lib/miso.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const dryRun = process.argv.includes("--dry-run");
if (!dryRun) requireSigner();
const { parties } = JSON.parse(readFileSync(join(root, "parties/parties.json"), "utf8"));
const outPath = join(root, "parties/parties.testnet.json");
const out: Record<string, any> = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const save = () => writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

// Find the created Party id in a CLI result without depending on its exact shape.
const partyIdOf = (r: any): string =>
  r.partyId ?? r.party?.id ?? r.id ?? (() => { throw new Error(`no party id in ${JSON.stringify(r)}`); })();

for (const p of parties) {
  if (out[p.slug]?.partyId) continue;
  if (dryRun) { console.log(`would create ${p.group ? "group" : "individual"} ${p.name}`); continue; }
  const created = await miso("party", "create", p.name, ...(p.group ? ["--group"] : []));
  out[p.slug] = { partyId: partyIdOf(created), name: p.name, group: p.group, kind: p.kind, create: created };
  save();
  console.log(`created ${p.slug} ${out[p.slug].partyId}`);
}

for (const p of parties) {
  const rec = out[p.slug];
  if (!rec || rec.profile || dryRun) continue;
  const bio = p.bio ?? (p.kind === "label" ? `${p.name} is an independent record label.` : `${p.name}, credited on the Miso Basecamp workshop catalog.`);
  rec.profile = await miso("party", "profile", "set", rec.partyId, "--bio", bio, "--languages", "en");
  save();
  console.log(`profile ${p.slug}`);
}

for (const p of parties.filter((x: any) => x.members?.length)) {
  const group = out[p.slug];
  if (!group || dryRun) continue;
  group.members ??= {};
  for (const m of p.members) {
    if (group.members[m]) continue;
    const member = out[m];
    await miso("party", "invite", group.partyId, member.partyId);
    await miso("party", "accept", group.partyId, member.partyId);
    group.members[m] = member.partyId;
    save();
    console.log(`member ${m} -> ${p.slug}`);
  }
}
