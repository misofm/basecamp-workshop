/**
 * The Tamashi screen: a per-token CanvasTexture + emissive material for the CRT face.
 *
 * Owns: painting faces procedurally (background, CRT vignette/glow, scanlines, glare, eyes
 * and mouth variants parsed from the traits, painted-on masks/goggles/glasses), loading the
 * cropped artwork for non-face screens from /tamashi/screens/<id>.webp (cover-fit, same
 * vignette; falls back to background + soft noise), and caching one material per token and
 * size. Glow "strong" screens are pushed brighter so the bloom pass picks them up.
 * Must not: build geometry (tv-head.ts owns the screen surface).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { mentions, type TamashiTraits } from "./traits";
import { rng } from "./materials";

const cache = new Map<string, THREE.MeshStandardMaterial>();
const pending = new Set<Promise<void>>();

/** Resolves once every screen image requested so far has loaded (or failed over). */
export async function screensReady(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

const EMISSIVE = { none: 0.38, soft: 0.5, strong: 1.05 } as const;

/** The screen material for token `t`: `big` = player-size texture (512 px wide). Cached. */
export function screenMaterial(t: TamashiTraits, aspect: number, big: boolean): THREE.MeshStandardMaterial {
  const key = `${t.id}:${big ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = big ? 512 : 256;
  const h = Math.round(w / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const glowKind = String(t.screen.glow);
  const strength = glowKind === "strong" ? EMISSIVE.strong : glowKind === "soft" ? EMISSIVE.soft : EMISSIVE.none;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: strength,
    color: new THREE.Color(0.38, 0.38, 0.38),
    roughness: 0.2,
    metalness: 0,
  });
  mat.name = `tamashi-screen-${t.id}`;
  cache.set(key, mat);

  const kind = String(t.screen.kind);
  if (kind === "face") {
    paintFace(c, w, h, t);
    tex.needsUpdate = true;
  } else {
    paintFallback(c, w, h, t);
    tex.needsUpdate = true;
    const p = loadScreenImage(t.id).then(
      (img) => {
        if (!img) return;
        c.save();
        const s = Math.max(w / img.width, h / img.height);
        const dw = img.width * s;
        const dh = img.height * s;
        c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        c.restore();
        crtOverlay(c, w, h, t.screen.background, edgeColor(t), 0.55);
        tex.needsUpdate = true;
      },
      () => undefined,
    );
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
  return mat;
}

function loadScreenImage(id: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${import.meta.env.BASE_URL}tamashi/screens/${id}.webp`;
  });
}

// ── Painting helpers ──

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function tone(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const k = (v: number) => Math.round(f <= 1 ? v * f : v + (255 - v) * Math.min(1, f - 1));
  return `#${[k(r), k(g), k(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function lumHex(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Edge (vignette) colour: from the notes ("#b090a0 edges") or the background, darker, toward the bezel. */
function edgeColor(t: TamashiTraits): string {
  const m = /(#[0-9a-f]{6})\s*edges?/i.exec(t.notes ?? "");
  if (m) return m[1];
  const bg = t.screen.background;
  const [r1, g1, b1] = hexToRgb(tone(bg, lumHex(bg) > 0.25 ? 0.68 : 0.55));
  const [r2, g2, b2] = hexToRgb(t.tv.bezelColor);
  const k = 0.2;
  return `#${[r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Vignette + glare + scanlines on top of whatever is drawn. */
function crtOverlay(c: CanvasRenderingContext2D, w: number, h: number, _bg: string, edge: string, strength: number): void {
  c.save();
  c.translate(w / 2, h / 2);
  c.scale(w / 2, h / 2);
  const v = c.createRadialGradient(0, 0, 0.2, 0, 0, 1.42);
  v.addColorStop(0, rgba(edge, 0));
  v.addColorStop(0.4, rgba(edge, 0.18 * strength));
  v.addColorStop(0.72, rgba(edge, 0.85 * strength));
  v.addColorStop(1, rgba(edge, 1 * strength));
  c.fillStyle = v;
  c.fillRect(-1, -1, 2, 2);
  c.restore();
  // Soft glare top-left, as in the art.
  const g = c.createLinearGradient(0, 0, w * 0.55, h * 0.55);
  g.addColorStop(0, "rgba(255,255,255,0.16)");
  g.addColorStop(0.6, "rgba(255,255,255,0.03)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(w * 0.28, h * 0.2, w * 0.3, h * 0.14, -0.35, 0, Math.PI * 2);
  c.fill();
  // Scanlines.
  c.fillStyle = "rgba(0,0,0,0.05)";
  const step = Math.max(2, Math.round(h / 90));
  for (let y = 0; y < h; y += step * 2) c.fillRect(0, y, w, step);
}

function paintBackground(c: CanvasRenderingContext2D, w: number, h: number, t: TamashiTraits): void {
  const bg = t.screen.background;
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const glow = String(t.screen.glow);
  if (glow !== "none") {
    const g = c.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.6);
    const lift = glow === "strong" ? 1.28 : 1.07;
    g.addColorStop(0, rgba(tone(bg, lift), 0.9));
    g.addColorStop(1, rgba(tone(bg, lift), 0));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

function paintFallback(c: CanvasRenderingContext2D, w: number, h: number, t: TamashiTraits): void {
  paintBackground(c, w, h, t);
  const r = rng(t.id * 7919);
  const img = c.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 46;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  crtOverlay(c, w, h, t.screen.background, edgeColor(t), 0.8);
}

// ── Faces ──

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function heart(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.beginPath();
  c.moveTo(x, y + s * 0.35);
  c.bezierCurveTo(x - s * 0.1, y + s * 0.15, x - s * 0.55, y + s * 0.1, x - s * 0.5, y - s * 0.2);
  c.bezierCurveTo(x - s * 0.45, y - s * 0.5, x - s * 0.08, y - s * 0.5, x, y - s * 0.22);
  c.bezierCurveTo(x + s * 0.08, y - s * 0.5, x + s * 0.45, y - s * 0.5, x + s * 0.5, y - s * 0.2);
  c.bezierCurveTo(x + s * 0.55, y + s * 0.1, x + s * 0.1, y + s * 0.15, x, y + s * 0.35);
  c.fill();
}

function paintFace(c: CanvasRenderingContext2D, w: number, h: number, t: TamashiTraits): void {
  paintBackground(c, w, h, t);
  const S = t.screen;
  const eyes = String(S.eyes);
  const mouth = S.mouth ? String(S.mouth) : "";
  const acc = t.accessories.join(" · ");
  const hw = t.headwear ? String(t.headwear.type) : "";
  const eyeC = S.eyeColor ?? (lumHex(S.background) < 0.3 ? "#f0f0f0" : "#111111");
  const u = (x: number) => x * w;
  const v = (y: number) => y * h;
  const m = Math.min(w, h);
  // Layout (measured on #95): bars ≈ 3.5 % × 17 % of the screen, 58 % apart, a bit below centre.
  const ex = [0.5 - 0.29, 0.5 + 0.29];
  const ey = 0.58;
  const bw = 0.04;
  const bh = 0.185;
  const glowy = String(S.glow) === "strong" || mentions(eyes, "neon", "glow");
  c.save();
  if (glowy) {
    c.shadowColor = eyeC;
    c.shadowBlur = m * 0.04;
  }
  c.fillStyle = eyeC;
  c.strokeStyle = eyeC;
  c.lineCap = "round";
  c.lineJoin = "round";
  const bars = (wf = 1, hf = 1, yo = 0) => {
    for (const x of ex) {
      rr(c, u(x - (bw * wf) / 2), v(ey + yo - (bh * hf) / 2), u(bw * wf), v(bh * hf), u(bw * wf) * 0.3);
      c.fill();
    }
  };
  const line = (pts: [number, number][], lw: number) => {
    c.lineWidth = m * lw;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(u(x), v(y)) : c.moveTo(u(x), v(y))));
    c.stroke();
  };

  // Ninja eye-slit band behind the eyes.
  if (mentions(eyes, "slit band", "eye-slit", "ninja")) {
    c.save();
    c.shadowColor = "#ffffff";
    c.shadowBlur = m * 0.08;
    c.fillStyle = "#f4f4f8";
    rr(c, u(0.06), v(ey - 0.13), u(0.88), v(0.26), v(0.1));
    c.fill();
    c.restore();
    c.fillStyle = eyeC;
  }

  if (mentions(eyes, "heart")) {
    for (const x of ex) heart(c, u(x), v(ey - 0.02), m * 0.2);
  } else if (mentions(eyes, "anime", "shoujo")) {
    for (const [i, x] of ex.entries()) {
      c.fillStyle = eyeC;
      c.beginPath();
      c.ellipse(u(x), v(ey - 0.03), u(0.07), v(0.12), 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.ellipse(u(x - 0.02), v(ey - 0.08), u(0.024), v(0.04), 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = eyeC;
      const s = i ? 1 : -1;
      line([[x - 0.08 * s, ey - 0.14], [x + 0.02 * s, ey - 0.17], [x + 0.1 * s, ey - 0.13]], 0.014);
      line([[x - 0.07 * s, ey - 0.27], [x + 0.07 * s, ey - 0.29]], 0.012);
    }
  } else if (mentions(eyes, "angry", "jagged", "slanted")) {
    for (const [i, x] of ex.entries()) {
      const s = i ? -1 : 1;
      c.beginPath();
      c.moveTo(u(x - 0.12 * s), v(ey - 0.14));
      c.lineTo(u(x + 0.11 * s), v(ey - 0.02));
      c.lineTo(u(x + 0.02 * s), v(ey + 0.04));
      c.lineTo(u(x - 0.1 * s), v(ey - 0.06));
      c.closePath();
      c.fill();
    }
  } else if (mentions(eyes, "candlestick")) {
    for (const x of ex) {
      c.fillStyle = "#30c070";
      c.fillRect(u(x - bw / 2), v(ey - bh / 2), u(bw), v(bh * 0.55));
      c.fillStyle = "#e03030";
      c.fillRect(u(x - bw / 2), v(ey + bh * 0.05), u(bw), v(bh * 0.45));
      c.strokeStyle = "#e0e0e0";
      line([[x, ey - bh * 0.85], [x, ey + bh * 0.85]], 0.006);
    }
  } else if (eyes === "dots") {
    for (const x of ex) {
      c.beginPath();
      c.arc(u(x), v(ey), m * 0.045, 0, Math.PI * 2);
      c.fill();
    }
  } else if (eyes === "closed") {
    for (const x of ex) line([[x - 0.06, ey], [x, ey - 0.05], [x + 0.06, ey]], 0.025);
  } else if (eyes === "x") {
    for (const x of ex) {
      line([[x - 0.05, ey - 0.07], [x + 0.05, ey + 0.07]], 0.025);
      line([[x + 0.05, ey - 0.07], [x - 0.05, ey + 0.07]], 0.025);
    }
  } else if (eyes === "visor") {
    c.save();
    c.shadowColor = eyeC;
    c.shadowBlur = m * 0.08;
    rr(c, u(0.1), v(ey - 0.07), u(0.8), v(0.14), v(0.07));
    c.fill();
    c.restore();
  } else if (mentions(eyes, "neon", "text", "word")) {
    // Neon squiggles where a word would be (no text copied from the art).
    c.lineWidth = m * 0.02;
    for (let i = 0; i < 5; i++) {
      const x0 = 0.18 + i * 0.13;
      line([[x0, 0.42], [x0 + 0.05, 0.3], [x0 + 0.09, 0.42]], 0.02);
    }
  } else if (mentions(eyes, "goggle")) {
    // Round welding goggles over the screen.
    c.fillStyle = "#2a1a14";
    rr(c, 0, v(ey - 0.06), w, v(0.12), 0);
    c.fill();
    for (const x of ex) {
      c.fillStyle = "#8a6a3a";
      c.beginPath();
      c.arc(u(x), v(ey), m * 0.17, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#1a2a22";
      c.beginPath();
      c.arc(u(x), v(ey), m * 0.13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(160,220,200,0.35)";
      c.beginPath();
      c.arc(u(x - 0.03), v(ey - 0.05), m * 0.04, 0, Math.PI * 2);
      c.fill();
    }
  } else if (eyes !== "none") {
    // vertical-lines (default) and everything unforeseen.
    bars();
    if (mentions(eyes, "brow", "t shape", "t-shape")) {
      for (const x of ex) {
        rr(c, u(x - 0.08), v(ey - bh / 2 - 0.05), u(0.16), v(0.04), 2);
        c.fill();
      }
    }
    if (mentions(eyes, "lid", "deadpan")) {
      for (const x of ex) line([[x - 0.06, ey - bh / 2 - 0.03], [x + 0.06, ey - bh / 2 - 0.03]], 0.018);
    }
    if (mentions(eyes, "wrinkle") || mentions(mouth, "wrinkle", "laugh line")) {
      c.globalAlpha = 0.55;
      for (const [i, x] of ex.entries()) {
        const s = i ? 1 : -1;
        line([[x + 0.06 * s, ey - 0.04], [x + 0.11 * s, ey - 0.01]], 0.01);
        line([[x + 0.06 * s, ey + 0.02], [x + 0.11 * s, ey + 0.04]], 0.01);
      }
      c.globalAlpha = 1;
    }
  }
  // Glasses (eyes "glasses" or an accessory mentioning them).
  if (eyes === "glasses" || mentions(acc, "glasses")) {
    const frameC = mentions(acc, "gold") ? "#d0a040" : mentions(acc, "wire") ? "#5a5a60" : "#111111";
    const rect = mentions(acc, "rectangular");
    const big = mentions(acc, "oversized", "magnifying") ? 1.35 : 1;
    c.save();
    c.shadowBlur = 0;
    c.strokeStyle = frameC;
    c.lineWidth = m * (rect ? 0.03 : 0.02);
    for (const x of ex) {
      c.beginPath();
      if (rect) c.roundRect(u(x - 0.12), v(ey - 0.12), u(0.24), v(0.22), m * 0.03);
      else c.ellipse(u(x), v(ey), u(0.11 * big), v(0.15 * big), 0, 0, Math.PI * 2);
      c.stroke();
      if (big > 1) {
        c.fillStyle = "rgba(255,255,255,0.12)";
        c.fill();
      }
    }
    line([[ex[0] + (rect ? 0.12 : 0.11 * big), ey - 0.02], [ex[1] - (rect ? 0.12 : 0.11 * big), ey - 0.02]], 0.015);
    c.restore();
  }
  if (mentions(acc, "safety goggles")) {
    c.save();
    c.fillStyle = "rgba(200,230,255,0.28)";
    c.strokeStyle = "rgba(240,250,255,0.75)";
    c.lineWidth = m * 0.015;
    rr(c, u(0.04), v(ey - 0.2), u(0.92), v(0.34), m * 0.1);
    c.fill();
    c.stroke();
    c.restore();
  }

  // Mouth / nose.
  c.fillStyle = eyeC;
  c.strokeStyle = eyeC;
  const my = 0.76;
  if (mentions(mouth, "jack-o", "carved", "pumpkin")) {
    c.beginPath();
    c.moveTo(u(0.47), v(0.7));
    c.lineTo(u(0.53), v(0.7));
    c.lineTo(u(0.5), v(0.64));
    c.fill();
    c.beginPath();
    c.moveTo(u(0.22), v(0.76));
    for (let i = 0; i <= 8; i++) c.lineTo(u(0.22 + i * 0.07), v(0.76 + (i % 2 ? 0.05 : 0) + Math.sin((i / 8) * Math.PI) * 0.07));
    for (let i = 8; i >= 0; i--) c.lineTo(u(0.22 + i * 0.07), v(0.82 + Math.sin((i / 8) * Math.PI) * 0.1 - (i % 2 ? 0.04 : 0)));
    c.closePath();
    c.fill();
  } else if (mentions(mouth, "fang", "teeth", "grin") || mouth === "teeth") {
    const grin = (y0: number, wd: number) => {
      c.beginPath();
      c.moveTo(u(0.5 - wd), v(y0));
      c.quadraticCurveTo(u(0.5), v(y0 + 0.2), u(0.5 + wd), v(y0));
      c.quadraticCurveTo(u(0.5), v(y0 + 0.09), u(0.5 - wd), v(y0));
      c.fill();
    };
    grin(0.7, 0.26);
    c.fillStyle = "#f8f8f8";
    for (let i = 0; i < 7; i++) {
      const x = 0.29 + i * 0.07;
      c.beginPath();
      c.moveTo(u(x), v(0.745 + Math.sin(((x - 0.24) / 0.52) * Math.PI) * 0.05));
      c.lineTo(u(x + 0.035), v(0.8 + Math.sin(((x - 0.24) / 0.52) * Math.PI) * 0.05));
      c.lineTo(u(x + 0.07), v(0.745 + Math.sin(((x - 0.21) / 0.52) * Math.PI) * 0.05));
      c.fill();
    }
  } else if (mentions(mouth, "goatee") || mouth === "mustache" || mentions(mouth, "mustache", "moustache")) {
    const white = mentions(mouth, "white");
    c.fillStyle = white ? "#f4f4f4" : eyeC;
    // Two-lobed handlebar moustache.
    c.beginPath();
    c.moveTo(u(0.5), v(my - 0.03));
    c.bezierCurveTo(u(0.42), v(my - 0.07), u(0.33), v(my - 0.02), u(0.36), v(my + 0.04));
    c.bezierCurveTo(u(0.41), v(my + 0.01), u(0.46), v(my + 0.02), u(0.5), v(my + 0.01));
    c.bezierCurveTo(u(0.54), v(my + 0.02), u(0.59), v(my + 0.01), u(0.64), v(my + 0.04));
    c.bezierCurveTo(u(0.67), v(my - 0.02), u(0.58), v(my - 0.07), u(0.5), v(my - 0.03));
    c.fill();
    if (mentions(mouth, "goatee")) {
      c.beginPath();
      c.moveTo(u(0.45), v(my + 0.06));
      c.quadraticCurveTo(u(0.5), v(my + 0.2), u(0.55), v(my + 0.06));
      c.fill();
    }
  } else if (mentions(mouth, "carrot")) {
    c.fillStyle = "#f07a20";
    c.beginPath();
    c.moveTo(u(0.47), v(0.64));
    c.lineTo(u(0.47), v(0.72));
    c.lineTo(u(0.62), v(0.69));
    c.closePath();
    c.fill();
  } else if (mentions(mouth, "rainbow")) {
    const cols = ["#e83030", "#f09020", "#f0e030", "#40c040", "#3080e0", "#8040c0"];
    cols.forEach((cc, i) => {
      c.fillStyle = cc;
      c.fillRect(u(0.44 + i * 0.02), v(my), u(0.02), v(0.3));
    });
    c.fillStyle = eyeC;
    c.fillRect(u(0.42), v(my - 0.01), u(0.16), v(0.015));
  } else if (mentions(mouth, "'o'", " o ", "pucker", "surprised") || mouth === "o") {
    c.lineWidth = m * 0.015;
    c.beginPath();
    c.ellipse(u(0.5), v(my), u(0.025), v(0.035), 0, 0, Math.PI * 2);
    c.stroke();
  } else if (mouth === "frown") {
    line([[0.42, my + 0.03], [0.5, my - 0.02], [0.58, my + 0.03]], 0.018);
  } else if (mouth === "smile" || mentions(mouth, "smile")) {
    c.lineWidth = m * 0.018;
    c.beginPath();
    c.arc(u(0.5), v(my - 0.07), m * 0.07, 0.2 * Math.PI, 0.8 * Math.PI);
    c.stroke();
  } else if (mentions(mouth, "line")) {
    line([[0.45, my + 0.02], [0.55, my + 0.02]], 0.014);
  }
  // Beard / hair painted on the screen.
  if (mentions(acc, "beard")) {
    c.fillStyle = "#3a3632";
    c.beginPath();
    c.moveTo(u(0.2), v(0.72));
    for (let i = 0; i <= 10; i++) {
      const x = 0.2 + i * 0.06;
      c.lineTo(u(x), v(1.02 - Math.sin((i / 10) * Math.PI) * 0.0 - (i % 2 ? 0.04 : 0)));
    }
    c.lineTo(u(0.8), v(0.72));
    c.quadraticCurveTo(u(0.5), v(0.86), u(0.2), v(0.72));
    c.fill();
    line([[0.42, 0.74], [0.58, 0.74]], 0.035);
  }
  if (mentions(acc, "hair fringe", "fringe")) {
    c.fillStyle = "#3a3632";
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(w, 0);
    for (let i = 10; i >= 0; i--) c.lineTo(u(i * 0.1), v(0.08 + (i % 2 ? 0.06 : 0)));
    c.fill();
  }
  c.restore();
  paintMask(c, w, h, hw);
  crtOverlay(c, w, h, S.background, edgeColor(t), 1);
}

/** Masks worn over the screen (kitsune, hyottoko): painted flat onto it. */
function paintMask(c: CanvasRenderingContext2D, w: number, h: number, hw: string): void {
  const u = (x: number) => x * w;
  const v = (y: number) => y * h;
  const m = Math.min(w, h);
  if (mentions(hw, "kitsune", "fox mask")) {
    c.save();
    c.fillStyle = "#f8f6f2";
    c.beginPath();
    c.moveTo(u(0.3), v(0.05));
    c.quadraticCurveTo(u(0.95), v(0.0), u(0.98), v(0.5));
    c.quadraticCurveTo(u(0.9), v(0.95), u(0.62), v(1.0));
    c.quadraticCurveTo(u(0.32), v(0.8), u(0.3), v(0.05));
    c.fill();
    c.strokeStyle = "#d01020";
    c.lineWidth = m * 0.025;
    c.lineCap = "round";
    for (const [x0, y0, x1, y1] of [
      [0.45, 0.35, 0.6, 0.42],
      [0.72, 0.42, 0.88, 0.35],
      [0.5, 0.22, 0.6, 0.3],
      [0.8, 0.22, 0.72, 0.3],
    ]) {
      c.beginPath();
      c.moveTo(u(x0), v(y0));
      c.lineTo(u(x1), v(y1));
      c.stroke();
    }
    c.beginPath();
    c.moveTo(u(0.6), v(0.82));
    c.quadraticCurveTo(u(0.72), v(0.9), u(0.84), v(0.8));
    c.stroke();
    c.fillStyle = "#1a1a1a";
    c.beginPath();
    c.ellipse(u(0.73), v(0.72), u(0.02), v(0.015), 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  } else if (mentions(hw, "hyottoko")) {
    c.save();
    c.fillStyle = "#f2b8b4";
    c.beginPath();
    c.ellipse(u(0.72), v(0.55), u(0.3), v(0.5), 0.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#1e2a50";
    c.beginPath();
    c.ellipse(u(0.68), v(0.02), u(0.36), v(0.16), 0, 0, Math.PI * 2);
    c.fill();
    for (const x of [0.6, 0.82]) {
      c.fillStyle = "#ffffff";
      c.fillRect(u(x - 0.05), v(0.36), u(0.1), v(0.14));
      c.fillStyle = "#111111";
      c.fillRect(u(x - 0.012), v(0.39), u(0.024), v(0.09));
    }
    c.fillStyle = "#e03030";
    c.beginPath();
    c.ellipse(u(0.95), v(0.7), u(0.04), v(0.05), 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}

/** Free a cached screen (not normally needed: screens are shared and tiny). */
export function disposeScreen(id: number): void {
  for (const big of [0, 1]) {
    const k = `${id}:${big}`;
    const m = cache.get(k);
    if (m) {
      m.map?.dispose();
      m.dispose();
      cache.delete(k);
    }
  }
}

