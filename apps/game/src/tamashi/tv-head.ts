/**
 * The CRT television head, built parametrically from a token's `traits.tv`.
 *
 * Owns: TV proportions per shape, finish → roughness/metalness/colour, housing + rear box,
 * front bezel and screen rim, the knob + grille column (and its variants), antenna dome,
 * rods and tips (two/one/none/bent/broken/four; ball/plain/none/flowers), the curved
 * screen surface geometry (screen.ts paints it), and a low-detail variant for far LOD.
 * Coordinates are head-local: origin = bottom centre of the TV (the head joint), +z = front,
 * +x = the character's left (the viewer's right when facing it: the knob column side).
 * Must not: paint the screen (screen.ts) or build hats (headwear.ts).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { mentions, otherText, type TamashiTraits } from "./traits";
import { box, cone, cyl, dome, frame, PartBuilder, quad, rbox, sphere, tr, type Paint } from "./geometry";
import { col, colorDistance, colorWord, GLOSS, lum, mix, shade, type Finish } from "./materials";

export interface TvDims {
  /** Front width / height (m). */
  W: number;
  H: number;
  /** Housing front / back planes, and its centre (z). */
  zF: number;
  zB: number;
  zMid: number;
  corner: number;
  rear: { w: number; h: number; d: number; y: number };
  screen: { cx: number; cy: number; w: number; h: number; r: number; bulge: number; z: number };
  /** Knob/grille column centre x and width. */
  colX: number;
  colW: number;
  knobR: number;
  knobY: [number, number];
  grille: { y0: number; y1: number; w: number };
  dome: { r: number; h: number };
  antenna: { len: number; spread: number; base: [THREE.Vector3, THREE.Vector3] };
  portable: boolean;
}

const dimsCache = new Map<number, TvDims>();
const KNOB: Finish = { r: 0.38, m: 0.3 };

/** Proportions for a token's TV (cached). */
export function tvDims(t: TamashiTraits): TvDims {
  const hit = dimsCache.get(t.id);
  if (hit) return hit;
  const shape = String(t.tv.shape);
  // The art's front face is ~1.2–1.25 : 1 (the oft-quoted 1.43 includes the visible side panel).
  let W = 0.54;
  let H = 0.432;
  let D = 0.17;
  let corner = 0.028;
  if (shape === "wide") [W, H] = [0.62, 0.4];
  else if (shape === "tall") [W, H] = [0.5, 0.5];
  else if (shape === "portable") [W, H, D] = [0.46, 0.37, 0.15];
  else if (shape === "boxy") [W, H, D, corner] = [0.55, 0.47, 0.2, 0.014];
  else if (shape === "rounded") corner = 0.07;
  const zF = 0.105;
  const zB = zF - D;
  const sw = 0.76 * W;
  const sh = 0.86 * H;
  const knobR = 0.062 * W;
  const d: TvDims = {
    W,
    H,
    zF,
    zB,
    zMid: (zF + zB) / 2,
    corner,
    rear: { w: 0.8 * W, h: 0.76 * H, d: 0.09 * (W / 0.54), y: 0.5 * H },
    screen: { cx: -0.067 * W, cy: 0.505 * H, w: sw, h: sh, r: 0.075 * W, bulge: 0.016, z: zF + 0.004 },
    colX: 0.41 * W,
    colW: 0.14 * W,
    knobR,
    knobY: [0.82 * H, 0.625 * H],
    grille: { y0: 0.09 * H, y1: 0.5 * H, w: 0.12 * W },
    dome: { r: 0.145 * W, h: 0.105 * W },
    antenna: {
      len: 0.31 * W,
      spread: (37 * Math.PI) / 180,
      base: [new THREE.Vector3(0.042 * W, H + 0.06 * W, (zF + zB) / 2), new THREE.Vector3(-0.042 * W, H + 0.06 * W, (zF + zB) / 2)],
    },
    portable: shape === "portable",
  };
  dimsCache.set(t.id, d);
  return d;
}

/** Colours and finish resolved from the traits. */
export interface TvLook {
  front: THREE.Color;
  side: THREE.Color;
  rim: THREE.Color;
  /** Secondary for patterned / two-tone TVs (rear box, side insets). */
  second: THREE.Color;
  inset: THREE.Color;
  knob: THREE.Color;
  knob2: THREE.Color;
  dome: THREE.Color;
  rod: THREE.Color;
  tip: THREE.Color;
  finish: Finish;
}

export function tvLook(t: TamashiTraits): TvLook {
  const body = col(t.tv.bodyColor);
  const bezel = col(t.tv.bezelColor, t.tv.bodyColor);
  const near = colorDistance(body, bezel) < 0.26;
  const front = near ? bezel : body;
  const rim = near ? shade(bezel, 0.55) : bezel;
  const fin = String(t.tv.bodyFinish);
  let finish: Finish = { r: 0.62, m: 0.02 };
  if (fin === "glossy") finish = { r: 0.3, m: 0.05 };
  else if (fin === "metallic") finish = { r: 0.34, m: 0.6 };
  else if (fin === "chrome") finish = { r: 0.16, m: 0.85 };
  else if (fin === "wood") finish = { r: 0.72, m: 0 };
  else if (fin === "transparent") finish = { r: 0.2, m: 0.05, e: 0.16 };
  else if (fin === "patterned") finish = { r: 0.5, m: 0.03 };
  else if (mentions(fin, "leather")) finish = { r: 0.58, m: 0 };
  else if (mentions(fin, "marble", "stone")) finish = { r: 0.38, m: 0 };
  else if (mentions(fin, "snow")) finish = { r: 0.95, m: 0 };
  const patternWord = colorWord(t.tv.pattern) ?? colorWord(otherText(fin));
  let second = patternWord ? col(patternWord) : near ? shade(body, 0.72) : bezel;
  if (fin === "wood") second = shade(body, 0.7);
  const l = lum(body);
  const inset = fin === "patterned" ? second : l > 0.6 ? mix(body, col("#b8c8e0"), 0.25) : l > 0.12 ? shade(body, 0.78) : shade(body, 1.12);
  const knob = col(t.tv.knobColor, "#d0d0d4");
  let knob2 = knob;
  const sp = otherText(String(t.tv.sidePanel));
  if (mentions(sp, "cyan") && mentions(sp, "green")) {
    knob2 = col("#40c040");
  }
  const knobFirst = mentions(sp, "cyan") ? col("#30b8d0") : knob;
  // Dome: a colour word right before "dome" in the notes wins; else the knob colour.
  const domeHint = /([a-z/-]+)[\s-]+(?:half-sphere\s+)?dome/i.exec(t.notes ?? "");
  const domeWord = domeHint ? colorWord(domeHint[1]) : null;
  const sidePanelVisible = !String(t.tv.sidePanel).startsWith("other") || mentions(sp, "knob");
  const domeC = domeWord ? col(domeWord) : sidePanelVisible && t.tv.knobColor ? knob : col("#d4d4d8");
  const rod = lum(domeC) < 0.2 ? shade(domeC, 1.12) : mix(domeC, col("#e4e4ea"), 0.4);
  const tip = lum(domeC) < 0.2 ? shade(domeC, 1.2) : col("#f2f2f4");
  return { front, side: body, rim, second, inset, knob: knobFirst, knob2, dome: domeC, rod, tip, finish };
}

/** Build the TV head parts (bound to the head bone; antennas to antenna bones). */
export function buildTvHead(b: PartBuilder, t: TamashiTraits, d: TvDims): void {
  const L = tvLook(t);
  const hi = b.hi;
  const { W, H, zF, zMid } = d;
  const D = zF - d.zB;
  const fin = L.finish;
  const hiFront = shade(L.front, 1.06);
  b.on("head");
  // Housing: front face in the front colour, the rest in the body colour.
  const housingPaint: Paint = (_p, n) => (n.z > 0.55 ? hiFront : n.y > 0.6 ? shade(L.side, 1.04) : L.side);
  b.add(hi ? rbox(W, H, D, d.corner, 2) : box(W, H, D), housingPaint, fin, tr(0, H / 2, zMid));
  // Rear box (narrower, inset top and bottom).
  const rearColor = String(t.tv.bodyFinish) === "patterned" ? L.second : shade(L.side, 0.92);
  b.add(hi ? rbox(d.rear.w, d.rear.h, d.rear.d + 0.01, d.corner * 0.8, 1) : box(d.rear.w, d.rear.h, d.rear.d + 0.01), rearColor, fin, tr(0, d.rear.y, d.zB - d.rear.d / 2 + 0.005));
  // Screen rim (frame around the screen opening).
  const s = d.screen;
  const rimT = 0.013;
  b.add(frame(s.w + 2 * rimT, s.h + 2 * rimT, s.r + rimT, rimT + 0.003, hi ? 3 : 1), L.rim, GLOSS, tr(s.cx, s.cy, zF + 0.0015));
  if (hi) {
    // Highlight line along the top of the front face.
    b.add(box(W - 2.2 * d.corner, 0.006, 0.004), shade(L.front, 1.35), GLOSS, tr(0, H - d.corner * 0.75, zF + 0.0005));
    // Side panel insets + a light stripe (both sides; the art shows the left one).
    for (const sx of [1, -1]) {
      b.add(box(0.004, H * 0.6, D * 0.6), L.inset, fin, tr(sx * (W / 2 + 0.0005), H * 0.55, zMid - D * 0.04));
      b.add(box(0.004, 0.011, D * 0.66), shade(L.side, 1.3), fin, tr(sx * (W / 2 + 0.001), H * 0.2, zMid - D * 0.04));
      b.add(box(0.004, 0.008, d.rear.d * 0.5), shade(L.side, 0.6), fin, tr(sx * (d.rear.w / 2 + 0.002), d.rear.y + d.rear.h * 0.3, d.zB - d.rear.d * 0.45));
      b.add(box(0.004, 0.008, d.rear.d * 0.5), shade(L.side, 0.6), fin, tr(sx * (d.rear.w / 2 + 0.002), d.rear.y + d.rear.h * 0.18, d.zB - d.rear.d * 0.45));
      if (String(t.tv.bodyFinish) === "wood") {
        for (const gy of [0.38, 0.72]) b.add(box(0.004, 0.006, D * 0.9), shade(L.side, 0.7), fin, tr(sx * (W / 2 + 0.001), H * gy, zMid));
      }
    }
  }
  buildColumn(b, t, d, L);
  // Antenna dome (a siren replaces it for #69-style headwear: headwear.ts draws that instead).
  const siren = mentions(t.headwear?.type, "siren");
  if (!siren) {
    b.add(dome(d.dome.r, hi ? 12 : 6, hi ? 4 : 2), L.dome, { r: 0.28, m: 0.45 }, tr(0, H - 0.004, zMid, 0, 0, 0, 1, d.dome.h / d.dome.r, 1));
    if (hi) b.add(sphere(d.dome.r * 0.22, 6, 4), shade(L.dome, 1.4), GLOSS, tr(-d.dome.r * 0.35, H + d.dome.h * 0.62, zMid + d.dome.r * 0.3, 0, 0, 0, 1, 0.5, 1));
  }
  buildAntennas(b, t, d, L);
  if (d.portable) {
    b.on("head").add(new THREE.TorusGeometry(W * 0.28, 0.012, 4, hi ? 10 : 5, Math.PI), shade(L.side, 0.6), GLOSS, tr(0, H + 0.005, zMid));
  }
}

function buildColumn(b: PartBuilder, t: TamashiTraits, d: TvDims, L: TvLook): void {
  const hi = b.hi;
  const sp = String(t.tv.sidePanel);
  const spText = otherText(sp);
  const knobs = sp === "knobs-and-grille" || sp === "knobs" || (sp.startsWith("other") && !mentions(spText, "no knob"));
  const grille = sp === "knobs-and-grille" || sp === "grille" || (sp.startsWith("other") && !mentions(spText, "keypad", "hidden"));
  const keypad = mentions(spText, "keypad");
  const { zF, colX } = d;
  const dark = col("#141416");
  b.on("head");
  if (knobs) {
    d.knobY.forEach((ky, i) => {
      const kc = i === 0 ? L.knob : L.knob2;
      if (hi) {
        // Dark ring behind, the notched knob, a raised bar across its face.
        b.add(cyl(d.knobR * 1.16, d.knobR * 1.16, 0.006, 14), lum(L.front) > 0.45 ? col("#34343a") : shade(L.front, 0.55), GLOSS, tr(colX, ky, zF + 0.002, Math.PI / 2));
        b.add(notchedKnob(d.knobR, 0.02), (_p, n) => (n.y > 0.5 ? shade(kc, 1.12) : shade(kc, lum(kc) > 0.6 ? 0.62 : 0.82)), KNOB, tr(colX, ky, zF + 0.012, Math.PI / 2));
        b.add(box(d.knobR * 1.55, d.knobR * 0.3, 0.012), shade(kc, lum(kc) > 0.6 ? 0.6 : 0.86), KNOB, tr(colX, ky, zF + 0.024, 0, 0, i === 0 ? -Math.PI / 4 : 0));
      } else {
        b.add(cyl(d.knobR, d.knobR, 0.02, 6, true), kc, KNOB, tr(colX, ky, zF + 0.01, Math.PI / 2));
        b.add(quad(d.knobR * 1.6, d.knobR * 1.6), kc, KNOB, tr(colX, ky, zF + 0.02));
      }
    });
  }
  const gy0 = d.grille.y0;
  const gy1 = knobs ? d.grille.y1 : d.knobY[0] + d.knobR;
  const gh = gy1 - gy0;
  const gw = d.grille.w;
  if (keypad) {
    b.add(rbox(gw, gh, 0.01, 0.008), shade(L.knob, 0.5), GLOSS, tr(colX, gy0 + gh / 2, zF + 0.004));
    if (hi) {
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 3; c++)
          b.add(box(gw * 0.24, gh * 0.16, 0.008), col("#e8e8ea"), GLOSS, tr(colX + (c - 1) * gw * 0.3, gy0 + gh * (0.16 + r * 0.22), zF + 0.01));
    }
  } else if (grille) {
    if (lum(L.front) > 0.45) b.add(hi ? rbox(gw + 0.01, gh + 0.01, 0.006, 0.014) : box(gw + 0.01, gh + 0.01, 0.006), col("#34343a"), GLOSS, tr(colX, gy0 + gh / 2, zF + 0.002));
    b.add(hi ? rbox(gw, gh, 0.012, 0.012) : box(gw, gh, 0.012), hi ? L.knob : mix(L.knob, dark, 0.55), KNOB, tr(colX, gy0 + gh / 2, zF + 0.004));
    if (hi) {
      const slats = Math.max(5, Math.round(gh / 0.0165));
      const pitch = (gh * 0.86) / slats;
      for (let i = 0; i < slats; i++) {
        b.add(quad(gw * 0.72, pitch * 0.56), dark, { r: 0.8, m: 0 }, tr(colX, gy0 + gh * 0.07 + pitch * (i + 0.5), zF + 0.0105));
      }
    }
  }
}

/** A short cylinder (axis y) whose rim is notched like a ridged dial. */
function notchedKnob(r: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, depth, 24, 1, false);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < r * 0.99) continue;
    const a = Math.atan2(z, x);
    const k = Math.cos(a * 12) > 0 ? 1 : 0.88;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function flowerColors(text: string): string[] {
  const parts = text.split(/\band\b|,|\//i);
  const out = parts.map((p) => colorWord(p)).filter((c): c is string => !!c && c !== "#3aa04a");
  return out.length ? out : ["#f08ac0"];
}

function buildAntennas(b: PartBuilder, t: TamashiTraits, d: TvDims, L: TvLook): void {
  const hi = b.hi;
  const kind = String(t.tv.antennas);
  if (kind === "none") return;
  const tipKind = String(t.tv.antennaTip);
  const flowers = mentions(tipKind, "flower", "daisy", "rose");
  const tips = tipKind === "ball" || (tipKind.startsWith("other") && !flowers && !mentions(tipKind, "plain", "none"));
  const fcols = flowers ? flowerColors(otherText(tipKind)) : [];
  const len = d.antenna.len;
  const rodR = hi ? 0.0055 : 0.008;
  const rod = (bone: "antennaL" | "antennaR", angle: number, l: number, back = -0.14, tip = true, idx = 0, kink = 0) => {
    b.on(bone);
    const dir = new THREE.Vector3(Math.sin(angle), Math.cos(angle), back).normalize();
    const a = new THREE.Vector3(0, 0, 0);
    let end = dir.clone().multiplyScalar(l);
    if (kink) {
      const mid = dir.clone().multiplyScalar(l * 0.55);
      addRod(b, a, mid, rodR, L.rod, hi);
      const dir2 = new THREE.Vector3(Math.sin(angle + kink), Math.cos(angle + kink), back).normalize();
      end = mid.clone().add(dir2.multiplyScalar(l * 0.45));
      addRod(b, mid, end, rodR, L.rod, hi);
    } else addRod(b, a, end, rodR, L.rod, hi);
    if (!tip) return;
    if (flowers) {
      const fc = col(fcols[idx % fcols.length]);
      addFlower(b, end, 0.034, fc, hi);
    } else if (tips) {
      b.add(sphere(0.0135, hi ? 8 : 4, hi ? 6 : 3), L.tip, { r: 0.3, m: 0.2 }, tr(end.x, end.y, end.z));
    }
  };
  const sp = d.antenna.spread;
  if (kind === "one") {
    rod("antennaL", -0.18, len * 1.05, -0.1, true, 0);
  } else if (kind === "bent") {
    rod("antennaL", sp, len);
    rod("antennaR", -sp, len, -0.14, true, 1, -0.9);
  } else if (kind === "broken") {
    rod("antennaL", sp, len);
    rod("antennaR", -sp, len * 0.45, -0.14, false, 1);
  } else if (kind === "four") {
    rod("antennaL", sp, len, -0.14, true, 0);
    rod("antennaR", -sp, len, -0.14, true, 1);
    rod("antennaL", sp * 0.35, len * 0.9, -0.3, true, 2);
    rod("antennaR", -sp * 0.35, len * 0.9, -0.3, true, 3);
  } else {
    rod("antennaL", sp, len, -0.14, true, 0);
    rod("antennaR", -sp * 0.9, len, -0.14, true, 1);
  }
  b.on("head");
}

function addRod(b: PartBuilder, a: THREE.Vector3, e: THREE.Vector3, r: number, c: THREE.Color, hi: boolean): void {
  const len = a.distanceTo(e);
  const g = cyl(r * 0.8, r, len, hi ? 5 : 3, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), e.clone().sub(a).normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(e).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  b.add(g, c, KNOB, m);
}

function addFlower(b: PartBuilder, at: THREE.Vector3, size: number, c: THREE.Color, hi: boolean): void {
  const petals = hi ? 6 : 4;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    b.add(sphere(size * 0.42, hi ? 6 : 4, hi ? 4 : 3), c, { r: 0.7, m: 0, e: 0.05 }, tr(at.x + Math.cos(a) * size * 0.5, at.y + Math.sin(a) * size * 0.5, at.z + 0.005, 0, 0, 0, 1, 1, 0.45));
  }
  b.add(sphere(size * 0.32, hi ? 6 : 4, 3), col("#f0c020"), { r: 0.7, m: 0 }, tr(at.x, at.y, at.z + 0.012, 0, 0, 0, 1, 1, 0.6));
  if (hi) b.add(cone(size * 0.35, size * 0.9, 4), col("#3a9a3a"), { r: 0.8, m: 0 }, tr(at.x + size * 0.6, at.y - size * 0.7, at.z, 0, 0, -2.2, 1, 1, 0.3));
}

/** Low-cost bounding info used by headwear and accessories. */
export function tvTopCenter(d: TvDims): THREE.Vector3 {
  return new THREE.Vector3(0, d.H, d.zMid);
}

// ── Screen surface ──

const screenGeoCache = new Map<string, THREE.BufferGeometry>();

/** The curved (CRT-bulged), rounded-rect screen surface in head-local coordinates; uv 0..1. */
export function screenGeometry(d: TvDims): THREE.BufferGeometry {
  const s = d.screen;
  const key = `${s.w.toFixed(4)}:${s.h.toFixed(4)}:${s.r}:${s.cx}:${s.cy}:${s.z}`;
  const hit = screenGeoCache.get(key);
  if (hit) return hit;
  const nx = 12;
  const ny = 10;
  const g = new THREE.PlaneGeometry(1, 1, nx, ny);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const ix = s.w / 2 - s.r;
  const iy = s.h / 2 - s.r;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2;
    const v = pos.getY(i) * 2;
    let px = (u * s.w) / 2;
    let py = (v * s.h) / 2;
    const ex = Math.abs(px) - ix;
    const ey = Math.abs(py) - iy;
    if (ex > 0 && ey > 0) {
      const k = Math.max(ex, ey) / Math.hypot(ex, ey);
      px = Math.sign(px) * (ix + ex * k);
      py = Math.sign(py) * (iy + ey * k);
    }
    const z = s.bulge * (1 - u * u * 0.85) * (1 - v * v * 0.85);
    pos.setXYZ(i, s.cx + px, s.cy + py, s.z + z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  screenGeoCache.set(key, g);
  return g;
}
