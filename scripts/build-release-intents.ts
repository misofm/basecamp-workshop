// Build releases/<folder>/release.json (network-neutral intent) and
// releases/<folder>/release-config.testnet.json (party ids, Walrus ids, credits, pressing)
// in the same split misofm/releases uses. Inputs:
//
//   catalog/catalog.json        titles, genres, descriptions, prices
//   parties/parties.json        who is in which act
//   parties/parties.testnet.json  on-chain party ids (scripts/create-parties.ts)
//   releases/<folder>/masters.json  Walrus ids for the media (scripts/store-media.ts)
//
// The owner and every admin address is --owner, or else the address of SUI_PRIVATE_KEY.
//
//   bun scripts/build-release-intents.ts [--only <folder>] [--owner 0x...]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const catalog = read("catalog/catalog.json");
const { parties } = read("parties/parties.json");
const ids: Record<string, any> = existsSync(join(root, "parties/parties.testnet.json")) ? read("parties/parties.testnet.json") : {};

const FAKE_USD = "0x77774cb7b8cb5622b4ef2658101bf5f1e965418297fe874b683df8f760b6e749::fakeusd::FakeUsd";
const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const ownerArg = arg("--owner");
const secret = process.env.SUI_PRIVATE_KEY?.trim();
if (ownerArg !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(ownerArg)) throw new Error(`--owner must be a 0x-prefixed 32-byte address; got ${ownerArg}`);
if (!ownerArg && !secret) throw new Error("pass --owner <0x...> or set SUI_PRIVATE_KEY so the owner address can be derived");
const owner = ownerArg ?? Ed25519Keypair.fromSecretKey(secret!).toSuiAddress();
const address = { kind: "address", value: owner };

// The live vocabulary has 16 genres (no jazz, folk, ambient or afrobeats), so map to the nearest.
const GENRES: Record<string, { primary: string; secondary: string[] }> = {
  "low-tide-tapes": { primary: "HIP_HOP", secondary: ["ELECTRONIC"] },
  "night-drive-atlas": { primary: "ELECTRONIC", secondary: ["SOUNDTRACK", "POP"] },
  kindling: { primary: "ALTERNATIVE", secondary: ["COUNTRY"] },
  "lagos-after-dark": { primary: "POP", secondary: ["R_AND_B", "DANCE"] },
  "blue-hours": { primary: "R_AND_B", secondary: ["CLASSICAL"] },
  "field-notes": { primary: "ELECTRONIC", secondary: ["SOUNDTRACK"] },
  "summer-static": { primary: "POP", secondary: ["DANCE"] },
  "third-rail": { primary: "ELECTRONIC", secondary: ["DANCE"] },
  "sun-bleached": { primary: "ROCK", secondary: ["ALTERNATIVE"] },
  "warehouse-gospel": { primary: "DANCE", secondary: ["GOSPEL", "ELECTRONIC"] },
};
const PRICE_FUSD: Record<string, number> = {
  "low-tide-tapes": 12, "night-drive-atlas": 15, kindling: 10, "lagos-after-dark": 18, "blue-hours": 20,
  "field-notes": 8, "summer-static": 15, "third-rail": 12, "sun-bleached": 10, "warehouse-gospel": 18,
};
const PRODUCER: Record<string, string> = { "tidepool-records": "nadia-flint", chromefield: "nadia-flint", "goldline-music": "kofi-mensah" };
const FEATURES: Record<string, string> = { "chrome-horizon": "kiko-arai", "lift-me-higher": "selene-okafor" };
const WRITERS_EXTRA: Record<string, string[]> = { "summer-static": ["rio-takeda"], "lagos-after-dark": ["rio-takeda"] };

const party = (slug: string) => parties.find((p: any) => p.slug === slug) ?? (() => { throw new Error(`unknown party ${slug}`); })();
const identity = (slug: string) => ({ kind: "party", value: ids[slug]?.partyId ?? "0x" + "0".repeat(64) });
const credit = (slug: string, extra: object) => ({ identity: identity(slug), displayName: party(slug).name, ...extra });
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

const only = arg("--only");
for (const rel of catalog.releases) {
  if (only && `${rel.artist}-${rel.slug}` !== only) continue;
  const folder = `${rel.artist}-${rel.slug}`;
  const masters = read(`releases/${folder}/masters.json`);
  const act = party(rel.artist);
  const members: string[] = act.group ? act.members : [act.slug];
  const trackDirs = Object.keys(masters.tracks).sort();
  if (trackDirs.length !== rel.tracks.length) throw new Error(`${folder}: ${trackDirs.length} tracks in masters.json, expected ${rel.tracks.length}`);

  const release: any = { compositions: [], recordings: [], release: {} };
  const config: any = {
    network: "testnet",
    owner: address,
    defaults: { adminAddress: address, royaltyCurrency: FAKE_USD },
    compositions: {},
    recordings: {},
    release: {},
    pressing: {},
  };

  rel.tracks.forEach((t: any, i: number) => {
    const c = `c${i + 1}`, r = `r${i + 1}`;
    const m = masters.tracks[trackDirs[i]];
    if (!m.streamingTranscode) throw new Error(`${folder}/${t.slug}: no streamingTranscode yet (run scripts/store-media.ts)`);
    const { blobId, bytes, ...master } = m.master;
    release.compositions.push({ ref: c, title: t.title, royaltyRateBps: 2000 });
    release.recordings.push({
      ref: r,
      composition: { ref: c },
      durationDisplay: fmt(Number(master.samples) / master.sampleRateHz),
      advisory: "NotExplicit",
      languages: t.instrumental ? { instrumental: true } : { codes: ["en"] },
      master,
    });

    const writers = [...members, ...(t.instrumental ? [] : WRITERS_EXTRA[rel.slug] ?? [])];
    config.compositions[c] = {
      adminAddress: address,
      credits: writers.map((w) => credit(w, {
        roles: [{ type: "Composer" }, ...(t.instrumental ? [] : [{ type: "Songwriter" }, { type: "Lyricist" }])],
      })),
    };

    const producer = rel.artist === "subway-prophet" ? undefined : PRODUCER[rel.label];
    const recCredits: any[] = [
      credit(rel.artist, { primaryArtist: true, roles: [t.instrumental ? { type: "Performer", level: "Primary" } : { type: "Vocalist", level: "Lead" }] }),
      ...(act.group ? members.map((s) => credit(s, { roles: [{ type: "Performer" }] })) : []),
      ...(FEATURES[t.slug] ? [credit(FEATURES[t.slug], { roles: [{ type: "Vocalist", level: "Featured" }] })] : []),
      ...(producer ? [credit(producer, { roles: [{ type: "Producer", level: "Principal" }, { type: "MixingEngineer" }] })] : []),
      credit("elsa-brandt", { roles: [{ type: "MasteringEngineer" }] }),
      credit(rel.label, { roles: [{ type: "Custom", name: "Label" }] }),
    ];
    config.recordings[r] = { master: { blobId }, streamingTranscode: m.streamingTranscode, adminAddress: address, credits: recCredits };
  });

  release.release = {
    title: rel.title,
    kind: "ExtendedPlay",
    description: rel.description,
    genres: GENRES[rel.slug],
    tracks: rel.tracks.map((_: any, i: number) => ({ recording: { ref: `r${i + 1}` }, splitBps: 10000 / rel.tracks.length })),
  };
  config.release = {
    cover: { still: masters.cover.blobId },
    adminAddress: address,
    credits: [credit(rel.artist, { role: "Primary" })],
  };
  config.pressing = {
    price: { kind: "fixed", amount: String(PRICE_FUSD[rel.slug] * 1_000_000), currency: FAKE_USD },
    maxSupply: 250,
  };

  writeFileSync(join(root, "releases", folder, "release.json"), JSON.stringify(release, null, 2) + "\n");
  writeFileSync(join(root, "releases", folder, "release-config.testnet.json"), JSON.stringify(config, null, 2) + "\n");
  console.log(`intent ${folder}`);
}
