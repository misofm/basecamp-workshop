/**
 * Shop catalog for testnet: `/shop.testnet.json` (which releases, which edition, which
 * shelf section) hydrated from the Miso API (release metadata, pressing supply, FakeUSD
 * listing price).
 *
 * Owns: validating the shop file and mapping API data to ShopRecord. Keeps the raw
 * listing pricing per record so purchase() can pass it back as `expectedPricing`.
 * Must not: leak API shapes past this module (callers get ShopRecord + SaleTerms).
 */
import { deriveSaleIds } from "@misofm/platform/pressing";
import { MOCK_CATALOG } from "../mock-catalog";
import type { ShopRecord, TrackRef } from "../types";
import {
  FUSD_DECIMALS,
  FUSD_SYMBOL,
  FUSD_TYPE,
  READ_TIMEOUT_MS,
  RECORD_PACKAGE_ID,
  RECORD_SHOP_PACKAGE_ID,
  coverUrl,
} from "./config";
import { PlayerError } from "./errors";
import { getListing, getPressing, getRelease, type ApiRelease } from "./miso-api";
import { fetchJson } from "./net";

export const SECTIONS = [
  "HIP HOP",
  "SYNTHWAVE",
  "FOLK",
  "AFROBEATS",
  "JAZZ",
  "AMBIENT",
  "CITY POP",
  "DRUM & BASS",
  "SURF ROCK",
  "HOUSE",
] as const;
const MAX_ENTRIES = 10; // one stand per section in the shop

export interface ShopEntry {
  releaseId: string;
  edition: number;
  section: string;
}

/** What purchase() needs beyond the ShopRecord. */
export interface SaleTerms {
  releaseId: string;
  edition: number;
  pricing: { kind: "floor" | "fixed"; amount: bigint };
}

const SHOP_FILE = "/shop.testnet.json";
const ID_RE = /^0x[0-9a-f]{64}$/;

/** What the player sees when the shop file is missing or broken (details go to devDetail + console). */
const SHELVES_EMPTY = "Shelves are empty. Reload in a moment.";

/** Validate the parsed shop file. Throws a PlayerError whose devDetail names the first problem. */
export function parseShopFile(raw: unknown): ShopEntry[] {
  const bad = (why: string) => {
    const detail = `${SHOP_FILE} is malformed: ${why}`;
    console.warn(`[miso testnet] ${detail}`);
    return new PlayerError(SHELVES_EMPTY, "other", detail);
  };
  if (!Array.isArray(raw)) throw bad("expected a JSON array of { releaseId, edition, section }");
  if (raw.length === 0) throw bad("it is empty: add at least one { releaseId, edition, section }");
  const entries: ShopEntry[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, i) => {
    const e = item as Partial<Record<keyof ShopEntry, unknown>> | null;
    if (!e || typeof e !== "object") throw bad(`entry ${i} is not an object`);
    const releaseId = typeof e.releaseId === "string" ? e.releaseId.toLowerCase() : "";
    if (!ID_RE.test(releaseId)) throw bad(`entry ${i}: releaseId must be 0x + 64 hex characters`);
    const edition = e.edition;
    if (typeof edition !== "number" || !Number.isInteger(edition) || edition < 1 || edition > 65535) {
      throw bad(`entry ${i}: edition must be an integer 1..65535`);
    }
    const section = typeof e.section === "string" ? e.section.trim().toUpperCase() : "";
    if (!(SECTIONS as readonly string[]).includes(section)) {
      throw bad(`entry ${i}: section must be one of ${SECTIONS.join(", ")}`);
    }
    if (seen.has(releaseId)) {
      console.warn(`[miso testnet] ${SHOP_FILE}: duplicate release ${releaseId} (entry ${i}) ignored`);
      return;
    }
    seen.add(releaseId);
    entries.push({ releaseId, edition, section });
  });
  if (entries.length > MAX_ENTRIES) {
    console.warn(`[miso testnet] ${SHOP_FILE}: ${entries.length} entries, the shop has ${MAX_ENTRIES} stands; using the first ${MAX_ENTRIES}`);
    return entries.slice(0, MAX_ENTRIES);
  }
  return entries;
}

async function loadShopFile(): Promise<ShopEntry[]> {
  let raw: unknown;
  try {
    raw = await fetchJson<unknown>(SHOP_FILE, { timeoutMs: READ_TIMEOUT_MS, cache: "no-cache" });
  } catch (error) {
    console.warn(`[miso testnet] could not load ${SHOP_FILE}:`, error);
    throw new PlayerError(SHELVES_EMPTY, "other", `Couldn't load ${SHOP_FILE} (missing or not valid JSON).`);
  }
  return parseShopFile(raw);
}

/** The record label: a recording credit with the custom "Label" role, if the release has one. */
export function labelOf(release: ApiRelease): string {
  for (const track of Object.values(release.trackCredits ?? {})) {
    const label = track.recordingCredits?.credits?.find((c) => c.roles.includes("Label"));
    if (label) return label.displayName;
  }
  return "Independent";
}

export function artistOf(release: ApiRelease): string {
  const primary = (release.credits ?? []).filter((c) => c.roles.includes("Primary")).map((c) => c.displayName);
  const names = primary.length ? primary : (release.primaryArtists ?? []);
  return names.join(", ") || "Unknown artist";
}

export function releaseCoverUrl(release: ApiRelease): string {
  const blobId = release.cover?.still?.blobId;
  return blobId ? coverUrl(blobId) : "";
}

function tracksOf(release: ApiRelease): TrackRef[] {
  return (release.tracks ?? []).map((t, index) => {
    const rate = Number(t.master?.sample_rate_hz ?? 0);
    const samples = Number(t.master?.samples ?? 0);
    return {
      index,
      title: t.title,
      quiltId: t.transcodeQuiltId || null,
      durationSec: rate > 0 && samples > 0 ? samples / rate : 120,
    };
  });
}

function truncate(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

const DEFAULT_LOOK = MOCK_CATALOG[0];

async function hydrate(entry: ShopEntry): Promise<{ record: ShopRecord; terms: SaleTerms } | null> {
  const { pressingId, listingId } = deriveSaleIds(entry.releaseId, entry.edition, FUSD_TYPE, RECORD_PACKAGE_ID, RECORD_SHOP_PACKAGE_ID);
  const [release, pressing, listing] = await Promise.all([getRelease(entry.releaseId), getPressing(pressingId), getListing(pressingId)]);
  const skip = (why: string) => {
    console.warn(`[miso testnet] skipping ${entry.releaseId} edition ${entry.edition}: ${why}`);
    return null;
  };
  if (!release) return skip("release not found");
  if (!pressing) return skip(`no pressing ${pressingId}`);
  if (!listing) return skip("no FakeUSD listing");
  if (listing.state !== "enabled") return skip("listing is disabled");
  if (listing.currency?.type && !sameType(listing.currency.type, FUSD_TYPE)) return skip(`listing currency ${listing.currency.type}`);
  const look = MOCK_CATALOG.find((r) => r.section === entry.section) ?? DEFAULT_LOOK;
  const amount = BigInt(listing.pricing.amount);
  const record: ShopRecord = {
    id: entry.releaseId,
    releaseId: entry.releaseId,
    title: release.title || "Untitled",
    artist: artistOf(release),
    genre: release.genres?.[0] ?? entry.section,
    section: entry.section,
    year: release.publishedAtMs ? new Date(release.publishedAtMs).getUTCFullYear() : new Date().getUTCFullYear(),
    label: labelOf(release),
    description: truncate(release.description ?? ""),
    coverUrl: releaseCoverUrl(release),
    palette: [...look.palette],
    tracks: tracksOf(release),
    pressingId,
    listingId,
    price: { amount, decimals: FUSD_DECIMALS, symbol: FUSD_SYMBOL },
    edition: `Edition ${entry.edition}`,
    minted: pressing.supply,
    maxSupply: pressing.maxSupply,
    synth: { bpm: look.synth.bpm, notes: [...look.synth.notes] },
  };
  return { record, terms: { releaseId: entry.releaseId, edition: entry.edition, pricing: { kind: listing.pricing.kind, amount } } };
}

const sameType = (a: string, b: string) => a.replace(/^0x/, "").toLowerCase() === b.replace(/^0x/, "").toLowerCase();

/** Load + hydrate the whole shop. Entries that fail are skipped with a warning. */
export async function loadCatalog(): Promise<{ records: ShopRecord[]; terms: Map<string, SaleTerms> }> {
  const entries = await loadShopFile();
  const settled = await Promise.allSettled(entries.map(hydrate));
  const records: ShopRecord[] = [];
  const terms = new Map<string, SaleTerms>();
  let failures = 0;
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      records.push(r.value.record);
      terms.set(r.value.record.id, r.value.terms);
    } else if (r.status === "rejected") {
      failures++;
      console.warn(`[miso testnet] could not load ${entries[i].releaseId}:`, r.reason);
    }
  });
  if (!records.length) {
    throw new PlayerError(
      failures === entries.length ? "Can't reach the shop. Check your connection." : "Nothing's on sale right now.",
    );
  }
  return { records, terms };
}
