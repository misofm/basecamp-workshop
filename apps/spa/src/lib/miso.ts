import { FAKEUSD_TYPE, MISO_API } from "../config";
import { getJson, getJsonOrNull } from "./http";
import { derivePressingId, listReleaseIds } from "./sui";
import type { Artist, Credit, Listing, Lyrics, Pressing, Release, WalletRecord } from "./types";

// Typed read functions for the Miso API. Every call is a plain, keyless GET.

export function getRelease(id: string) {
  return getJson<Release>(`${MISO_API}/protocol/releases/${id}?include=trackCredits`);
}

/** Every published release on chain, newest first. */
export async function loadCatalog(): Promise<Release[]> {
  const ids = await listReleaseIds();
  // One request per release. allSettled: a single broken release should not hide the rest.
  const results = await Promise.allSettled(ids.map(getRelease));
  return results
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .filter((release) => release.state.type === "Published")
    .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
}

export async function getLyrics(compositionId: string) {
  const res = await getJsonOrNull<Lyrics>(`${MISO_API}/compositions/${compositionId}/lyrics`);
  return res?.lyrics ?? [];
}

export function getArtist(partyId: string) {
  return getJson<Artist>(`${MISO_API}/platform/artists/${partyId}`);
}

export function getPressing(pressingId: string) {
  return getJsonOrNull<Pressing>(`${MISO_API}/platform/pressings/${pressingId}`);
}

/** Probe editions 1, 2, 3... until the first 404 (normally two requests). */
export async function getPressings(releaseId: string): Promise<Pressing[]> {
  const pressings: Pressing[] = [];
  for (let edition = 1; edition <= 20; edition++) {
    const pressing = await getPressing(derivePressingId(releaseId, edition));
    if (!pressing) break;
    pressings.push(pressing);
  }
  return pressings;
}

export function getListing(pressingId: string) {
  const currency = encodeURIComponent(FAKEUSD_TYPE);
  return getJsonOrNull<Listing>(`${MISO_API}/platform/pressings/${pressingId}/listing?currencyType=${currency}`);
}

/** Records owned by a wallet. Never cached: this changes whenever someone buys a record. */
export function getWalletRecords(address: string) {
  return getJson<WalletRecord[]>(`${MISO_API}/platform/wallets/${address}/records`, { cache: false });
}

/** Credited primary artists of a release, falling back to plain names. */
export function primaryArtists(release: Release): { partyId?: string; name: string }[] {
  const credited = release.credits.filter((credit) => credit.roles.includes("Primary"));
  if (credited.length > 0) return credited.map((c) => ({ partyId: c.partyId, name: c.displayName }));
  return release.primaryArtists.map((name) => ({ name }));
}

export function artistNames(release: Release) {
  return primaryArtists(release).map((artist) => artist.name).join(", ");
}

/** All composition and recording credits across the tracks of a release. */
export function allTrackCredits(release: Release): Credit[] {
  return Object.values(release.trackCredits ?? {}).flatMap((tc) => [
    ...tc.compositionCredits,
    ...tc.recordingCredits.credits,
  ]);
}
