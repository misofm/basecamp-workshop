/**
 * Config: every URL param the app reads, decoded once with Effect `Schema`.
 *
 * Owns: the parse of `location.search` (memoised per search string) and the `Config`
 * service. Invalid values fall back exactly as the old per-module readers did; parsing
 * never throws.
 * Must not: decide anything (the adapter choice stays in miso/select.ts, the tier in
 * world/quality.ts); this is only the decoded params.
 *
 *   e2e test builds only (miso/select.ts; ignored by the game otherwise):
 *   ?latency=<ms>         finite → max(0, n), else null
 *   ?fail=<mode>          purchase|sell|withdraw|all|purchase-lost|sell-lost|withdraw-lost,
 *                         else null (+ the select.ts warning for an unknown value)
 *   ?mockhls=1|true       mockHls
 *   Everything else:
 *   ?quality=high|medium|low, ?backend=webgl|webgpu (else null)
 *   ?adapt=0              adapt false (anything else true)
 *   ?exposure=<0.3–4>     finite, in range, else null
 *   ?ui=0|off|false       uiVisible false
 *   ?cameo=0, ?particles=0, ?shadows=0   false (anything else true)
 *   ?debug=1, ?rain=1     true (anything else false)
 *   ?gallery=<id>         non-empty string, else null
 *   ?hide=a,b             non-empty names
 */
import { Context, Layer, Option, Schema } from "effect";
import type { FailureMode } from "../miso/mock-adapter";

export interface AppConfig {
  readonly latencyMs: number | null;
  readonly failureMode: FailureMode | null;
  readonly mockHls: boolean;
  readonly quality: "high" | "medium" | "low" | null;
  readonly backend: "webgl" | "webgpu" | null;
  readonly adapt: boolean;
  readonly exposure: number | null;
  readonly uiVisible: boolean;
  readonly cameo: boolean;
  readonly debug: boolean;
  readonly gallery: string | null;
  readonly particles: boolean;
  readonly rain: boolean;
  readonly hide: readonly string[];
  readonly shadows: boolean;
}

/** Same order as select.ts (it is printed in the warning). */
const FAIL_MODES = ["purchase", "sell", "withdraw", "all", "purchase-lost", "sell-lost", "withdraw-lost"] as const;

const FailMode = Schema.Literals(FAIL_MODES);
const Quality = Schema.Literals(["high", "medium", "low"]);
const BackendParam = Schema.Literals(["webgl", "webgpu"]);
const Latency = Schema.Finite;
const Exposure = Schema.Finite.check(Schema.isBetween({ minimum: 0.3, maximum: 4 }));
const Off = Schema.Literal("0");
const On = Schema.Literal("1");
const MockHlsOn = Schema.Literals(["1", "true"]);
const UiOff = Schema.Literals(["0", "off", "false"]);
const NonEmpty = Schema.NonEmptyString;

const isOff = Schema.is(Off);
const isOn = Schema.is(On);
const isMockHlsOn = Schema.is(MockHlsOn);
const isUiOff = Schema.is(UiOff);

/** Decode `input` with `schema`; anything invalid is `null`. Never throws. */
function decodeOrNull<T>(schema: Schema.ConstraintDecoder<T>, input: unknown): T | null {
  return Option.getOrNull(Schema.decodeUnknownOption(schema)(input));
}

export interface ParseOptions {
  /** Emit the console warning for an unknown `?fail=` (default true). */
  readonly warn?: boolean;
}

/** Decode every URL param in `search` (e.g. `"?quality=low&ui=0"`). */
export function parseConfig(search: string, options?: ParseOptions): AppConfig {
  const p = new URLSearchParams(search);
  const get = (name: string) => p.get(name);

  const latencyRaw = get("latency");
  const latency = latencyRaw === null ? null : decodeOrNull(Latency, Number(latencyRaw));

  const fail = get("fail");
  const failureMode = fail === null ? null : decodeOrNull(FailMode, fail);
  if (fail !== null && failureMode === null && options?.warn !== false) {
    console.warn(`[miso] ignoring ?fail=${fail} (expected ${FAIL_MODES.join("|")})`);
  }

  return {
    latencyMs: latency === null ? null : Math.max(0, latency),
    failureMode,
    mockHls: isMockHlsOn(get("mockhls")),
    quality: decodeOrNull(Quality, get("quality")),
    backend: decodeOrNull(BackendParam, get("backend")),
    adapt: !isOff(get("adapt")),
    // Number(null) and Number("") are 0: out of range, so null (as atmosphere.ts did).
    exposure: decodeOrNull(Exposure, Number(get("exposure"))),
    uiVisible: !isUiOff(get("ui")),
    cameo: !isOff(get("cameo")),
    debug: isOn(get("debug")),
    gallery: decodeOrNull(NonEmpty, get("gallery")),
    particles: !isOff(get("particles")),
    rain: isOn(get("rain")),
    hide: (get("hide") ?? "").split(",").filter(Boolean),
    shadows: !isOff(get("shadows")),
  };
}

/**
 * miso/select.ts still parses `?fail=` itself and prints the warning; until it reads
 * urlConfig(), the page-level parse stays quiet so the warning appears once per page.
 */
const URL_CONFIG_WARNS = false;

let memo: { search: string; config: AppConfig } | null = null;

/** The parse of `location.search` ("" without a location), memoised per search string. */
export function urlConfig(): AppConfig {
  const search = typeof location === "undefined" ? "" : location.search;
  if (memo === null || memo.search !== search) memo = { search, config: parseConfig(search, { warn: URL_CONFIG_WARNS }) };
  return memo.config;
}

/** The decoded URL params as a service. */
export class Config extends Context.Service<Config, AppConfig>()("app/Config") {
  /** From the page URL (memoised `urlConfig()`). */
  static readonly layer = Layer.sync(Config, () => urlConfig());
  /** From an explicit search string (tests, tools). */
  static fromSearch(search: string) {
    return Layer.sync(Config, () => parseConfig(search));
  }
}
