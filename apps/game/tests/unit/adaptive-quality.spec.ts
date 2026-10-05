import { expect, test } from "@playwright/test";
import { AdaptiveQuality, OUTLIER_MS, WARMUP_FRAMES, WINDOW_FRAMES, type Stages } from "../../src/world/adaptive-quality";

const ON: Stages = { ao: true, bloom: true };

/** Feed `n` frames of `ms`; returns every change that came out. */
function feed(q: AdaptiveQuality, n: number, ms: number, stages: Stages | null = ON) {
  const changes = [];
  for (let i = 0; i < n; i++) {
    const c = q.frame(ms, stages);
    if (c) changes.push(c);
  }
  return changes;
}

test("a long gap (tab hidden for 30 s) does not step quality down", () => {
  const q = new AdaptiveQuality(2, 0.6);
  q.reset();
  // First frame back is the whole time away, then normal frames.
  expect(q.frame(30_000, ON)).toBeNull();
  expect(feed(q, WARMUP_FRAMES + WINDOW_FRAMES * 3, 16)).toEqual([]);
  expect(q.scale).toBe(2);
});

test("outlier frames are ignored, even in bulk", () => {
  const q = new AdaptiveQuality(2, 0.6);
  q.reset(0);
  const changes = [...feed(q, 200, 16), ...feed(q, 100, OUTLIER_MS + 1)];
  expect(changes).toEqual([]);
  expect(q.scale).toBe(2);
});

test("warm-up frames after a reset are not measured", () => {
  const q = new AdaptiveQuality(2, 0.6);
  q.reset();
  expect(feed(q, WARMUP_FRAMES, 200)).toEqual([]); // slow, but still warming up
  expect(feed(q, WINDOW_FRAMES - 1, 16)).toEqual([]);
});

test("sustained 25 ms frames step down: scale first, then AO, then bloom only past 40 ms", () => {
  const q = new AdaptiveQuality(1.0, 0.7);
  q.reset(0);
  expect(feed(q, WINDOW_FRAMES, 25)).toEqual([{ scale: 0.85 }]);
  expect(feed(q, WINDOW_FRAMES, 25)).toEqual([{ scale: 0.7 }]);
  expect(feed(q, WINDOW_FRAMES, 25)).toEqual([{ ao: false }]);
  expect(feed(q, WINDOW_FRAMES, 25, { ao: false, bloom: true })).toEqual([]); // 25 ms: bloom stays
  expect(feed(q, WINDOW_FRAMES, 45, { ao: false, bloom: true })).toEqual([{ bloom: false }]);
});

test("sustained 8 ms frames step back up to the start scale (bloom, AO, then scale), and no further", () => {
  const q = new AdaptiveQuality(1.0, 0.7);
  q.reset(0);
  feed(q, WINDOW_FRAMES * 3, 25);
  feed(q, WINDOW_FRAMES, 45, { ao: false, bloom: true });
  expect(q.scale).toBe(0.7);
  expect(q.aoOff && q.bloomOff).toBe(true);
  const off: Stages = { ao: false, bloom: false };
  const ups = feed(q, WINDOW_FRAMES * 3 * 6, 8, off);
  expect(ups).toEqual([{ bloom: true }, { ao: true }, { scale: 0.85 }, { scale: 1 }]);
  expect(q.scale).toBe(1);
  expect(feed(q, WINDOW_FRAMES * 3 * 3, 8)).toEqual([]);
});

test("hysteresis: 16 ms frames neither step up nor down, and a slow window resets the up count", () => {
  const q = new AdaptiveQuality(1.0, 0.7);
  q.reset(0);
  feed(q, WINDOW_FRAMES, 25); // scale 0.85
  expect(feed(q, WINDOW_FRAMES * 10, 16)).toEqual([]);
  // two fast windows, one slow, two fast: never three in a row
  expect([...feed(q, WINDOW_FRAMES * 2, 8), ...feed(q, WINDOW_FRAMES, 30)]).toEqual([{ scale: 0.7 }]);
  expect(feed(q, WINDOW_FRAMES * 2, 8)).toEqual([]);
});
