/**
 * Headwear on the TV (head bone): crown, chef hat, straw hat, caps, beanie, headbands,
 * flower, fedora, helmet, halo, witch hat, and one-offs from "other: …" text (siren dome,
 * rain cloud, ice-cream cone, bird, leaf, ponytail, mask ears, goggle strap …), plus a few
 * TV-mounted accessories (headset, string lights, crank handle, cupid's arrow).
 *
 * Owns: hat shapes sized to the token's TV. Masks over the screen are painted by screen.ts.
 * Must not: build the TV or body.
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { mentions, otherText, type TamashiTraits } from "./traits";
import { box, cone, cyl, dome, PartBuilder, sphere, torus, tr } from "./geometry";
import { CLOTH, col, colorWord, glow, GOLD, METAL, PLASTIC, shade } from "./materials";
import type { TvDims } from "./tv-head";

export function buildHeadwear(b: PartBuilder, t: TamashiTraits, d: TvDims): void {
  const hi = b.hi;
  const rs = hi ? 10 : 5;
  const { W, H, zMid, zF, zB } = d;
  const D = zF - zB;
  const top = H;
  b.on("head");
  const hw = t.headwear;
  if (hw) {
    const type = String(hw.type);
    const text = otherText(type).toLowerCase();
    const c = col(hw.color);
    const is = (...w: string[]) => mentions(text, ...w);
    if (type === "crown" || is("crown", "tiara")) {
      b.add(cyl(0.11, 0.1, 0.06, rs, true), c, GOLD, tr(0, top + 0.03, zMid + 0.02));
      const n = hi ? 8 : 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        b.add(cone(0.02, 0.06, 4), c, GOLD, tr(Math.sin(a) * 0.105, top + 0.085, zMid + 0.02 + Math.cos(a) * 0.105));
        if (hi) b.add(sphere(0.008, 4, 3), c, GOLD, tr(Math.sin(a) * 0.105, top + 0.12, zMid + 0.02 + Math.cos(a) * 0.105));
      }
      if (hi) {
        b.add(dome(0.095, 8, 3), col("#4a2a8a"), CLOTH, tr(0, top + 0.01, zMid + 0.02, 0, 0, 0, 1, 0.9, 1));
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) b.add(sphere(0.012, 5, 4), col("#d02030"), glow(0.15, 0.2), tr(Math.sin(a) * 0.112, top + 0.03, zMid + 0.02 + Math.cos(a) * 0.112));
      }
    } else if (type === "chef-hat" || is("chef")) {
      b.add(cyl(0.12, 0.12, 0.07, rs, true), c, CLOTH, tr(0, top + 0.035, zMid));
      b.add(sphere(0.15, rs, hi ? 6 : 3), c, CLOTH, tr(0, top + 0.13, zMid, 0, 0, 0, 1, 0.65, 1));
      if (hi) for (const a of [0.6, 2.1, 3.7, 5.2]) b.add(sphere(0.07, 6, 4), c, CLOTH, tr(Math.sin(a) * 0.09, top + 0.15, zMid + Math.cos(a) * 0.09));
    } else if (type === "straw-hat" || is("straw", "sombrero", "sun hat")) {
      b.add(cyl(0.38, 0.4, 0.012, hi ? 16 : 8), c, CLOTH, tr(0, top + 0.012, zMid));
      b.add(cyl(0.15, 0.17, 0.1, rs), c, CLOTH, tr(0, top + 0.06, zMid));
      b.add(cyl(0.172, 0.172, 0.025, rs, true), col("#c02a20"), CLOTH, tr(0, top + 0.025, zMid));
    } else if (is("witch")) {
      b.add(cyl(0.34, 0.36, 0.012, hi ? 14 : 7), c, CLOTH, tr(0, top + 0.012, zMid));
      b.add(cone(0.15, 0.2, rs), c, CLOTH, tr(0, top + 0.11, zMid));
      b.add(cone(0.08, 0.16, rs), c, CLOTH, tr(0.06, top + 0.24, zMid - 0.02, 0, 0, -0.7));
      b.add(cyl(0.15, 0.155, 0.03, rs, true), shade(c, 0.6), CLOTH, tr(0, top + 0.03, zMid));
      if (hi) b.add(box(0.04, 0.032, 0.01), col("#d0b060"), GOLD, tr(0, top + 0.03, zMid + 0.152));
    } else if (is("fedora", "trilby", "bowler", "top hat")) {
      b.add(cyl(0.25, 0.26, 0.012, hi ? 14 : 7), c, CLOTH, tr(0, top + 0.012, zMid, 0.05));
      b.add(cyl(0.12, 0.14, 0.13, rs), c, CLOTH, tr(0, top + 0.075, zMid));
      b.add(cyl(0.142, 0.142, 0.03, rs, true), shade(c, 0.45), CLOTH, tr(0, top + 0.03, zMid));
    } else if (type === "cap" || is("cap", "peaked", "visor")) {
      const peaked = is("peaked", "police", "conductor", "pilot", "mail");
      if (peaked) {
        b.add(cyl(0.17, 0.13, 0.08, rs), c, CLOTH, tr(0, top + 0.045, zMid));
        b.add(cyl(0.132, 0.132, 0.03, rs, true), is("gold") ? col("#d0a040") : shade(c, 0.5), is("gold") ? GOLD : CLOTH, tr(0, top + 0.02, zMid));
        b.add(cyl(0.12, 0.12, 0.01, rs), shade(c, 0.4), PLASTIC, tr(0, top + 0.01, zMid + 0.12, 0.25, 0, 0, 1, 1, 0.55));
        if (hi) b.add(box(0.035, 0.03, 0.01), col("#e0b030"), GOLD, tr(0, top + 0.06, zMid + 0.16, -0.4));
      } else {
        b.add(dome(0.15, rs, hi ? 4 : 2), c, CLOTH, tr(0, top, zMid, 0, 0, 0, 1, 0.6, 1));
        b.add(cyl(0.13, 0.13, 0.01, rs), shade(c, 0.85), CLOTH, tr(0, top + 0.01, zMid + 0.15, 0.1, 0, 0, 0.9, 1, 0.6));
      }
    } else if (type === "beanie" || is("beanie", "toque")) {
      b.add(dome(0.17, rs, hi ? 5 : 2), c, CLOTH, tr(0, top - 0.01, zMid, 0, 0, 0, 1, 0.7, 1));
      b.add(cyl(0.172, 0.172, 0.04, rs, true), shade(c, 0.85), CLOTH, tr(0, top + 0.01, zMid));
    } else if (type === "helmet" || is("helmet")) {
      b.add(dome(Math.max(W, D) * 0.62, rs, hi ? 5 : 2), c, METAL, tr(0, top - 0.06, zMid, 0, 0, 0, 1, 0.5, 0.75));
    } else if (type === "halo" || is("halo")) {
      b.add(torus(0.12, 0.012, 4, hi ? 16 : 8), col(hw.color), glow(0.9), tr(0, top + 0.25, zMid, Math.PI / 2));
    } else if (type === "flower") {
      flower(b, new THREE.Vector3(W * 0.32, top + 0.02, zF - 0.02), 0.06, c, hi);
    } else if (is("headband", "hachimaki", "sweatband", "bandana")) {
      band(b, d, c, 0.85, 0.045);
      if (hi) {
        const emblem = is("rising-sun", "sun circle", "orange circle") ? col("#e85a10") : is("triangle") ? col("#111111") : null;
        if (emblem) b.add(cyl(0.025, 0.025, 0.004, 10), emblem, CLOTH, tr(d.screen.cx, H * 0.85, zF + 0.03, Math.PI / 2));
        if (is("knot", "tail", "tails")) {
          b.add(sphere(0.025, 6, 4), c, CLOTH, tr(-W / 2 - 0.02, H * 0.85, zMid));
          b.add(box(0.012, 0.16, 0.04), c, CLOTH, tr(-W / 2 - 0.02, H * 0.85 - 0.08, zMid - 0.03, 0.2, 0, 0.1));
          b.add(box(0.012, 0.13, 0.04), c, CLOTH, tr(-W / 2 - 0.02, H * 0.85 - 0.07, zMid + 0.01, -0.2, 0, -0.1));
        }
      }
    } else if (is("goggles") && is("strap")) {
      band(b, d, col("#1a1a1a"), 0.58, 0.03);
    } else if (is("siren", "police light", "beacon")) {
      b.add(cyl(0.07, 0.08, 0.025, rs), col("#2a2a2e"), METAL, tr(0, top + 0.012, zMid));
      b.add(dome(0.065, rs, hi ? 5 : 2), c, glow(0.75, 0.2), tr(0, top + 0.024, zMid, 0, 0, 0, 1, 1.2, 1));
    } else if (is("cloud")) {
      const cc = col("#eceef2");
      for (const [x, y, r] of [
        [0, 0.36, 0.1],
        [0.11, 0.33, 0.08],
        [-0.11, 0.33, 0.08],
        [0.2, 0.31, 0.06],
        [-0.2, 0.31, 0.06],
        [0.05, 0.4, 0.07],
      ])
        b.add(sphere(r, hi ? 8 : 4, hi ? 6 : 3), cc, CLOTH, tr(x, top + y, zMid, 0, 0, 0, 1, 0.75, 0.8));
      if (hi) for (const [x, y] of [[-0.15, 0.2], [-0.05, 0.16], [0.07, 0.22], [0.17, 0.17], [0.0, 0.08]]) b.add(sphere(0.012, 4, 3), col("#d02020"), CLOTH, tr(x, top + y, zMid + 0.03, 0, 0, 0, 1, 1.8, 1));
    } else if (is("ice-cream", "ice cream", "cone")) {
      b.add(sphere(0.14, rs, hi ? 6 : 3), col("#f0ece0"), CLOTH, tr(0.03, top + 0.04, zMid, 0, 0, 0, 1.15, 0.6, 1));
      b.add(cone(0.11, 0.3, rs), c, CLOTH, tr(0.03, top + 0.23, zMid, 0, 0, -0.15));
      if (hi) {
        b.add(sphere(0.03, 6, 4), col("#c01020"), PLASTIC, tr(-0.13, top + 0.07, zMid + 0.06));
        for (const [x, z] of [[0.17, 0.08], [-0.1, 0.1], [0.05, 0.13]]) b.add(sphere(0.03, 5, 4), col("#f0ece0"), CLOTH, tr(x, top - 0.01, zMid + z, 0, 0, 0, 1, 1.6, 1));
        for (const [x, z] of [[0.0, 0.08], [0.09, -0.02], [-0.05, -0.05]]) b.add(sphere(0.012, 4, 3), col("#2a1a14"), CLOTH, tr(x, top + 0.09, zMid + z));
      }
    } else if (is("bird")) {
      const bx = W * 0.3;
      b.add(sphere(0.045, 8, 6), c, CLOTH, tr(bx, top + 0.045, zMid, 0, 0, 0, 1.3, 0.9, 0.9));
      b.add(sphere(0.03, 8, 6), c, CLOTH, tr(bx - 0.05, top + 0.085, zMid));
      if (hi) {
        b.add(cone(0.01, 0.03, 4), col("#e0a020"), CLOTH, tr(bx - 0.085, top + 0.085, zMid, 0, 0, Math.PI / 2));
        b.add(box(0.06, 0.008, 0.03), shade(c, 0.7), CLOTH, tr(bx + 0.07, top + 0.06, zMid, 0, 0, 0.4));
        b.add(sphere(0.022, 6, 4), col("#f0f0f0"), CLOTH, tr(bx - 0.01, top + 0.03, zMid + 0.03));
      }
    } else if (is("leaf", "apple")) {
      b.add(cyl(0.006, 0.008, 0.05, 4), col("#5a3a1e"), CLOTH, tr(0.03, top + 0.07, zMid));
      b.add(sphere(0.04, 6, 4), c, CLOTH, tr(0.07, top + 0.09, zMid, 0, 0, -0.6, 1, 0.4, 0.2));
    } else if (is("ponytail", "hair")) {
      const hc = c;
      const tip = colorWord(text.split("with")[1] ?? "") ? col(colorWord(text.split("with")[1])!) : hc;
      const base = new THREE.Vector3(-W * 0.35, H * 0.75, zB - 0.02);
      b.add(sphere(0.06, 8, 6), hc, CLOTH, tr(base.x, base.y, base.z));
      for (let i = 1; i <= 3; i++) b.add(sphere(0.05 - i * 0.008, 6, 4), i === 3 ? tip : hc, CLOTH, tr(base.x - i * 0.04, base.y - i * 0.05, base.z - i * 0.02, 0, 0, 0, 1, 1.3, 1));
    } else if (is("kitsune", "fox")) {
      for (const s of [1, -1]) {
        b.add(cone(0.045, 0.1, 4), col("#f8f6f2"), PLASTIC, tr(d.screen.cx + 0.08 + s * 0.09, top + 0.03, zF + 0.01, 0, Math.PI / 4, s * -0.2));
        if (hi) b.add(cone(0.025, 0.06, 4), col("#d01020"), PLASTIC, tr(d.screen.cx + 0.08 + s * 0.09, top + 0.025, zF + 0.035, 0, Math.PI / 4, s * -0.2));
      }
      if (hi) {
        b.add(sphere(0.02, 6, 4), col("#e0b030"), GOLD, tr(W / 2 - 0.01, H * 0.75, zF + 0.03));
        b.add(box(0.012, 0.12, 0.012), col("#d01020"), CLOTH, tr(W / 2 - 0.01, H * 0.62, zF + 0.03));
      }
    } else if (is("hyottoko")) {
      b.add(dome(0.2, rs, hi ? 4 : 2), col("#1e2a50"), CLOTH, tr(W * 0.12, top - 0.02, zMid + 0.04, 0, 0, -0.15, 1.1, 0.45, 0.9));
    } else if (is("mask")) {
      // Unknown mask: painted on the screen by screen.ts; nothing 3D.
    } else {
      // Unknown: a small hat-like shape in its colour.
      b.add(cyl(0.11, 0.13, 0.08, rs), c, CLOTH, tr(0, top + 0.04, zMid));
      b.add(cyl(0.18, 0.18, 0.01, rs), c, CLOTH, tr(0, top + 0.005, zMid));
    }
  }
  // TV-mounted accessories.
  if (!hi) return;
  const acc = t.accessories.join(" · ").toLowerCase();
  const notes = (t.notes ?? "").toLowerCase();
  if (mentions(acc, "headset")) {
    b.add(torus(W * 0.5 + 0.02, 0.01, 4, 12, Math.PI), col("#1a1a1c"), PLASTIC, tr(0, H * 0.45, zMid));
    for (const s of [1, -1]) b.add(cyl(0.05, 0.05, 0.03, 10), col("#1a1a1c"), PLASTIC, tr(s * (W / 2 + 0.015), H * 0.45, zMid, 0, 0, Math.PI / 2));
    b.add(cyl(0.005, 0.005, 0.2, 4), col("#1a1a1c"), PLASTIC, tr(-W / 2 + 0.02, H * 0.3, zF + 0.05, 1.2, 0.3, 0));
  }
  if (mentions(acc, "string lights") || mentions(notes, "string lights")) {
    const cols = ["#ff3030", "#30d050", "#ffd030", "#3080ff"];
    for (let i = 0; i < 9; i++) {
      const x = -W / 2 + 0.03 + (i * (W - 0.06)) / 8;
      b.add(sphere(0.012, 5, 4), col(cols[i % 4]), glow(1.2, 0.3), tr(x, H - 0.005 - Math.sin((i / 8) * Math.PI) * 0.03, zF + 0.012));
    }
  }
  if (mentions(acc, "crank")) {
    b.add(cyl(0.01, 0.01, 0.08, 6), col("#d09030"), GOLD, tr(-W / 2 - 0.04, H * 0.55, zMid, 0, 0, Math.PI / 2));
    b.add(box(0.012, 0.1, 0.012), col("#d09030"), GOLD, tr(-W / 2 - 0.08, H * 0.5, zMid));
    b.add(cyl(0.012, 0.012, 0.05, 6), col("#d09030"), GOLD, tr(-W / 2 - 0.1, H * 0.45, zMid, 0, 0, Math.PI / 2));
  }
  if (mentions(acc, "arrow")) {
    const m = tr(d.screen.cx, H * 0.55, zMid, 0, 0.4, -1.1);
    b.add(cyl(0.007, 0.007, W * 1.45, 5), col("#c89a50"), CLOTH, m);
    b.add(cone(0.03, 0.05, 4).rotateX(0), col("#e83080"), glow(0.3), m.clone().multiply(tr(0, W * 0.75, 0)));
    b.add(box(0.05, 0.06, 0.004), col("#f0f0f0"), CLOTH, m.clone().multiply(tr(0, -W * 0.68, 0)));
  }
}

/** A band wrapped around the TV at height `yf`·H (headbands, goggle straps). */
function band(b: PartBuilder, d: TvDims, c: THREE.Color, yf: number, h: number): void {
  const { W, H, zF, zB, zMid } = d;
  const D = zF - zB;
  const y = H * yf;
  const front = zF + d.screen.bulge + 0.012;
  b.add(box(W + 0.014, h, 0.012), c, CLOTH, tr(0, y, front - 0.004));
  b.add(box(W + 0.014, h, 0.012), c, CLOTH, tr(0, y, zB - 0.004));
  for (const s of [1, -1]) b.add(box(0.012, h, D + (front - zF) + 0.01), c, CLOTH, tr(s * (W / 2 + 0.006), y, zMid + (front - zF) / 2));
}

function flower(b: PartBuilder, at: THREE.Vector3, size: number, c: THREE.Color, hi: boolean): void {
  const petals = hi ? 7 : 4;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    b.add(sphere(size * 0.45, hi ? 6 : 4, 4), c, CLOTH, tr(at.x + Math.cos(a) * size * 0.5, at.y + Math.sin(a) * size * 0.5 + size * 0.5, at.z, 0, 0, a, 1, 0.6, 0.5));
  }
  b.add(sphere(size * 0.3, 6, 4), col("#f0c020"), CLOTH, tr(at.x, at.y + size * 0.5, at.z + 0.01));
  if (hi) b.add(sphere(size * 0.4, 5, 3), col("#3a8a3a"), CLOTH, tr(at.x - size * 0.7, at.y + size * 0.1, at.z, 0, 0, 0.6, 1, 0.35, 0.6));
}
