import { expect, test } from "@playwright/test";
import { hlsUrl } from "../../src/audio/deck";
import { aggregatorFallback, MISO_CDN } from "../../src/miso/media";

const AGG = "https://aggregator.walrus-testnet.walrus.space/v1/blobs";

test("a CDN cover falls back to the same blob on the aggregator, without resizing", () => {
  const url = `${MISO_CDN}/blobs/_14bfo-_m-4y0u7n9xLSSvVCNWw8wNtS5WikwKqoXVQ`;
  expect(aggregatorFallback(url)).toBe(`${AGG}/_14bfo-_m-4y0u7n9xLSSvVCNWw8wNtS5WikwKqoXVQ`);
});

test("a CDN HLS playlist falls back to the aggregator quilt path", () => {
  expect(aggregatorFallback(hlsUrl("97Abt1Vi5uwpkNyyHSgjdvY1IvqsNrvMRcUbpHJosOs"))).toBe(
    `${AGG}/by-quilt-id/97Abt1Vi5uwpkNyyHSgjdvY1IvqsNrvMRcUbpHJosOs/aac-96.m3u8`,
  );
});

test("fallback happens once and never for mock covers", () => {
  const once = aggregatorFallback(`${MISO_CDN}/blobs/abc`)!;
  expect(aggregatorFallback(once)).toBeNull();
  expect(aggregatorFallback("/covers/neon.png")).toBeNull();
});
