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
 * rewrites the whole map, memory fallback when storage throws), except validation: corrupt
 * JSON or a Schema-invalid entry is dropped and logged with console.warn, never thrown;
 * valid entries next to an invalid one are kept.
 *
 * Two faces: Effect methods for the app, and a synchronous `store` for sell.ts (it saves
 * the digest synchronously, before the transaction is submitted).
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
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

const decodeEntry = Schema.decodeUnknownOption(PendingSaleSchema);

/** Parse the stored JSON; drop (and log) anything that does not decode. Never throws. */
export function parsePendingSales(raw: string | null): Record<string, PendingSale> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("[pending-sales] ignoring corrupt stored pending sales:", error);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("[pending-sales] ignoring stored pending sales that are not an object");
    return {};
  }
  const out: Record<string, PendingSale> = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const decoded = decodeEntry(entry);
    if (Option.isSome(decoded)) out[id] = decoded.value;
    else console.warn(`[pending-sales] dropping invalid pending sale for ${id}`);
  }
  return out;
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
    return parsePendingSales(raw);
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
