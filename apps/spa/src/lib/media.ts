import type { SyntheticEvent } from "react";
import { MISO_CDN, WALRUS_AGGREGATOR } from "../config";
import type { Release, Track } from "./types";

// Covers and audio come from the Miso CDN, addressed by Walrus blob / quilt ids.
// The CDN only serves media Miso uploaded itself; anything else falls back to the public Walrus aggregator,
// which serves the same paths (without ?w= resizing).

export function coverUrl(release: Release, width = 512): string | null {
  const blobId = release.cover?.still?.blobId;
  return blobId ? `${MISO_CDN}/blobs/${blobId}?w=${width}&f=webp` : null;
}

/** <img onError>: retry a CDN cover once from the Walrus aggregator (original size, no query string). */
export function coverFallback(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (!img.src.startsWith(MISO_CDN)) return; // already the fallback: give up
  img.src = WALRUS_AGGREGATOR + img.src.slice(MISO_CDN.length).split("?")[0];
}

/** HLS playlist (fMP4 AAC, 96 kbps), the same rendition the official app uses for previews. */
export function hlsUrl(track: Track, base = MISO_CDN): string {
  return `${base}/blobs/by-quilt-id/${track.transcodeQuiltId}/aac-96.m3u8`;
}

export function trackDurationSeconds(track: Track): number {
  return Number(track.master.samples) / track.master.sample_rate_hz;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const KIND_LABELS: Record<string, string> = { ExtendedPlay: "EP", Album: "Album", Single: "Single" };

export function formatKind(kind: string | null): string {
  if (!kind) return "Release";
  return KIND_LABELS[kind] ?? kind;
}

/** "ArtistsAndRepertoire" -> "A&R", "MixingEngineer (Additional)" -> "Mixing Engineer (Additional)" */
export function formatRole(role: string): string {
  if (role === "ArtistsAndRepertoire") return "A&R";
  return role.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Shortens long ids so log lines stay readable: 0x1234567890abcdef... -> 0x1234...cdef.
 * Also shortens Walrus blob / quilt ids (long base64url path segments). */
export function shortId(text: string): string {
  return text
    .replace(/0x[0-9a-fA-F]{12,}/g, (id) => `${id.slice(0, 6)}...${id.slice(-4)}`)
    .replace(/(?<=\/)[A-Za-z0-9_-]{32,}(?=\/|$)/g, (id) => `${id.slice(0, 4)}...${id.slice(-4)}`);
}
