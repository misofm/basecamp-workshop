// Persistent payout ledger (server/data/paid.json): digest -> payout. Atomic writes.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PaidEntry {
  paymentDigest: string;
  paid: string;
  seller: string;
  recordId: string;
  at: number;
}

export class PaidStore {
  private byDigest: Record<string, PaidEntry> = {};
  private byRecord = new Map<string, string>();
  private file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, "paid.json");
    try {
      this.byDigest = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, PaidEntry>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Cannot parse ${this.file}; fix or remove it`);
    }
    for (const [digest, e] of Object.entries(this.byDigest)) this.byRecord.set(e.recordId, digest);
  }

  get size(): number {
    return this.byRecord.size;
  }

  getByDigest(digest: string): PaidEntry | undefined {
    return this.byDigest[digest];
  }

  /** Digest that already got paid for this record, if any. */
  digestForRecord(recordId: string): string | undefined {
    return this.byRecord.get(recordId);
  }

  put(digest: string, entry: PaidEntry): void {
    this.byDigest[digest] = entry;
    this.byRecord.set(entry.recordId, digest);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.byDigest, null, 2));
    renameSync(tmp, this.file);
  }
}
