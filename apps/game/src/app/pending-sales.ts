/**
 * PendingSales: the testnet adapter's transferred-but-unpaid sales (see
 * ../miso/testnet/sell.ts for the retry rules), stored in localStorage with an in-memory
 * fallback when storage is blocked.
 *
 * Owns: the `PendingSale` Schema, the stored blob's validation and the store itself.
 * Must not: import ../miso/testnet/config.ts (it pulls @misofm/platform into the main
 * chunk); only the dependency-free key module.
 *
 * Semantics match the TestnetBackend's own store before the port (same key, saving
 * rewrites the whole map, memory fallback when storage throws or the JSON is corrupt, the
 * same per-entry check), plus logging: a corrupt blob or a dropped entry is reported with
 * console.warn, never thrown; valid entries next to an invalid one are kept.
 *
 * Two faces: Effect methods for the app, and a synchronous `store` for sell.ts (it saves
 * the digest synchronously, before the transaction is submitted).
 */
import { Context, Effect, Layer, Schema } from "effect";
import type { PendingSale, PendingStore } from "../miso/testnet/sell";
import { PENDING_SALES_KEY } from "../miso/testnet/storage-keys";

export const OwnedRecordSchema = Schema.Struct({
  recordId: Schema.String,
  shopRecordId: Schema.String,
  title: Schema.String,
  artist: Schema.String,
  coverUrl: Schema.String,
  serial: Schema.Number,
  maxSupply: Schema.Number,
  acquiredAt: Schema.Number,
});

export const PendingSaleSchema = Schema.Struct({
  player: Schema.String,
  transferDigest: Schema.String,
  payoutDigest: Schema.optionalKey(Schema.String),
  owned: OwnedRecordSchema,
});

/** The stored blob: Record id → entry. */
export const PendingSalesBlob = Schema.Record(Schema.String, PendingSaleSchema);

// The Schema and sell.ts's interface describe the same shape.
type _SchemaMatchesInterface = [PendingSale extends typeof PendingSaleSchema.Type ? true : never, typeof PendingSaleSchema.Type extends PendingSale ? true : never];
const _check: _SchemaMatchesInterface = [true, true];
void _check;

/** The synchronous store sell.ts and the testnet backend use. */
export type PendingSalesStore = PendingStore & { all(): Record<string, PendingSale> };

/** The subset of the Web Storage API the store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * What an entry must have to be kept: exactly the check the TestnetBackend made before the
 * port (string `player` and `transferDigest`, an `owned` object). Deliberately looser than
 * PendingSaleSchema: a stricter check could drop a real transferred-but-unpaid sale (e.g.
 * one whose `serial` came back from the API as a string), and then Retry could no longer
 * pay it. The entry is kept as stored (not re-encoded), so nothing is stripped on rewrite.
 */
const KeptEntry = Schema.Struct({ player: Schema.String, transferDigest: Schema.String, owned: Schema.Unknown });
const isKeptEntry = Schema.is(KeptEntry);
const keep = (entry: unknown): entry is PendingSale => isKeptEntry(entry) && typeof entry.owned === "object" && entry.owned !== null;

/** Corrupt JSON (as opposed to a missing key). */
const CORRUPT = Symbol("corrupt");

function parseBlob(raw: string | null): Record<string, PendingSale> | typeof CORRUPT {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("[pending-sales] ignoring corrupt stored pending sales:", error);
    return CORRUPT;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("[pending-sales] ignoring stored pending sales that are not an object");
    return {};
  }
  const out: Record<string, PendingSale> = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (keep(entry)) out[id] = entry;
    else console.warn(`[pending-sales] dropping invalid pending sale for ${id}`);
  }
  return out;
}

/** Parse the stored JSON; drop (and log) anything that is not a pending sale. Never throws. */
export function parsePendingSales(raw: string | null): Record<string, PendingSale> {
  const parsed = parseBlob(raw);
  return parsed === CORRUPT ? {} : parsed;
}

/** `globalThis.localStorage`, read at call time (throws where storage is blocked or missing). */
function browserStorage(): StorageLike {
  const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
  if (!storage) throw new Error("localStorage unavailable");
  return storage;
}

/** A plain in-memory StorageLike (tests). */
export function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

/**
 * The synchronous store. `storage` is called on every access (so a storage that starts
 * throwing falls back to memory, as before); when reading throws, the in-memory copy of
 * the last save is used.
 */
export function makePendingSalesStore(storage: () => StorageLike = browserStorage, key: string = PENDING_SALES_KEY): PendingSalesStore {
  let memory: Record<string, PendingSale> = {};
  const all = (): Record<string, PendingSale> => {
    let raw: string | null;
    try {
      raw = storage().getItem(key);
    } catch {
      return memory;
    }
    // Corrupt JSON: the in-memory copy of the last save (as before the port).
    const parsed = parseBlob(raw);
    return parsed === CORRUPT ? memory : parsed;
  };
  const set = (recordId: string, sale: PendingSale | null): void => {
    const next = { ...all() };
    if (sale) next[recordId] = sale;
    else delete next[recordId];
    memory = next;
    try {
      storage().setItem(key, JSON.stringify(next));
    } catch {
      // in-memory only
    }
  };
  return { all, get: (recordId) => all()[recordId], set };
}

export interface PendingSalesApi {
  readonly all: Effect.Effect<Record<string, PendingSale>>;
  readonly get: (recordId: string) => Effect.Effect<PendingSale | undefined>;
  readonly save: (recordId: string, sale: PendingSale | null) => Effect.Effect<void>;
  /** Synchronous face for ../miso/testnet/sell.ts (via TestnetAdapter → TestnetBackend). */
  readonly store: PendingSalesStore;
}

export function makePendingSales(store: PendingSalesStore = makePendingSalesStore()): PendingSalesApi {
  return {
    all: Effect.sync(() => store.all()),
    get: (recordId) => Effect.sync(() => store.get(recordId)),
    save: (recordId, sale) => Effect.sync(() => store.set(recordId, sale)),
    store,
  };
}

export class PendingSales extends Context.Service<PendingSales, PendingSalesApi>()("app/PendingSales") {
  /** localStorage (in-memory fallback when blocked). */
  static readonly layer: Layer.Layer<PendingSales> = Layer.sync(PendingSales, () => makePendingSales(makePendingSalesStore()));
  /** Plain memory (tests). */
  static readonly memory: Layer.Layer<PendingSales> = Layer.sync(PendingSales, () => {
    const storage = memoryStorage();
    return makePendingSales(makePendingSalesStore(() => storage));
  });
}
