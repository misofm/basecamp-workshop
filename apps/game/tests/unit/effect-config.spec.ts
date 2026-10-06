import { expect, test } from "@playwright/test";
import { Effect } from "effect";
import { Config, parseConfig, urlConfig, type AppConfig } from "../../src/app/config";
import { uiVisibleFromSearch } from "../../src/ui/ui-visibility";
import { adapterOptionsFromUrl } from "../../src/miso/select";

const DEFAULTS: AppConfig = {
  latencyMs: null,
  failureMode: null,
  mockHls: false,
  quality: null,
  backend: null,
  adapt: true,
  exposure: null,
  uiVisible: true,
  cameo: true,
  debug: false,
  gallery: null,
  particles: true,
  rain: false,
  hide: [],
  shadows: true,
};

/** Capture console.warn while `fn` runs. */
function warnings(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => void seen.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

test("empty search gives the defaults", () => {
  expect(parseConfig("")).toEqual(DEFAULTS);
  expect(parseConfig("?")).toEqual(DEFAULTS);
  expect(parseConfig("?unrelated=1")).toEqual(DEFAULTS);
});

const cases: [string, Partial<AppConfig>][] = [
  ["?latency=1500", { latencyMs: 1500 }],
  ["?latency=-5", { latencyMs: 0 }],
  ["?latency=", { latencyMs: 0 }], // Number("") === 0, as select.ts
  ["?latency=abc", { latencyMs: null }],
  ["?latency=Infinity", { latencyMs: null }],
  ["?fail=purchase", { failureMode: "purchase" }],
  ["?fail=sell-lost", { failureMode: "sell-lost" }],
  ["?fail=all", { failureMode: "all" }],
  ["?mockhls=1", { mockHls: true }],
  ["?mockhls=true", { mockHls: true }],
  ["?mockhls=0", { mockHls: false }],
  ["?mockhls=yes", { mockHls: false }],
  ["?quality=high", { quality: "high" }],
  ["?quality=medium", { quality: "medium" }],
  ["?quality=low", { quality: "low" }],
  ["?quality=ultra", { quality: null }],
  ["?quality=LOW", { quality: null }],
  ["?backend=webgl", { backend: "webgl" }],
  ["?backend=webgpu", { backend: "webgpu" }],
  ["?backend=vulkan", { backend: null }],
  ["?adapt=0", { adapt: false }],
  ["?adapt=1", { adapt: true }],
  ["?adapt=false", { adapt: true }],
  ["?adapt=", { adapt: true }],
  ["?exposure=1.2", { exposure: 1.2 }],
  ["?exposure=0.3", { exposure: 0.3 }],
  ["?exposure=4", { exposure: 4 }],
  ["?exposure=0.29", { exposure: null }],
  ["?exposure=4.01", { exposure: null }],
  ["?exposure=0", { exposure: null }],
  ["?exposure=", { exposure: null }],
  ["?exposure=abc", { exposure: null }],
  ["?exposure=Infinity", { exposure: null }],
  ["?ui=0", { uiVisible: false }],
  ["?ui=off", { uiVisible: false }],
  ["?ui=false", { uiVisible: false }],
  ["?ui=1", { uiVisible: true }],
  ["?ui=", { uiVisible: true }],
  ["?cameo=0", { cameo: false }],
  ["?cameo=no", { cameo: true }],
  ["?debug=1", { debug: true }],
  ["?debug=true", { debug: false }],
  ["?gallery=1", { gallery: "1" }],
  ["?gallery=nozomi", { gallery: "nozomi" }],
  ["?gallery=", { gallery: null }],
  ["?particles=0", { particles: false }],
  ["?particles=1", { particles: true }],
  ["?rain=1", { rain: true }],
  ["?rain=0", { rain: false }],
  ["?rain=true", { rain: false }],
  ["?hide=shop", { hide: ["shop"] }],
  ["?hide=shop,city", { hide: ["shop", "city"] }],
  ["?hide=,shop,,city,", { hide: ["shop", "city"] }],
  ["?hide=", { hide: [] }],
  ["?shadows=0", { shadows: false }],
  ["?shadows=off", { shadows: true }],
  ["?quality=low&ui=0&cameo=0&rain=1", { quality: "low", uiVisible: false, cameo: false, rain: true }],
  ["?quality=medium&quality=low", { quality: "medium" }], // first value wins, as URLSearchParams.get
  ["quality=low", { quality: "low" }], // no leading "?"
];

for (const [search, expected] of cases) {
  test(`parseConfig(${JSON.stringify(search)})`, () => {
    const seen = warnings(() => expect(parseConfig(search)).toEqual({ ...DEFAULTS, ...expected }));
    expect(seen).toEqual([]);
  });
}

test("an unknown ?fail= falls back to null with the select.ts warning", () => {
  const expected =
    "[miso] ignoring ?fail=bogus (expected purchase|sell|withdraw|all|purchase-lost|sell-lost|withdraw-lost)";
  expect(warnings(() => expect(parseConfig("?fail=bogus").failureMode).toBeNull())).toEqual([expected]);
  // "none" is not accepted from the URL either.
  expect(warnings(() => expect(parseConfig("?fail=none").failureMode).toBeNull())).toHaveLength(1);
  expect(warnings(() => expect(parseConfig("?fail=").failureMode).toBeNull())).toEqual([
    "[miso] ignoring ?fail= (expected purchase|sell|withdraw|all|purchase-lost|sell-lost|withdraw-lost)",
  ]);
  expect(warnings(() => parseConfig("?fail=bogus", { warn: false }))).toEqual([]);
});

test("uiVisibleFromSearch delegates to parseConfig", () => {
  for (const s of ["", "?ui=0", "?ui=off", "?ui=false", "?ui=1", "?latency=0&ui=off"]) {
    expect(uiVisibleFromSearch(s)).toBe(parseConfig(s).uiVisible);
  }
});

test("urlConfig without a location is the empty-search parse, memoised", () => {
  expect(typeof location).toBe("undefined");
  const a = urlConfig();
  expect(a).toEqual(DEFAULTS);
  expect(urlConfig()).toBe(a);
});

test("Config service: fromSearch and layer", async () => {
  const fromSearch = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Config;
    }).pipe(Effect.provide(Config.fromSearch("?quality=low&hide=a,b"))),
  );
  expect(fromSearch).toEqual({ ...DEFAULTS, quality: "low", hide: ["a", "b"] });
  const fromLocation = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* Config;
    }).pipe(Effect.provide(Config.layer)),
  );
  expect(fromLocation).toBe(urlConfig());
});

test("mock knobs agree with select.ts adapterOptionsFromUrl (same warnings too)", () => {
  const searches = ["", "?latency=1500", "?latency=-5", "?latency=", "?latency=abc", "?fail=sell", "?fail=withdraw-lost", "?fail=bogus", "?fail=", "?mockhls=1", "?mockhls=true", "?mockhls=2"];
  for (const s of searches) {
    let old: ReturnType<typeof adapterOptionsFromUrl> = {};
    let cfg: AppConfig = DEFAULTS;
    const oldWarn = warnings(() => (old = adapterOptionsFromUrl(s)));
    const newWarn = warnings(() => (cfg = parseConfig(s)));
    expect(newWarn, s).toEqual(oldWarn);
    expect(cfg.latencyMs ?? undefined, s).toBe(old.latencyMs);
    expect(cfg.failureMode ?? undefined, s).toBe(old.failureMode);
    expect(cfg.mockHls || undefined, s).toBe(old.mockHls);
  }
});
