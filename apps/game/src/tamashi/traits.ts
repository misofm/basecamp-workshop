/**
 * Tamashi traits: typed access to the hand-read description of all 100 Tamashi
 * (traits.json, one entry per token, read by eye from the Studio Mirai artwork).
 *
 * Owns: the trait types and lookups by id. Values the schema didn't foresee are kept as
 * `"other: …"` strings; consumers must fall back gracefully on anything they don't know.
 * Must not: build geometry or textures (tv-head.ts, screen.ts, body.ts do that).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import raw from "./traits.json";

/** A free-form value outside the schema's list, e.g. "other: witch hat". */
export type Other = `other: ${string}`;
/** CSS hex colour, "#rrggbb". */
export type Hex = string;

export type TvShape = "standard" | "wide" | "tall" | "portable" | "boxy" | "rounded";
export type TvFinish = "matte" | "glossy" | "metallic" | "wood" | "chrome" | "patterned" | "transparent";
export type Antennas = "two" | "one" | "none" | "bent" | "broken" | "four";
export type AntennaTip = "ball" | "plain" | "none";
export type SidePanel = "knobs-and-grille" | "knobs" | "grille" | "plain";
export type ScreenKind = "face" | "scene" | "static" | "dark" | "reflection" | "image";
export type Glow = "none" | "soft" | "strong";
export type Eyes = "vertical-lines" | "dots" | "glasses" | "visor" | "closed" | "x" | "none";
export type Mouth = "mustache" | "smile" | "teeth" | "frown";
export type HeadwearType = "crown" | "chef-hat" | "straw-hat" | "cap" | "beanie" | "helmet" | "halo" | "flower";
export type OutfitType =
  | "tracksuit"
  | "suit"
  | "tuxedo"
  | "hoodie"
  | "lab-coat"
  | "spacesuit"
  | "chef-coat"
  | "overalls"
  | "jersey"
  | "tank-top"
  | "t-shirt"
  | "kimono"
  | "jacket"
  | "armor"
  | "shirtless";

export interface TamashiTraits {
  id: number;
  tv: {
    shape: TvShape | Other;
    bodyColor: Hex;
    bodyFinish: TvFinish | Other;
    pattern: string | null;
    bezelColor: Hex;
    antennas: Antennas | Other;
    antennaTip: AntennaTip | Other;
    sidePanel: SidePanel | Other;
    knobColor: Hex | null;
    damage: string | null;
  };
  screen: {
    kind: ScreenKind | Other;
    background: Hex;
    glow: Glow | Other;
    eyes: Eyes | Other;
    eyeColor: Hex | null;
    mouth: Mouth | Other | null;
    sceneDescription: string | null;
  };
  headwear: { type: HeadwearType | Other; color: Hex } | null;
  outfit: {
    type: OutfitType | Other;
    primary: Hex;
    secondary: Hex;
    accent: Hex | null;
    details: string;
  };
  skinTone: Hex | null;
  /** e.g. "power-plug-cable", "tie", "bowtie", "necklace", "scarf", "backpack", or free text. */
  accessories: string[];
  background: { setting: string; palette: Hex[] };
  vibe: string;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export const TAMASHI_COUNT = 100;

/** All 100, index = id - 1. */
export const TRAITS: readonly TamashiTraits[] = (raw as unknown as TamashiTraits[]).slice().sort((a, b) => a.id - b.id);

/** Traits for token `id` (1..100). Throws on an unknown id: that is a programming error. */
export function traitsFor(id: number): TamashiTraits {
  const t = TRAITS[id - 1];
  if (!t || t.id !== id) throw new Error(`No Tamashi #${id}`);
  return t;
}

/** "other: witch hat" → "witch hat"; known values pass through. */
export function otherText(value: string | null | undefined): string {
  return value ? value.replace(/^other:\s*/, "") : "";
}

/** True when `value` is one of the schema's listed values (not an "other: …" string). */
export function isKnown<T extends string>(value: string | null | undefined, known: readonly T[]): value is T {
  return value != null && (known as readonly string[]).includes(value);
}

/** Does the text of a trait (value, details, notes) mention any of these words? Case-insensitive. */
export function mentions(text: string | null | undefined, ...words: string[]): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
}
