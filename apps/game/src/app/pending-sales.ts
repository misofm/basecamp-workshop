/**
 * PendingSales: a localStorage store for sales whose Record was transferred but not yet
 * paid, so a Retry can tell what already happened and never transfer or pay twice. An
 * adapter may use it (TestnetAdapter receives the synchronous `store` via select.ts);
 * nothing else depends on it. Falls back to memory when storage is blocked.
 *
 * Owns: the `PendingSale` shape and Schema, the stored blob's validation and the store itself.
 * Must not: import adapter implementations.
 *
 * Saving rewrites the whole map; a corrupt blob or a dropped entry is reported with
 * console.warn, never thrown; valid entries next to an invalid one are kept.
 *
 * Two faces: Effect methods for the app, and a synchronous `store` for adapter code that
 * must save a digest synchronously, before its transaction is submitted.
 */
import { Context, Effect, Layer, Schema } from "effect";
import type { OwnedRecord } from "../miso/types";

/** localStorage slot for the pending sales. */
export const PENDING_SALES_KEY = "miso-game:pending-sales:testnet";

/** One transferred-but-unpaid sale. */
export interface PendingSale {
  /** Player address that started the sale (entries for another key are ignored). */
  player: string;
  /** Player → collector transfer, saved before it was submitted. */
  transferDigest: string;
  /** Collector → player payout, saved before it was submitted. */
  payoutDigest?: string;
  /** What the collection view keeps showing until the sale is paid. */
  owned: OwnedRecord;
}

/** Minimal synchronous store: Record id → pending sale. */
export interface PendingStore {
  get(recordId: string): PendingSale | undefined;
  set(recordId: string, sale: PendingSale | null): void;
}

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

// The Schema and the PendingSale interface describe the same shape.
type _SchemaMatchesInterface = [PendingSale extends typeof PendingSaleSchema.Type ? true : never, typeof PendingSaleSchema.Type extends PendingSale ? true : never];
const _check: _SchemaMatchesInterface = [true, true];
void _check;

/** The synchronous store (adapter code). */
export type PendingSalesStore = PendingStore & { all(): Record<string, PendingSale> };

/** The subset of the Web Storage API the store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * What an entry must have to be kept: string `player` and `transferDigest`, an `owned` object. Deliberately looser than
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
 * throwing falls back to memory); when reading throws, the in-memory copy of
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
    // Corrupt JSON: the in-memory copy of the last save.
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
  /** Synchronous face for adapter code (handed to TestnetAdapter by select.ts). */
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
