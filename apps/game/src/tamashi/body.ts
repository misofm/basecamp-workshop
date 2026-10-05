/**
 * Tamashi bodies: stylised low-poly humanoid parts in outfit colours, outfit variants and
 * accessories (plug cable, tie, bowtie, necklace, scarf, backpack, cape …).
 *
 * Owns: resolving `traits.outfit` (+ "other: …" text via mentions()) into a Look, and
 * building torso / arms / legs / collars / panels on the rig bones. The art only shows
 * busts, so legs, shoes and trousers are invented to match.
 * Must not: build the TV (tv-head.ts) or hats (headwear.ts); animate (character.ts).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { mentions, otherText, type TamashiTraits } from "./traits";
import { box, cone, cyl, limb, PartBuilder, rbox, sphere, taperBox, torus, tr, tube, type Weights } from "./geometry";
import { CLOTH, col, colorWord, GOLD, lum, METAL, mix, PLASTIC, RUBBER, shade, SKIN, type Finish } from "./materials";
import { J, type RigBone } from "./rig";
import type { TvDims } from "./tv-head";

type Collar = "crew" | "turtle" | "lapel" | "cross" | "hood" | "mandarin" | "ring" | "shirt" | "v" | "sailor" | "none";

export interface Look {
  skin: THREE.Color;
  top: THREE.Color;
  sleeve: THREE.Color;
  sleeves: "long" | "short" | "none";
  cuff: THREE.Color | null;
  pants: THREE.Color;
  shorts: boolean;
  shoes: THREE.Color;
  sole: THREE.Color;
  hands: THREE.Color;
  bulk: number;
  /** Shirt hangs over the waist (t-shirts, hoodies) instead of tucked in. */
  untucked: boolean;
  collar: Collar;
  collarColor: THREE.Color;
  /** Visible shirt under an open jacket/coat/vest, or null. */
  inner: THREE.Color | null;
  /** Coat/robe/skirt hem length below the waist (m), 0 = none. */
  coat: number;
  coatColor: THREE.Color;
  coatOpen: boolean;
  sash: THREE.Color | null;
  belt: THREE.Color | null;
  stripes: THREE.Color | null;
  tie: THREE.Color | null;
  bowtie: THREE.Color | null;
  buttons: THREE.Color | null;
  double: boolean;
  bib: THREE.Color | null; // overalls
  apron: THREE.Color | null;
  vest: THREE.Color | null;
  vestStripes: THREE.Color | null;
  suspenders: THREE.Color | null;
  cape: THREE.Color | null;
  fur: boolean;
  panel: THREE.Color | null; // chest panel / number / emblem
  dots: THREE.Color | null;
  armor: THREE.Color | null;
  armorTrim: THREE.Color | null;
  snowman: boolean;
  pocket: boolean;
  shawl: THREE.Color | null;
}

const DENIM = "#2e3a52";
const DARK = "#26262c";

function sat(c: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  c.clone().convertLinearToSRGB().getHSL(hsl);
  return hsl.s;
}

/** Resolve the outfit into colours and features. */
export function resolveLook(t: TamashiTraits): Look {
  const o = t.outfit;
  const P = col(o.primary);
  const S = col(o.secondary, o.primary);
  const A = o.accent ? col(o.accent) : null;
  const skin = col(t.skinTone, "#c49a74");
  const type = String(o.type);
  const text = `${otherText(type)} · ${o.details}`.toLowerCase();
  const acc = t.accessories.join(" · ").toLowerCase();
  const casualPants = lum(S) < 0.45 && sat(S) < 0.5 ? shade(S, 0.9) : col(DENIM);
  const L: Look = {
    skin,
    top: P,
    sleeve: P,
    sleeves: "long",
    cuff: null,
    pants: casualPants,
    shorts: false,
    shoes: col(DARK),
    sole: col("#3a3a40"),
    hands: skin,
    bulk: 1,
    untucked: false,
    collar: "crew",
    collarColor: shade(P, 0.85),
    inner: null,
    coat: 0,
    coatColor: P,
    coatOpen: false,
    sash: null,
    belt: null,
    stripes: null,
    tie: null,
    bowtie: null,
    buttons: null,
    double: false,
    bib: null,
    apron: null,
    vest: null,
    vestStripes: null,
    suspenders: null,
    cape: null,
    fur: false,
    panel: null,
    dots: null,
    armor: null,
    armorTrim: null,
    snowman: false,
    pocket: false,
    shawl: null,
  };
  const sneakers = () => {
    L.shoes = col("#ececf0");
    L.sole = col("#d0d0d6");
  };
  const formalInner = () => (lum(S) > 0.55 ? S : col("#ecebe8"));
  const is = (...w: string[]) => mentions(text, ...w);

  switch (type) {
    case "tracksuit":
      L.pants = P;
      L.stripes = A ?? S;
      L.collarColor = S;
      if (is("sleeve") && is("violet", "purple")) L.sleeve = mix(P, S, 0.42);
      L.cuff = S;
      sneakers();
      break;
    case "suit":
      L.pants = P;
      L.collar = "lapel";
      L.inner = formalInner();
      L.tie = null;
      L.shoes = col("#1a1a1c");
      break;
    case "tuxedo":
      L.pants = P;
      L.collar = "lapel";
      L.inner = lum(S) > 0.5 ? S : col("#f4f4f4");
      L.buttons = col("#111111");
      L.shoes = col("#111112");
      break;
    case "hoodie":
      L.collar = "hood";
      L.collarColor = shade(P, 0.9);
      L.pocket = true;
      L.untucked = true;
      L.pants = lum(S) < 0.4 ? S : col(DENIM);
      sneakers();
      break;
    case "lab-coat":
      L.coat = 0.46;
      L.coatColor = P;
      L.coatOpen = true;
      L.collar = "lapel";
      L.top = P;
      L.inner = colorDistanceSafe(S, P) > 0.15 ? S : col("#d8dce4");
      L.pants = col("#2e323c");
      break;
    case "spacesuit":
      L.bulk = 1.14;
      L.pants = P;
      L.collar = "ring";
      L.collarColor = col("#d8dcdc");
      L.panel = A ?? S;
      L.hands = S;
      L.shoes = shade(P, 0.9);
      L.sole = S;
      L.cuff = S;
      L.belt = S;
      break;
    case "chef-coat":
      L.collar = "mandarin";
      L.collarColor = P;
      L.buttons = A ?? col("#222222");
      L.double = true;
      L.pants = col("#3a3a40");
      L.untucked = true;
      break;
    case "overalls":
      L.top = S;
      L.sleeve = S;
      L.pants = P;
      L.bib = P;
      L.buttons = A ?? col("#d0b060");
      L.collar = "shirt";
      L.collarColor = shade(S, 1.05);
      L.shoes = col("#4a3424");
      break;
    case "jersey":
      L.sleeves = "short";
      L.collar = "v";
      L.collarColor = S;
      L.panel = S;
      L.pants = S;
      L.shorts = true;
      L.untucked = true;
      sneakers();
      break;
    case "tank-top":
      L.sleeves = "none";
      L.collarColor = S;
      L.pants = lum(S) < 0.4 ? S : col(DENIM);
      sneakers();
      break;
    case "t-shirt":
      L.sleeves = "short";
      L.untucked = true;
      L.collarColor = shade(P, 0.85);
      sneakers();
      break;
    case "kimono":
      L.collar = "cross";
      L.collarColor = S;
      L.coat = 0.72;
      L.coatColor = P;
      L.sash = A ?? S;
      L.pants = shade(P, 0.8);
      L.shoes = col("#3a2a20");
      break;
    case "jacket":
      L.collar = "lapel";
      L.coatOpen = true;
      L.inner = S;
      L.pants = col(DENIM);
      sneakers();
      break;
    case "armor":
      L.top = S;
      L.sleeve = S;
      L.armor = P;
      L.armorTrim = A ?? col("#d0a040");
      L.pants = shade(S, 0.8);
      L.hands = shade(S, 0.8);
      L.shoes = shade(S, 0.6);
      L.bulk = 1.06;
      L.belt = shade(S, 0.6);
      break;
    case "shirtless":
      L.top = skin;
      L.sleeve = skin;
      L.sleeves = "none";
      L.collar = "none";
      L.pants = colorDistanceSafe(S, skin) > 0.25 && lum(S) < 0.6 && sat(S) < 0.45 ? shade(S, 0.85) : col("#34343c");
      L.belt = col("#2a2420");
      break;
    default:
      otherOutfit(L, text, P, S, A, skin, acc);
  }
  // Accessories that change the look.
  if (mentions(acc, "tie") && !mentions(acc, "bowtie")) L.tie = A && colorDistanceSafe(A, L.inner ?? L.top) > 0.2 ? A : lum(L.inner ?? L.top) > 0.5 ? shade(P, 0.8) : col("#1a1a1c");
  if (mentions(acc, "bowtie") || type === "tuxedo") L.bowtie = A ?? (type === "tuxedo" ? P : S);
  if (mentions(acc, "cape") || is("cape")) {
    L.cape = mentions(acc, "royal") ? col("#5a1a6a") : S;
    L.fur = mentions(acc, "fur");
  }
  if (mentions(acc, "safety-vest", "safety vest") && !L.vest) {
    L.vest = col("#f0e020");
    L.vestStripes = col("#e0e0e0");
  }
  if (mentions(acc, "suspenders") && !L.suspenders) L.suspenders = S;
  return L;
}

function colorDistanceSafe(a: THREE.Color, b: THREE.Color): number {
  const x = a.clone().convertLinearToSRGB();
  const y = b.clone().convertLinearToSRGB();
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}

/** "other: …" outfits: pick the nearest variant from the words. */
function otherOutfit(L: Look, text: string, P: THREE.Color, S: THREE.Color, A: THREE.Color | null, skin: THREE.Color, _acc: string): void {
  const is = (...w: string[]) => mentions(text, ...w);
  const neutralPants = lum(S) < 0.35 && sat(S) < 0.45 ? S : col(DENIM);
  L.pants = neutralPants;
  if (is("snowman")) {
    L.snowman = true;
    L.top = P;
    L.sleeve = shade(col("#6a4a2a"), 1);
    L.sleeves = "long";
    L.pants = P;
    L.hands = col("#5a3a20");
    L.shoes = shade(P, 0.92);
    L.sole = shade(P, 0.85);
    L.collar = "none";
    L.buttons = col("#222222");
    L.bulk = 1.12;
    return;
  }
  if (is("jigsaw", "puzzle")) {
    L.top = P;
    L.sleeve = S;
    L.pants = A ?? S;
    L.hands = S;
    L.collar = "none";
    L.dots = A ?? S;
    return;
  }
  if (is("line art", "uncolored")) {
    L.top = P;
    L.pants = S;
    L.collar = "crew";
    return;
  }
  if (is("seifuku", "sailor")) {
    L.collar = "sailor";
    L.collarColor = S;
    L.coat = 0.3;
    L.coatColor = S;
    L.pants = shade(skin, 0.95);
    L.shoes = col("#2a1a14");
    L.bowtie = A ?? col("#a01a2a");
    return;
  }
  if (is("gi", "samue", "ninja", "shinobi", "kimono", "cross-collar", "yukata")) {
    L.collar = "cross";
    L.collarColor = is("ninja", "shinobi") ? shade(P, 0.75) : is("samue") ? S : shade(P, 0.92);
    L.sash = is("karate") ? S : is("ninja", "shinobi") ? shade(S, 0.9) : S;
    L.pants = is("ninja", "shinobi", "samue", "gi") ? P : shade(P, 0.8);
    L.shoes = is("ninja", "shinobi") ? shade(P, 0.6) : col("#2a2420");
    if (is("karate")) {
      L.hands = L.skin;
      L.shoes = shade(L.skin, 0.95);
      L.sole = shade(L.skin, 0.9);
    }
    return;
  }
  if (is("qipao", "mandarin")) {
    L.collar = "mandarin";
    L.collarColor = A ?? S;
    L.coat = 0.38;
    L.coatColor = P;
    L.sash = null;
    L.buttons = A ?? S;
    L.pants = S;
    return;
  }
  if (is("toga", "himation")) {
    L.collar = "none";
    L.sleeves = "short";
    L.coat = 0.78;
    L.coatColor = P;
    L.shawl = S;
    L.pants = shade(P, 0.9);
    L.shoes = col("#7a5a3a");
    return;
  }
  if (is("gown", "dress")) {
    L.coat = is("renaissance", "gown") ? 0.78 : 0.4;
    L.coatColor = P;
    L.collar = is("waitress") ? "shirt" : "none";
    L.collarColor = S;
    L.shawl = is("shawl", "drape") ? S : null;
    if (is("waitress", "apron")) L.apron = S;
    L.pants = is("waitress") ? shade(L.skin, 0.95) : shade(P, 0.8);
    L.shoes = col("#1a1a1c");
    return;
  }
  if (is("waitress", "diner")) {
    L.coat = 0.38;
    L.coatColor = P;
    L.collar = "shirt";
    L.collarColor = S;
    L.apron = S;
    L.sleeves = "short";
    L.pants = shade(L.skin, 0.95);
    L.shoes = col("#1a1a1c");
    return;
  }
  if (is("pajama")) {
    L.top = S;
    L.sleeve = S;
    L.pants = S;
    L.coat = 0.55;
    L.coatColor = P;
    L.coatOpen = true;
    L.inner = S;
    L.collar = "lapel";
    L.sash = shade(P, 0.85);
    L.shoes = col("#c8b8a8");
    return;
  }
  if (is("frock", "greatcoat", "trench", "coat")) {
    L.coat = is("frock") ? 0.5 : is("trench", "greatcoat") ? 0.58 : 0.45;
    L.coatColor = P;
    L.collar = "lapel";
    L.coatOpen = is("frock");
    L.inner = is("frock") ? S : null;
    L.double = is("double", "greatcoat");
    L.buttons = is("greatcoat") ? (A ?? col("#d0a040")) : is("trench") ? shade(P, 0.6) : col("#e0c060");
    L.belt = is("trench") ? shade(P, 0.85) : null;
    L.pants = is("frock") ? S : col("#26262c");
    L.collarColor = is("greatcoat") ? (A ?? S) : shade(P, 0.9);
    return;
  }
  if (is("bodysuit", "racing")) {
    L.pants = P;
    L.collar = "mandarin";
    L.collarColor = S;
    L.stripes = is("racing") ? S : null;
    L.panel = is("racing") ? S : null;
    L.cuff = S;
    sneak(L);
    return;
  }
  if (is("superhero", "cape")) {
    L.pants = P;
    L.collar = "crew";
    L.cape = S;
    L.panel = S;
    L.belt = col("#e0b030");
    L.shoes = S;
    L.hands = shade(P, 0.9);
    return;
  }
  if (is("hi-vis", "safety vest")) {
    L.collar = "shirt";
    L.vest = S;
    L.vestStripes = col("#e0e0e4");
    L.pants = col(DENIM);
    L.shoes = col("#4a3424");
    return;
  }
  if (is("uniform", "tunic", "scrubs", "security", "conductor", "guard")) {
    L.pants = lum(S) < 0.35 && sat(S) < 0.4 ? S : P;
    L.collar = is("scrubs") ? "v" : is("tunic") ? "crew" : "shirt";
    L.collarColor = is("tunic") ? S : shade(P, 0.92);
    L.sleeves = is("scrubs") ? "short" : "long";
    L.buttons = is("conductor") ? (A ?? null) : null;
    L.pocket = is("scrubs");
    L.belt = is("security", "guard") ? col("#1a1a1a") : null;
    L.panel = null;
    L.untucked = is("scrubs", "tunic");
    return;
  }
  if (is("apron", "pinafore")) {
    const apronFirst = /^\s*(apron|pinafore)/.test(text);
    L.apron = apronFirst ? P : S;
    L.top = apronFirst ? S : P;
    L.sleeve = L.top;
    L.collar = is("plaid", "shirt") && !apronFirst ? "shirt" : "crew";
    L.sleeves = is("t-shirt", "tee") ? "short" : "long";
    return;
  }
  if (is("vest")) {
    L.top = S;
    L.sleeve = S;
    L.vest = P;
    L.collar = "shirt";
    L.collarColor = shade(S, 1.05);
    L.pants = A && lum(A) < 0.35 ? A : col("#2e3038");
    L.shoes = col("#3a2a20");
    return;
  }
  if (is("suspender", "bartender")) {
    L.collar = "shirt";
    L.suspenders = S;
    L.pants = col("#1e1e22");
    L.shoes = col("#111112");
    return;
  }
  if (is("raglan", "tee", "t-shirt")) {
    L.sleeves = is("raglan") ? "long" : "short";
    L.sleeve = S;
    L.collarColor = S;
    L.untucked = true;
    L.pants = col(DENIM);
    sneak(L);
    return;
  }
  if (is("cardigan")) {
    L.inner = S;
    L.coatOpen = true;
    L.collar = "turtle";
    L.collarColor = S;
    L.buttons = shade(P, 0.6);
    L.untucked = true;
    return;
  }
  if (is("sweater", "sweatshirt", "knit", "pullover", "jumper")) {
    L.collar = is("turtle") ? "turtle" : "crew";
    L.collarColor = shade(P, 0.86);
    L.cuff = shade(P, 0.86);
    L.untucked = true;
    if (is("christmas", "ugly")) L.panel = S;
    return;
  }
  if (is("flannel", "plaid", "checker", "button", "shirt", "polka", "top")) {
    L.collar = is("polka", "top") && !is("button") ? "crew" : "shirt";
    L.collarColor = shade(P, 0.9);
    L.buttons = is("button", "flannel", "plaid") ? shade(P, 0.7) : null;
    L.dots = is("polka", "checker", "plaid") ? S : null;
    L.untucked = is("flannel", "polka");
    return;
  }
  // Generic: long-sleeved top + trousers.
  L.collar = "crew";
}

function sneak(L: Look): void {
  L.shoes = col("#ececf0");
  L.sole = col("#d0d0d6");
}

// ── Building ──

/** Front surface z of the chest box at chest-local height y. */
const CHEST = { y0: -0.14, h: 0.285, dB: 0.2, dT: 0.215, wB: 0.31, wT: 0.38 };
function chestFrontZ(y: number, k = 1): number {
  const t = THREE.MathUtils.clamp((y - CHEST.y0) / CHEST.h, 0, 1);
  return ((CHEST.dB + (CHEST.dT - CHEST.dB) * t) / 2) * k;
}

export function buildBody(b: PartBuilder, t: TamashiTraits, L: Look, d: TvDims): void {
  const hi = b.hi;
  const k = L.bulk;
  const seg = hi ? 10 : 5;
  const rs = hi ? 8 : 4;
  // ── Torso ──
  if (L.snowman) {
    b.on("hips").add(sphere(0.2, hi ? 12 : 6, hi ? 8 : 4), L.top, { r: 0.95, m: 0 }, tr(0, -0.02, 0, 0, 0, 0, 1, 0.8, 0.85));
    b.on("chest").add(sphere(0.19, hi ? 12 : 6, hi ? 8 : 4), L.top, { r: 0.95, m: 0 }, tr(0, 0.02, 0, 0, 0, 0, 1.05, 0.85, 0.85));
    b.on("spine").add(sphere(0.17, hi ? 10 : 5, hi ? 6 : 3), L.top, { r: 0.95, m: 0 }, tr(0, 0, 0, 0, 0, 0, 1, 0.8, 0.9));
    if (hi && L.buttons) for (const [bone, y, z] of [["chest", 0.05, 0.16], ["chest", -0.05, 0.16], ["spine", -0.02, 0.15], ["hips", -0.02, 0.17]] as const) b.on(bone).add(sphere(0.016, 6, 4), L.buttons, CLOTH, tr(0, y, z));
  } else {
    b.on("hips").add(hi ? taperBox(0.3 * k, 0.3 * k, 0.19, 0.21 * k, 0.2 * k, 0.07, 1) : box(0.29 * k, 0.19, 0.2 * k), L.pants, CLOTH, tr(0, -0.045, 0));
    const spineLow = L.untucked ? -0.135 : -0.1;
    const spineH = 0.21 - spineLow;
    b.on("spine").add(hi ? taperBox((L.untucked ? 0.305 : 0.275) * k, 0.29 * k, spineH, (L.untucked ? 0.212 : 0.19) * k, 0.19 * k, 0.075, 1) : box(0.3 * k, spineH, 0.2 * k), L.top, CLOTH, tr(0, spineLow + spineH / 2, 0));
    b.on("chest").add(hi ? taperBox(CHEST.wB * k, CHEST.wT * k, CHEST.h, CHEST.dB * k, CHEST.dT * k, 0.08, 2) : box(CHEST.wT * k, CHEST.h, CHEST.dT * k), L.top, CLOTH, tr(0, CHEST.y0 + CHEST.h / 2, 0));
  }
  const fz = (y: number) => chestFrontZ(y, k);
  // ── Neck ──
  b.on("neck").add(cyl(0.06, 0.064, 0.14, hi ? 10 : 5, true), L.skin, SKIN, tr(0, 0.055, 0.0));
  // ── Collar ──
  if (hi) buildCollar(b, L, k, fz);
  // ── Arms ──
  for (const side of [1, -1] as const) buildArm(b, L, side, k, hi, rs);
  // ── Legs ──
  for (const side of [1, -1] as const) buildLeg(b, L, side, k, hi, rs);
  // ── Coat / robe / skirt (follows the thighs part-way so the legs don't punch through) ──
  if (L.coat > 0) {
    const len = L.coat;
    const g = cyl(0.165 * k, (0.2 + len * 0.12) * k, len + 0.06, seg, true, hi ? 3 : 1);
    g.scale(1, 1, 0.74);
    b.on("hips").add(g, (p) => (L.coatOpen && p.z > 0.1 && Math.abs(p.x) < 0.03 ? shade(L.coatColor, 0.8) : L.coatColor), CLOTH, tr(0, 0.03 - len / 2, 0), skirtWeights(len));
  }
  if (L.apron) {
    const len = 0.42;
    b.on("hips").add(box(0.25, len, 0.015), L.apron, CLOTH, tr(0, 0.04 - len / 2, 0.122 * k), skirtWeights(len));
    if (hi) b.on("chest").add(box(0.18, 0.16, 0.012), L.apron, CLOTH, tr(0, 0.0, fz(0.0) + 0.006));
  }
  // ── Front details (hi only) ──
  if (hi) buildFront(b, t, L, k, fz);
  if (L.cape) {
    const len = 0.92;
    const g = taperBox(0.62, 0.4, len, 0.018, 0.018, 0.008);
    b.on("chest").add(g, (_p, n) => (n.z > 0.5 ? shade(L.cape!, 0.6) : L.cape!), CLOTH, tr(0, 0.13 - len / 2, -0.125 * k, -0.1), (p) => {
      const tt = THREE.MathUtils.clamp((0.1 - p.y) / 0.6, 0, 1);
      return ["chest", "hips", 1 - tt * 0.7];
    });
    if (L.fur) b.on("chest").add(torus(0.13, 0.045, hi ? 6 : 3, hi ? 12 : 6), col("#f2f0ea"), { r: 1, m: 0 }, tr(0, 0.14, -0.01, Math.PI / 2, 0, 0, 1.25, 1, 1));
  }
  buildAccessories(b, t, L, k, d, fz);
}

/** Skirt/coat vertices follow the nearest thigh more the lower they are. */
function skirtWeights(len: number): Weights {
  return (p) => {
    const tt = THREE.MathUtils.clamp((0.0 - p.y) / len, 0, 1);
    const side = Math.min(1, Math.abs(p.x) / 0.06);
    const thigh: RigBone = p.x >= 0 ? "thighL" : "thighR";
    return ["hips", thigh, 1 - tt * 0.8 * side];
  };
}

function buildArm(b: PartBuilder, L: Look, side: 1 | -1, k: number, hi: boolean, rs: number): void {
  const up: RigBone = side > 0 ? "upperArmL" : "upperArmR";
  const fore: RigBone = side > 0 ? "foreArmL" : "foreArmR";
  const hand: RigBone = side > 0 ? "handL" : "handR";
  const upLen = J.shoulderY - J.elbowY;
  const foreLen = J.elbowY - J.wristY;
  const sleeveUp = L.sleeves === "none" ? L.skin : L.sleeve;
  const sleeveFore = L.sleeves === "long" ? L.sleeve : L.skin;
  const fin = (c: THREE.Color) => (c === L.skin ? SKIN : CLOTH);
  const wide = L.collar === "cross" ? 1.12 : 1;
  b.on(up).add(sphere(0.074 * k, rs, hi ? 6 : 3), sleeveUp, fin(sleeveUp), tr(0, -0.005, 0));
  if (L.sleeves === "short") {
    b.add(limb(0.072 * k, 0.068 * k, 0.13, rs), L.sleeve, CLOTH);
    b.add(limb(0.06 * k, 0.053 * k, upLen, rs), L.skin, SKIN);
  } else {
    b.add(limb(0.068 * k * wide, 0.058 * k * wide, upLen, rs), sleeveUp, fin(sleeveUp));
  }
  if (L.sleeves === "none" && L.collar !== "none" && hi) {
    // Tank-top strap edge.
    b.on("chest").add(box(0.05, 0.012, 0.2 * k), L.collarColor, CLOTH, tr(side * 0.15, 0.142, 0, 0, 0, side * -0.25));
  }
  b.on(fore).add(sphere(0.058 * k * wide, rs, hi ? 5 : 3), sleeveFore, fin(sleeveFore));
  b.add(limb(0.057 * k * wide, (L.sleeves === "long" ? 0.051 : 0.046) * k * wide, foreLen, rs), sleeveFore, fin(sleeveFore));
  if (hi && L.cuff && L.sleeves === "long") b.add(limb(0.055 * k * wide, 0.055 * k * wide, 0.03, rs), L.cuff, CLOTH, tr(0, -foreLen + 0.03, 0));
  if (hi && L.stripes && L.sleeves === "long") {
    // Two thin stripes down the outside of the sleeve and over the shoulder.
    for (const dz of [-0.008, 0.008]) {
      b.on(up).add(box(0.006, upLen, 0.006), L.stripes, CLOTH, tr(side * 0.064 * k, -upLen / 2 + 0.005, dz, 0, 0, side * 0.035));
      b.on(fore).add(box(0.006, foreLen, 0.006), L.stripes, CLOTH, tr(side * 0.054 * k, -foreLen / 2, dz, 0, 0, side * 0.02));
      b.on("chest").add(box(0.16, 0.006, 0.006), L.stripes, CLOTH, tr(side * 0.12, 0.147, dz, 0, 0, side * -0.2));
      b.on(up).add(new THREE.TorusGeometry(0.074 * k, 0.003, 3, 8, Math.PI / 2), L.stripes, CLOTH, tr(0, -0.005, dz, 0, 0, side > 0 ? 0 : Math.PI / 2));
    }
  }
  // Mitten hand with a thumb.
  b.on(hand).add(sphere(0.05, rs, hi ? 6 : 3), L.hands, L.hands === L.skin ? SKIN : CLOTH, tr(0, -0.05, 0, 0, 0, 0, 0.82, 1.18, 0.62));
  if (hi) b.add(sphere(0.019, 5, 4), L.hands, SKIN, tr(-side * 0.012, -0.03, 0.028, 0, 0, 0, 1, 1.4, 1));
}

function buildLeg(b: PartBuilder, L: Look, side: 1 | -1, k: number, hi: boolean, rs: number): void {
  const thigh: RigBone = side > 0 ? "thighL" : "thighR";
  const shin: RigBone = side > 0 ? "shinL" : "shinR";
  const foot: RigBone = side > 0 ? "footL" : "footR";
  const thighLen = J.hipJointY - J.kneeY;
  const shinLen = J.kneeY - J.ankleY;
  const legC = L.shorts ? L.skin : L.pants;
  const legF = L.shorts ? SKIN : CLOTH;
  if (L.shorts) {
    b.on(thigh).add(limb(0.1 * k, 0.09 * k, 0.2, rs), L.pants, CLOTH, tr(0, 0.02, 0));
    b.add(limb(0.086 * k, 0.07 * k, thighLen, rs), L.skin, SKIN);
  } else {
    b.on(thigh).add(limb(0.096 * k, 0.076 * k, thighLen + 0.03, rs), L.pants, CLOTH, tr(0, 0.03, 0));
  }
  b.on(shin).add(sphere(0.075 * k, rs, hi ? 5 : 3), legC, legF);
  b.add(limb(0.073 * k, 0.058 * k, shinLen, rs), legC, legF);
  if (hi && L.stripes) {
    for (const dz of [-0.008, 0.008]) {
      b.on(thigh).add(box(0.006, thighLen, 0.006), L.stripes, CLOTH, tr(side * 0.087 * k, -thighLen / 2, dz, 0, 0, side * 0.03));
      b.on(shin).add(box(0.006, shinLen, 0.006), L.stripes, CLOTH, tr(side * 0.066 * k, -shinLen / 2, dz, 0, 0, side * 0.03));
    }
  }
  // Shoe: upper + sole.
  b.on(foot).add(hi ? rbox(0.115, 0.09, 0.24, 0.04) : box(0.115, 0.09, 0.24), L.shoes, PLASTIC, tr(0, -0.035, 0.04));
  if (hi) b.add(box(0.12, 0.022, 0.246), L.sole, RUBBER, tr(0, -0.074, 0.04));
}

function buildCollar(b: PartBuilder, L: Look, k: number, fz: (y: number) => number): void {
  const cc = L.collarColor;
  const top = CHEST.y0 + CHEST.h; // chest-local top of chest box
  b.on("chest");
  switch (L.collar) {
    case "crew":
      b.add(torus(0.068, 0.017, 5, 14), cc, CLOTH, tr(0, top - 0.01, 0.005, Math.PI / 2 - 0.12));
      break;
    case "turtle":
      b.add(cyl(0.066, 0.075, 0.08, 10), cc, CLOTH, tr(0, top + 0.02, 0));
      break;
    case "mandarin":
      b.add(cyl(0.064, 0.072, 0.045, 10, true), cc, CLOTH, tr(0, top + 0.005, 0.005));
      break;
    case "ring":
      b.add(torus(0.1, 0.032, 6, 14), cc, METAL, tr(0, top - 0.005, 0, Math.PI / 2));
      break;
    case "hood":
      b.add(torus(0.085, 0.034, 5, 12), cc, CLOTH, tr(0, top - 0.005, -0.02, Math.PI / 2 - 0.25));
      b.add(sphere(0.1, 8, 5), shade(cc, 0.95), CLOTH, tr(0, top - 0.02, -0.13 * k, 0, 0, 0, 1.25, 0.9, 0.6));
      break;
    case "v":
    case "lapel":
    case "shirt":
    case "cross":
    case "sailor": {
      // V: two bands from the neck down to the sternum (lapels / collar edges / kimono wrap).
      const lapel = L.collar === "lapel";
      const cross = L.collar === "cross";
      const len = cross ? 0.3 : lapel ? 0.22 : 0.1;
      const ang = cross ? 0.62 : lapel ? 0.42 : 0.5;
      const w = cross ? 0.05 : lapel ? 0.055 : 0.035;
      const bandC = lapel ? shade(L.coatOpen || L.coat ? L.coatColor : L.top, 0.82) : cc;
      if (L.inner && (lapel || L.coatOpen)) {
        // Shirt visible in the V.
        b.add(box(0.12, 0.2, 0.01), L.inner, CLOTH, tr(0, top - 0.11, fz(top - 0.11) + 0.002));
        b.add(box(0.035, 0.03, 0.02), L.inner, CLOTH, tr(0.032, top - 0.012, fz(top) - 0.0, 0, 0, 0.6));
        b.add(box(0.035, 0.03, 0.02), L.inner, CLOTH, tr(-0.032, top - 0.012, fz(top) - 0.0, 0, 0, -0.6));
      }
      if (L.collar === "v") {
        b.add(box(0.1, 0.08, 0.008), L.skin, SKIN, tr(0, top - 0.04, fz(top - 0.04) + 0.002, 0, 0, Math.PI / 4, 0.7, 0.7, 1));
      }
      for (const s of [1, -1]) {
        const yc = top - (len / 2) * Math.cos(ang);
        const x = s * ((len / 2) * Math.sin(ang) + 0.012);
        b.add(box(w, len, 0.014), bandC, CLOTH, tr(x * (cross ? (s > 0 ? 1 : 0.6) : 1), yc, fz(yc) + (cross && s > 0 ? 0.011 : 0.007), 0, 0, -s * ang));
      }
      if (L.collar === "shirt") {
        b.add(torus(0.064, 0.012, 4, 12, Math.PI * 1.4), cc, CLOTH, tr(0, top - 0.005, 0.0, Math.PI / 2 - 0.15, 0, -Math.PI * 0.2 + Math.PI / 2 + Math.PI));
      }
      if (L.collar === "sailor") {
        b.add(box(0.3, 0.2, 0.01), cc, CLOTH, tr(0, top - 0.08, -0.108 * k, 0.08));
        b.add(box(0.26, 0.012, 0.012), col("#f2f2f2"), CLOTH, tr(0, top - 0.17, -0.112 * k, 0.08));
      }
      break;
    }
  }
}

function buildFront(b: PartBuilder, t: TamashiTraits, L: Look, k: number, fz: (y: number) => number): void {
  const top = CHEST.y0 + CHEST.h;
  b.on("chest");
  if (L.bib) {
    b.add(box(0.2, 0.17, 0.014), L.bib, CLOTH, tr(0, -0.03, fz(-0.03) + 0.006));
    for (const s of [1, -1]) {
      b.add(box(0.035, 0.24, 0.01), L.bib, CLOTH, tr(s * 0.085, 0.07, fz(0.07) + 0.004, 0, 0, s * 0.08));
      b.add(box(0.035, 0.014, 0.21 * k), L.bib, CLOTH, tr(s * 0.095, top - 0.002, 0));
      if (L.buttons) b.add(cyl(0.012, 0.012, 0.01, 6), L.buttons, GOLD, tr(s * 0.085, 0.045, fz(0.045) + 0.014, Math.PI / 2));
    }
    b.add(box(0.08, 0.06, 0.006), shade(L.bib, 0.85), CLOTH, tr(0, -0.02, fz(-0.02) + 0.015));
  }
  if (L.vest) {
    for (const s of [1, -1]) b.add(box(0.13, 0.27, 0.012), L.vest, CLOTH, tr(s * 0.085, -0.0, fz(0) + 0.004, 0, 0, s * 0.05));
    b.on("spine").add(box(0.27, 0.16, 0.012), L.vest, CLOTH, tr(0, 0.02, 0.105 * k));
    b.on("chest").add(box(0.34, 0.25, 0.012), L.vest, CLOTH, tr(0, 0.0, -0.104 * k));
    if (L.vestStripes)
      for (const y of [-0.04, 0.05]) {
        b.add(box(0.31, 0.022, 0.016), L.vestStripes, { r: 0.4, m: 0.3, e: 0.08 }, tr(0, y, fz(y) + 0.008));
        b.add(box(0.34, 0.022, 0.016), L.vestStripes, { r: 0.4, m: 0.3, e: 0.08 }, tr(0, y, -0.11 * k));
      }
  }
  if (L.suspenders) {
    for (const s of [1, -1]) {
      b.add(box(0.025, 0.27, 0.008), L.suspenders, CLOTH, tr(s * 0.08, 0.01, fz(0.01) + 0.004, 0, 0, s * 0.06));
      b.add(box(0.025, 0.27, 0.008), L.suspenders, CLOTH, tr(s * 0.07, 0.01, -0.106 * k));
    }
  }
  if (L.panel) {
    b.add(box(0.13, 0.09, 0.008), L.panel, { r: 0.6, m: 0.1 }, tr(0, 0.02, fz(0.02) + 0.004));
    b.add(box(0.15, 0.11, 0.008), L.panel, { r: 0.6, m: 0.1 }, tr(0, 0.0, -0.107 * k));
  }
  if (L.dots) {
    const r = Math.random;
    void r;
    const pts = [
      [-0.09, 0.06],
      [0.06, 0.09],
      [0.1, -0.04],
      [-0.03, -0.06],
      [-0.12, -0.05],
      [0.02, 0.02],
    ];
    for (const [x, y] of pts) b.add(cyl(0.018, 0.018, 0.006, 6), L.dots, CLOTH, tr(x, y, fz(y) + 0.003, Math.PI / 2));
  }
  if (L.armor && L.armorTrim) {
    b.add(taperBox(0.3 * k, 0.36 * k, 0.24, 0.05, 0.05, 0.02), L.armor, METAL, tr(0, 0.02, fz(0.02) - 0.005));
    b.add(box(0.05, 0.22, 0.03), L.armorTrim, GOLD, tr(0, 0.02, fz(0.02) + 0.02));
    for (const s of [1, -1]) {
      const up: RigBone = s > 0 ? "upperArmL" : "upperArmR";
      b.on(up).add(sphere(0.09, 8, 4, ), L.armor, METAL, tr(s * 0.01, 0.0, 0, 0, 0, 0, 1, 0.7, 1));
      b.add(torus(0.075, 0.01, 3, 10), L.armorTrim, GOLD, tr(s * 0.01, -0.03, 0, Math.PI / 2));
      b.on("chest");
    }
  }
  if (L.buttons && !L.bib && !L.snowman) {
    const xs = L.double ? [-0.045, 0.045] : [0];
    for (const x of xs) for (const y of [0.07, 0.0, -0.07]) b.add(sphere(0.0105, 5, 4), L.buttons, PLASTIC, tr(x, y, fz(y) + (L.inner ? 0.009 : 0.004)));
    if (L.coat || L.untucked) for (const x of xs) b.on("spine").add(sphere(0.0105, 5, 4), L.buttons, PLASTIC, tr(x, 0.0, 0.105 * k)).on("chest");
  }
  if (L.coatOpen && !L.inner) {
    b.add(box(0.012, 0.25, 0.012), shade(L.coatColor, 0.75), CLOTH, tr(0, 0.0, fz(0) + 0.004));
  }
  if (L.pocket) b.on("spine").add(box(0.17, 0.08, 0.012), shade(L.top, 0.85), CLOTH, tr(0, -0.04, 0.1 * k + 0.004)).on("chest");
  if (L.sash) {
    b.on("spine").add(taperBox(0.31 * k, 0.31 * k, 0.07, 0.215 * k, 0.215 * k, 0.04), L.sash, CLOTH, tr(0, -0.05, 0));
  }
  if (L.belt) {
    b.on("hips").add(taperBox(0.3 * k, 0.3 * k, 0.035, 0.212 * k, 0.212 * k, 0.03), L.belt, PLASTIC, tr(0, 0.02, 0));
    b.add(box(0.04, 0.03, 0.01), col("#d0b060"), GOLD, tr(0, 0.02, 0.107 * k));
  }
  if (L.shawl) {
    b.on("chest").add(torus(0.13, 0.04, 5, 12), L.shawl, CLOTH, tr(0, 0.11, 0.0, Math.PI / 2 - 0.2, 0.3, 0, 1.15, 1, 1));
    b.add(box(0.07, 0.3, 0.02), L.shawl, CLOTH, tr(0.05, -0.02, fz(-0.02) + 0.01, 0, 0, -0.45));
  }
  if (L.panel && mentions(t.outfit.details, "christmas", "zigzag", "knit")) {
    b.on("chest").add(box(0.3 * k, 0.03, 0.006), col("#f4f4f4"), CLOTH, tr(0, 0.07, fz(0.07) + 0.004));
  }
}

function buildAccessories(b: PartBuilder, t: TamashiTraits, L: Look, k: number, d: TvDims, fz: (y: number) => number): void {
  const hi = b.hi;
  const acc = t.accessories.join(" · ").toLowerCase();
  const top = CHEST.y0 + CHEST.h;
  b.on("chest");
  if (hi && L.tie) {
    b.add(box(0.034, 0.03, 0.02), L.tie, CLOTH, tr(0, top - 0.03, fz(top - 0.03) + 0.012));
    b.add(taperBox(0.055, 0.03, 0.22, 0.01, 0.01, 0.004), L.tie, CLOTH, tr(0, top - 0.155, fz(top - 0.155) + 0.012));
  }
  if (hi && L.bowtie) {
    for (const s of [1, -1]) b.add(cone(0.026, 0.05, 4), L.bowtie, CLOTH, tr(s * 0.024, top - 0.02, fz(top) + 0.016, 0, Math.PI / 4, s * Math.PI / 2, 1, 1, 0.5));
    b.add(box(0.018, 0.022, 0.016), L.bowtie, CLOTH, tr(0, top - 0.02, fz(top) + 0.018));
  }
  if (hi && L.inner && !L.tie && !L.bowtie && L.collar === "lapel" && L.buttons == null && mentions(t.outfit.type, "tuxedo")) {
    // (tuxedo buttons handled by L.buttons)
  }
  if (hi && L.buttons && L.inner && mentions(t.outfit.type, "tuxedo")) {
    for (const y of [top - 0.07, top - 0.12, top - 0.17]) b.add(sphere(0.008, 5, 4), L.buttons, PLASTIC, tr(0, y, fz(y) + 0.01));
  }
  if (hi && mentions(acc, "necklace", "pendant", "chain")) {
    b.add(torus(0.085, 0.005, 3, 14), col("#e0b030"), GOLD, tr(0, top - 0.035, 0.03, Math.PI / 2 - 0.55));
    const pc = mentions(acc, "jade", "green") ? col("#30a070") : col("#e0b030");
    b.add(rbox(0.026, 0.03, 0.01, 0.004), pc, GOLD, tr(0, top - 0.105, fz(top - 0.105) + 0.012));
  }
  if (mentions(acc, "scarf", "neckerchief")) {
    const sc = mentions(acc, "neckerchief") ? (L.collarColor === L.top ? col(t.outfit.secondary) : L.collarColor) : (col(t.outfit.accent ?? t.outfit.secondary));
    b.add(torus(0.08, 0.03, hi ? 5 : 3, hi ? 12 : 6), sc, CLOTH, tr(0, top + 0.005, 0.0, Math.PI / 2 - 0.1));
    if (hi) b.add(box(0.06, mentions(acc, "neckerchief") ? 0.07 : 0.22, 0.02), sc, CLOTH, tr(0.06, top - (mentions(acc, "neckerchief") ? 0.04 : 0.12), fz(top - 0.1) + 0.02, 0, 0, 0.12));
  }
  if (mentions(acc, "backpack")) {
    b.add(hi ? rbox(0.26, 0.3, 0.11, 0.03) : box(0.26, 0.3, 0.11), shade(L.top, 0.7), CLOTH, tr(0, 0.0, -0.165 * k));
    if (hi) for (const s of [1, -1]) b.add(box(0.03, 0.26, 0.01), shade(L.top, 0.5), CLOTH, tr(s * 0.1, 0.02, fz(0.02) + 0.004));
  }
  if (hi && mentions(acc, "harness")) {
    for (const s of [1, -1]) b.add(box(0.03, 0.3, 0.01), col("#5a3a1e"), CLOTH, tr(s * 0.05, 0.0, fz(0) + 0.02, 0, 0, s * 0.45));
  }
  if (hi && mentions(acc, "badge", "name-tag", "name tag", "id badge")) {
    b.add(box(0.04, 0.03, 0.006), mentions(acc, "badge") ? col("#e0b030") : col("#f4f4f4"), GOLD, tr(0.09, 0.07, fz(0.07) + 0.008));
  }
  if (hi && mentions(acc, "stethoscope")) {
    b.add(torus(0.09, 0.006, 3, 12, Math.PI * 1.2), col("#2a2a2e"), RUBBER, tr(0, top - 0.06, fz(top - 0.06) - 0.01, -0.2, 0, -Math.PI * 0.1 - Math.PI / 2));
  }
  if (hi && mentions(acc, "camera")) {
    b.add(rbox(0.1, 0.065, 0.05, 0.01), col("#1e1e20"), PLASTIC, tr(-0.06, -0.06, fz(-0.06) + 0.025));
    b.add(cyl(0.02, 0.02, 0.03, 8), col("#3a3a40"), METAL, tr(-0.06, -0.06, fz(-0.06) + 0.06, Math.PI / 2));
  }
  if (mentions(acc, "power-plug-cable", "plug")) buildCable(b, t, d);
}

/** The power cable: from the TV's lower corner (viewer's left in the art), over the shoulder, plug on the chest. */
function buildCable(b: PartBuilder, t: TamashiTraits, d: TvDims): void {
  const hi = b.hi;
  if (!hi) return;
  const notes = `${t.notes} ${t.accessories.join(" ")}`;
  const m = /(\w+)[\s-]+(?:power[\s-]+)?(?:cable|cord)/i.exec(notes);
  const word = m ? colorWord(m[1]) : null;
  const cable = word ? col(word) : col("#e4e4e8");
  const plug = lum(cable) < 0.3 ? shade(cable, 1.1) : col("#f2f2f4");
  const chestY = J.chestY;
  const headY = J.headY;
  const x = -0.5 * d.W * 0.74; // under the TV's side, above the right shoulder
  // Body-frame points relative to the chest joint.
  const pts = [
    [x + 0.01, headY + 0.01, d.zB + 0.08],
    [x - 0.012, headY - 0.045, d.zB + 0.07],
    [-0.205, J.shoulderY + 0.085, -0.005],
    [-0.19, J.shoulderY + 0.06, 0.07],
    [-0.165, 1.22, 0.117],
    [-0.152, 1.16, 0.121],
  ].map(([px, py, pz]) => new THREE.Vector3(px, py - chestY, pz));
  const radial = 5;
  const segs = 18;
  b.on("chest").add(tube(pts, 0.0075, segs, radial), cable, RUBBER, undefined, (_p, i) => {
    const tt = Math.floor(i / (radial + 1)) / segs;
    const w = THREE.MathUtils.smoothstep(tt, 0.1, 0.4);
    return ["chest", "head", w];
  });
  const py = 1.135 - chestY;
  b.add(rbox(0.034, 0.042, 0.02, 0.006), plug, PLASTIC, tr(-0.15, py, 0.124, 0, 0, 0.12));
  for (const s of [1, -1]) b.add(box(0.005, 0.026, 0.008), col("#c8c8cc"), METAL, tr(-0.15 + s * 0.008 + 0.004, py - 0.032, 0.124, 0, 0, 0.12));
}

export { DARK };
export type { Finish };
