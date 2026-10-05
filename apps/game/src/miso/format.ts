/**
 * Display helpers for chain values.
 *
 * Owns: turning bigint base units and object ids into short human strings.
 * Must not: do any I/O or know which network is in use. Uses exact bigint math
 * (never converts money through floating point).
 */

/**
 * Format base units as a decimal string with thousands separators.
 * formatAmount(12_500_000n, 6, "FUSD") -> "12.50 FUSD"; rounds half away from zero.
 */
export function formatAmount(
  amount: bigint,
  decimals: number,
  symbol?: string,
  fractionDigits = 2,
): string {
  const negative = amount < 0n;
  let abs = negative ? -amount : amount;
  const digits = Math.max(0, Math.min(fractionDigits, decimals));
  // Round to `digits` fractional places.
  const drop = 10n ** BigInt(decimals - digits);
  abs = (abs + drop / 2n) / drop;
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = digits > 0 ? "." + (abs % scale).toString().padStart(digits, "0") : "";
  const text = `${negative && abs !== 0n ? "-" : ""}${whole}${frac}`;
  return symbol ? `${text} ${symbol}` : text;
}

/** Shorten an object id / address / digest: "0x1a2b3c...9f0e" -> "0x1a2b…9f0e". */
export function shortId(id: string, head = 4, tail = 4): string {
  const prefix = id.startsWith("0x") ? "0x" : "";
  const body = id.slice(prefix.length);
  if (body.length <= head + tail + 1) return id;
  return `${prefix}${body.slice(0, head)}…${body.slice(-tail)}`;
}
