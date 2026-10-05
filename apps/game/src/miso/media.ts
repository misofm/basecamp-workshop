/**
 * Media hosts for covers and HLS audio.
 *
 * Owns: the Miso CDN base and its fallback, the public Walrus testnet aggregator.
 * The CDN only serves media Miso uploaded itself (the workshop releases); anything else
 * (e.g. a release published through the public Walrus publisher) 404s there. The
 * aggregator serves the same /blobs/... paths, without ?w= resizing, and is slower.
 * Must not: do I/O.
 */
export const MISO_CDN = "https://cdn.miso.fm/v1";
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1";

/** The same blob on the aggregator, or null when `url` is not a CDN URL (mock covers, or already the fallback). */
export function aggregatorFallback(url: string): string | null {
  if (!url.startsWith(MISO_CDN)) return null;
  return WALRUS_AGGREGATOR + url.slice(MISO_CDN.length).split("?")[0];
}

/** `<img onerror>`: retry a CDN cover once from the aggregator. */
export function coverFallback(event: Event): void {
  const img = event.currentTarget as HTMLImageElement;
  const next = aggregatorFallback(img.src);
  if (next) img.src = next;
}
