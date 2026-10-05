// In-memory fund rate limits: per-address cooldown + global sliding-hour cap.
export class FundLimiter {
  private lastByAddress = new Map<string, number>();
  private recent: number[] = [];
  constructor(private cooldownMs: number, private maxPerHour: number, private now: () => number = Date.now) {}

  /** Returns a player-safe refusal message, or null if allowed. Does not record anything. */
  check(address: string): string | null {
    const t = this.now();
    const last = this.lastByAddress.get(address);
    if (last !== undefined && t - last < this.cooldownMs) {
      const mins = Math.ceil((this.cooldownMs - (t - last)) / 60_000);
      return `The bank already topped up this wallet. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
    this.recent = this.recent.filter((x) => t - x < 3_600_000);
    if (this.recent.length >= this.maxPerHour) {
      return "The bank is busy handing out funds. Try again in a few minutes.";
    }
    return null;
  }

  record(address: string): void {
    const t = this.now();
    this.lastByAddress.set(address, t);
    this.recent.push(t);
  }
}
