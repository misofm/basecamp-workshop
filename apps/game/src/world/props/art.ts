/**
 * Street-prop art: canvas draw functions for the posters, murals, notices, plates and
 * decals that StreetProps packs into its one SignAtlas.
 *
 * Owns: how each painted surface looks (procedural canvas drawing, grime, tears).
 * Must not: hold Japanese text (every string comes from SIGNS in signage.ts) or reproduce
 * any real artwork, brand or logo (bible §8): the murals only evoke styles.
 */
import { EN_FONT, JP_FONT, SIGNS, fitFont, grime, drawTriangleMark, type Draw } from "../signage";
import { rng } from "./solids";

type Ctx = CanvasRenderingContext2D;

// ─────────────────────────────── helpers ───────────────────────────────

function text(c: Ctx, s: string, x: number, y: number, maxW: number, size: number, family: string, color: string, weight = 700) {
  fitFont(c, s, maxW, size, family, weight);
  c.fillStyle = color;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(s, x, y);
}

/** Jagged clip around the whole cell (paper edges). */
function jaggedClip(c: Ctx, w: number, h: number, R: () => number, depth: number) {
  c.beginPath();
  const step = Math.max(6, Math.min(w, h) / 14);
  const j = () => R() * depth;
  c.moveTo(j(), j());
  for (let x = step; x < w; x += step) c.lineTo(x, j());
  c.lineTo(w - j(), j());
  for (let y = step; y < h; y += step) c.lineTo(w - j(), y);
  c.lineTo(w - j(), h - j());
  for (let x = w - step; x > 0; x -= step) c.lineTo(x, h - j());
  c.lineTo(j(), h - j());
  for (let y = h - step; y > 0; y -= step) c.lineTo(j(), y);
  c.closePath();
  c.clip();
}

/** Erase a ragged chunk from one corner (0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left). */
function tearCorner(c: Ctx, w: number, h: number, R: () => number, corner: number, size: number) {
  const cx = corner === 1 || corner === 2 ? w : 0;
  const cy = corner >= 2 ? h : 0;
  const ax = cx === 0 ? w * size : w * (1 - size);
  const by = cy === 0 ? h * size * (0.8 + R() * 0.5) : h * (1 - size * (0.8 + R() * 0.5));
  c.save();
  c.globalCompositeOperation = "destination-out";
  c.beginPath();
  c.moveTo(cx, cy);
  c.lineTo(ax, cy);
  const n = 9;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    c.lineTo(ax + (cx - ax) * t + (R() - 0.5) * w * 0.07, cy + (by - cy) * t + (R() - 0.5) * h * 0.05);
  }
  c.lineTo(cx, by);
  c.closePath();
  c.fill();
  c.restore();
}

/** Wrap a draw in paper edges, an optional torn corner and grime. */
export function torn(draw: Draw, seed: number, opts: { corner?: number; size?: number; edge?: number; grime?: number } = {}): Draw {
  return (c, w, h) => {
    const R = rng(seed);
    c.save();
    jaggedClip(c, w, h, R, opts.edge ?? Math.min(w, h) * 0.025);
    draw(c, w, h);
    if (opts.grime) grime(c, w, h, opts.grime, seed);
    if (opts.corner !== undefined) tearCorner(c, w, h, R, opts.corner, opts.size ?? 0.35);
    c.restore();
  };
}

/** Faded paper with sun-bleach blotches. */
function fade(c: Ctx, w: number, h: number, R: () => number, amount: number) {
  c.save();
  for (let i = 0; i < 14; i++) {
    const x = R() * w,
      y = R() * h,
      r = (0.15 + R() * 0.35) * Math.max(w, h);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(235,226,205,${0.18 * amount})`);
    g.addColorStop(1, "rgba(235,226,205,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  c.restore();
}

/** Spray-paint stroke with overspray. */
function spray(c: Ctx, pts: [number, number][], width: number, color: string, R: () => number) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.stroke();
  c.fillStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[i + 1];
    for (let k = 0; k < 40; k++) {
      const t = R();
      const off = (R() - 0.5) * width * 2.2;
      c.globalAlpha = 0.25 * R();
      c.fillRect(x0 + (x1 - x0) * t + off, y0 + (y1 - y0) * t + (R() - 0.5) * width * 2.2, 2, 2);
    }
  }
  // Drips.
  c.globalAlpha = 0.8;
  c.lineWidth = Math.max(1.5, width * 0.18);
  for (let i = 0; i < pts.length; i++) {
    if (R() > 0.45) continue;
    const [x, y] = pts[i];
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (R() - 0.5) * 2, y + width * (1 + R() * 3));
    c.stroke();
  }
  c.restore();
}

function split(s: string, sep = " — ") {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + sep.length)];
}

// ─────────────────────────────── political posters ───────────────────────────────

/** Gang's old poster (purple and black), crossed out in red spray. */
export function posterGang(seed: number): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(seed + 1);
      c.fillStyle = "#4a2d5a";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#1a1220";
      c.fillRect(0, h * 0.62, w, h * 0.38);
      // A raised fist silhouette (simple blocks).
      c.fillStyle = "#cdb9d9";
      c.fillRect(w * 0.38, h * 0.2, w * 0.24, h * 0.16);
      c.fillRect(w * 0.43, h * 0.35, w * 0.14, h * 0.2);
      for (let i = 0; i < 4; i++) c.fillRect(w * (0.38 + i * 0.06), h * 0.16, w * 0.05, h * 0.06);
      const [jp1, jp2] = split(SIGNS.gang.jp);
      const [en1, en2] = split(SIGNS.gang.en);
      text(c, jp1, w / 2, h * 0.08, w * 0.9, h * 0.08, JP_FONT, "#e8d8f0");
      text(c, jp2, w / 2, h * 0.69, w * 0.85, h * 0.11, JP_FONT, "#efe4f5");
      text(c, en1, w / 2, h * 0.8, w * 0.9, h * 0.045, EN_FONT, "#cbb2d8");
      text(c, en2, w / 2, h * 0.88, w * 0.9, h * 0.055, EN_FONT, "#e0cce9");
      fade(c, w, h, R, 1.2);
      // Crossed out: a big red X and a scrawl.
      spray(c, [[w * 0.06, h * 0.08], [w * 0.94, h * 0.9]], w * 0.06, "#b4231d", R);
      spray(c, [[w * 0.92, h * 0.1], [w * 0.1, h * 0.92]], w * 0.06, "#b4231d", R);
    },
    seed,
    { corner: seed % 4, size: 0.22 + (seed % 3) * 0.06, grime: 0.9 },
  );
}

/** Order's poster: white with light blue, clean and authoritarian. */
export function posterOrder(seed: number): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(seed + 2);
      c.fillStyle = "#ecefef";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#8fc3df";
      c.fillRect(0, 0, w, h * 0.1);
      c.fillRect(0, h * 0.9, w, h * 0.1);
      // Emblem: a square inside a circle (the grid of rules).
      c.strokeStyle = "#6aa9cc";
      c.lineWidth = w * 0.03;
      c.beginPath();
      c.arc(w / 2, h * 0.33, w * 0.2, 0, Math.PI * 2);
      c.stroke();
      c.strokeRect(w * 0.39, h * 0.33 - w * 0.11, w * 0.22, w * 0.22);
      text(c, SIGNS.order.jp, w / 2, h * 0.6, w * 0.8, h * 0.15, JP_FONT, "#2f6f96");
      const [en1, en2] = split(SIGNS.order.en);
      text(c, en1, w / 2, h * 0.72, w * 0.8, h * 0.07, EN_FONT, "#3d7ea3");
      const words = en2.split(" ");
      const mid = Math.ceil(words.length / 2);
      text(c, words.slice(0, mid).join(" "), w / 2, h * 0.795, w * 0.86, h * 0.045, EN_FONT, "#4f8db0");
      text(c, words.slice(mid).join(" "), w / 2, h * 0.845, w * 0.86, h * 0.045, EN_FONT, "#4f8db0");
      fade(c, w, h, R, 0.8);
    },
    seed,
    { corner: (seed + 1) % 4, size: 0.18 + (seed % 2) * 0.12, grime: 0.8 },
  );
}

/** Chaos's poster: red and black, a jagged slash. */
export function posterChaos(seed: number): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(seed + 3);
      c.fillStyle = "#151112";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#b0241f";
      c.beginPath();
      c.moveTo(w * 0.15, h * 0.06);
      c.lineTo(w * 0.62, h * 0.08);
      c.lineTo(w * 0.42, h * 0.3);
      c.lineTo(w * 0.8, h * 0.3);
      c.lineTo(w * 0.3, h * 0.6);
      c.lineTo(w * 0.45, h * 0.37);
      c.lineTo(w * 0.12, h * 0.37);
      c.closePath();
      c.fill();
      text(c, SIGNS.chaos.jp, w / 2, h * 0.72, w * 0.88, h * 0.12, JP_FONT, "#d8302a");
      text(c, SIGNS.chaos.en, w / 2, h * 0.84, w * 0.88, h * 0.06, EN_FONT, "#e9dcd5");
      fade(c, w, h, R, 0.5);
    },
    seed,
    { corner: (seed + 2) % 4, size: 0.25, grime: 1 },
  );
}

/** Older layers underneath: faded flyers with illegible lines. */
export function posterScrap(seed: number, tint: string): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(seed + 4);
      c.fillStyle = tint;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "rgba(40,30,30,0.45)";
      c.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.18);
      for (let y = h * 0.38; y < h * 0.9; y += h * 0.06) c.fillRect(w * 0.1, y, w * (0.4 + R() * 0.4), h * 0.025);
      fade(c, w, h, R, 1.5);
    },
    seed,
    { corner: seed % 4, size: 0.4, grime: 1.2 },
  );
}

// ─────────────────────────────── murals ───────────────────────────────

/** "ノゾミ / NOZOMI" in orange and black, painted on brick (transparent background). */
export function nozomiLettering(): Draw {
  return (c, w, h) => {
    const R = rng(77);
    c.save();
    c.fillStyle = "#e0661f";
    c.fillRect(w * 0.04, h * 0.62, w * 0.92, h * 0.3);
    fitFont(c, SIGNS.nozomi.jp, w * 0.9, h * 0.62, JP_FONT, 900);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = h * 0.06;
    c.strokeStyle = "#141010";
    c.strokeText(SIGNS.nozomi.jp, w / 2 + h * 0.03, h * 0.34 + h * 0.03);
    c.fillStyle = "#141010";
    c.fillText(SIGNS.nozomi.jp, w / 2 + h * 0.03, h * 0.34 + h * 0.03);
    c.fillStyle = "#f0782a";
    c.fillText(SIGNS.nozomi.jp, w / 2, h * 0.34);
    text(c, SIGNS.nozomi.en, w / 2, h * 0.78, w * 0.85, h * 0.25, EN_FONT, "#141010");
    // Drips and wear.
    c.fillStyle = "#e0661f";
    for (let i = 0; i < 26; i++) {
      const x = w * (0.06 + R() * 0.88);
      c.fillRect(x, h * 0.9, 2 + R() * 3, h * (0.02 + R() * 0.08));
    }
    c.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 900; i++) {
      c.globalAlpha = 0.2 + R() * 0.6;
      const s = 2 + R() * 9;
      c.fillRect(R() * w, R() * h, s, s * 0.6);
    }
    c.restore();
    c.save();
    grime(c, w, h, 0.6, 501);
    c.restore();
  };
}

/** A swirling night sky over Nozomi's skyline: a post-impressionist evocation, no real composition. */
export function swirlSky(): Draw {
  return (c, w, h) => {
    const R = rng(1889);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b2f5c");
    g.addColorStop(1, "#2c4f7c");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const centres = [
      { x: w * 0.3, y: h * 0.32, s: 1 },
      { x: w * 0.62, y: h * 0.42, s: -1 },
    ];
    const lights = [
      { x: w * 0.82, y: h * 0.2, r: h * 0.12, moon: true },
      { x: w * 0.12, y: h * 0.16, r: h * 0.05 },
      { x: w * 0.47, y: h * 0.12, r: h * 0.045 },
      { x: w * 0.7, y: h * 0.62, r: h * 0.04 },
      { x: w * 0.22, y: h * 0.58, r: h * 0.035 },
    ];
    const blues = ["#3c63a6", "#5a83c4", "#284a8a", "#7fa4d6", "#a9c4e2", "#1f3c78"];
    for (let i = 0; i < 900; i++) {
      let x = R() * w,
        y = R() * h * 0.85;
      let near = 1e9;
      for (const l of lights) near = Math.min(near, Math.hypot(x - l.x, y - l.y) / l.r);
      c.strokeStyle = near < 2.2 ? (R() < 0.6 ? "#e8c54a" : "#f3e39a") : blues[Math.floor(R() * blues.length)];
      c.lineWidth = 3 + R() * 5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        let a = Math.sin(x * 0.012) * 0.6 + Math.cos(y * 0.02) * 0.4;
        for (const ct of centres) {
          const d = Math.hypot(x - ct.x, y - ct.y);
          if (d < h * 0.32) a = Math.atan2(y - ct.y, x - ct.x) + (Math.PI / 2) * ct.s;
        }
        x += Math.cos(a) * 9;
        y += Math.sin(a) * 9;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    for (const l of lights) {
      for (let k = 3; k > 0; k--) {
        c.strokeStyle = k % 2 ? "#f1d76a" : "#d9a93a";
        c.lineWidth = 4;
        c.beginPath();
        c.arc(l.x, l.y, l.r * (0.5 + k * 0.28), 0, Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = "#f6e27a";
      c.beginPath();
      c.arc(l.x, l.y, l.r * 0.45, 0, Math.PI * 2);
      c.fill();
      if (l.moon) {
        c.fillStyle = "#2a4677";
        c.beginPath();
        c.arc(l.x + l.r * 0.2, l.y - l.r * 0.12, l.r * 0.38, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Black skyline of the dead city, with a crane (Nozomi's own landmarks).
    c.fillStyle = "#0d0f17";
    let x = 0;
    while (x < w) {
      const bw = 25 + R() * 60,
        bh = h * (0.12 + R() * 0.28);
      c.fillRect(x, h - bh, bw, bh);
      x += bw - 4;
    }
    c.strokeStyle = "#0d0f17";
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(w * 0.56, h);
    c.lineTo(w * 0.56, h * 0.38);
    c.lineTo(w * 0.86, h * 0.4);
    c.moveTo(w * 0.56, h * 0.38);
    c.lineTo(w * 0.48, h * 0.42);
    c.stroke();
    // A few lit windows (the three powered blocks).
    c.fillStyle = "#e9b65a";
    for (let i = 0; i < 18; i++) c.fillRect(w * (0.05 + R() * 0.4), h * (0.85 + R() * 0.12), 5, 6);
    fade(c, w, h, R, 1.4);
    grime(c, w, h, 1.1, 1889);
  };
}

/** Pop-art "NOZOMI SOUP" can, orange/black/cream with halftone (never the real brand). */
export function soupCan(): Draw {
  return (c, w, h) => {
    const R = rng(28);
    c.fillStyle = "#e9dcc2";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#e7a35f";
    for (let y = 8; y < h; y += 14) for (let x = (y / 14) % 2 ? 8 : 15; x < w; x += 14) c.fillRect(x, y, 5, 5);
    const cx = w / 2,
      cw = w * 0.62,
      top = h * 0.12,
      bot = h * 0.9,
      ry = cw * 0.16;
    c.lineWidth = 6;
    c.strokeStyle = "#151112";
    // Body.
    c.fillStyle = "#151112";
    c.fillRect(cx - cw / 2, top, cw, bot - top);
    c.fillStyle = "#ea6a1f";
    c.fillRect(cx - cw / 2, top, cw, (bot - top) * 0.48);
    c.beginPath();
    c.ellipse(cx, bot, cw / 2, ry, 0, 0, Math.PI);
    c.fill();
    c.stroke();
    c.strokeRect(cx - cw / 2, top, cw, bot - top);
    // Lid.
    c.fillStyle = "#c9c4bb";
    c.beginPath();
    c.ellipse(cx, top, cw / 2, ry, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    c.ellipse(cx, top, cw * 0.4, ry * 0.75, 0, 0, Math.PI * 2);
    c.stroke();
    // Label: jp on the orange half, en on the black half, a cream medallion.
    text(c, SIGNS.soup.jp, cx, top + (bot - top) * 0.22, cw * 0.86, h * 0.1, JP_FONT, "#151112");
    c.fillStyle = "#f1e6cf";
    c.beginPath();
    c.arc(cx, top + (bot - top) * 0.5, cw * 0.14, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const [en1, en2] = SIGNS.soup.en.split(" ");
    text(c, en1, cx, top + (bot - top) * 0.67, cw * 0.86, h * 0.09, EN_FONT, "#ea6a1f");
    text(c, en2, cx, top + (bot - top) * 0.8, cw * 0.6, h * 0.06, EN_FONT, "#f1e6cf");
    fade(c, w, h, R, 1);
    grime(c, w, h, 1.1, 28);
  };
}

/** A cubist TV: fractured planes of a CRT set (style only). */
export function cubistTV(): Draw {
  return (c, w, h) => {
    const R = rng(1912);
    c.fillStyle = "#8a7a5e";
    c.fillRect(0, 0, w, h);
    const pal = ["#b49a62", "#6e6250", "#c8b88f", "#4f5b57", "#a0703f", "#d6caa6", "#3a3a34", "#7d8b7c"];
    for (let i = 0; i < 70; i++) {
      c.fillStyle = pal[Math.floor(R() * pal.length)];
      c.beginPath();
      const x = R() * w,
        y = R() * h,
        s = 30 + R() * 110;
      c.moveTo(x, y);
      c.lineTo(x + s * (R() - 0.2), y + s * (R() - 0.5));
      c.lineTo(x + s * (R() - 0.5), y + s * (R() + 0.2));
      c.closePath();
      c.fill();
    }
    // The set in three shifted slices.
    c.lineWidth = 6;
    c.strokeStyle = "#1c1a16";
    const slices = [
      { dx: -14, dy: 6, x0: 0.22, x1: 0.45 },
      { dx: 0, dy: -10, x0: 0.45, x1: 0.62 },
      { dx: 18, dy: 12, x0: 0.62, x1: 0.8 },
    ];
    for (const s of slices) {
      c.fillStyle = pal[Math.floor(R() * 4)];
      c.fillRect(w * s.x0 + s.dx, h * 0.3 + s.dy, w * (s.x1 - s.x0), h * 0.5);
      c.strokeRect(w * s.x0 + s.dx, h * 0.3 + s.dy, w * (s.x1 - s.x0), h * 0.5);
      c.fillStyle = "#3f6b66";
      c.fillRect(w * Math.max(s.x0, 0.28) + s.dx, h * 0.38 + s.dy, w * (Math.min(s.x1, 0.7) - Math.max(s.x0, 0.28)), h * 0.32);
    }
    // Two vertical-line eyes on different planes, antennas at odd angles.
    c.strokeStyle = "#e8e2c8";
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(w * 0.4 - 14, h * 0.47);
    c.lineTo(w * 0.4 - 14, h * 0.6);
    c.moveTo(w * 0.57, h * 0.43 - 10);
    c.lineTo(w * 0.57, h * 0.56 - 10);
    c.stroke();
    c.strokeStyle = "#1c1a16";
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(w * 0.5, h * 0.24);
    c.lineTo(w * 0.32, h * 0.04);
    c.moveTo(w * 0.52, h * 0.22);
    c.lineTo(w * 0.74, h * 0.06);
    c.stroke();
    c.beginPath();
    c.arc(w * 0.51, h * 0.27, w * 0.06, Math.PI, 0);
    c.fillStyle = "#6e6250";
    c.fill();
    c.stroke();
    fade(c, w, h, R, 1.3);
    grime(c, w, h, 1.2, 1912);
  };
}

/** Stencil: a cut power cord sparking and a cracked triangle (black spray, transparent bg). */
export function stencilCord(): Draw {
  return (c, w, h) => {
    const R = rng(13);
    const ink = "#121010";
    // Cracked triangle.
    c.save();
    c.strokeStyle = ink;
    c.lineWidth = w * 0.035;
    c.lineJoin = "miter";
    c.beginPath();
    c.moveTo(w * 0.5, h * 0.05);
    c.lineTo(w * 0.92, h * 0.62);
    c.lineTo(w * 0.08, h * 0.62);
    c.closePath();
    c.stroke();
    c.globalCompositeOperation = "destination-out";
    c.lineWidth = w * 0.02;
    c.beginPath();
    c.moveTo(w * 0.5, h * 0.03);
    c.lineTo(w * 0.47, h * 0.18);
    c.lineTo(w * 0.53, h * 0.28);
    c.lineTo(w * 0.46, h * 0.42);
    c.lineTo(w * 0.52, h * 0.52);
    c.lineTo(w * 0.48, h * 0.66);
    c.stroke();
    c.restore();
    // The cord: from the left, cut in the middle, plug end on the right.
    c.save();
    c.strokeStyle = ink;
    c.lineWidth = w * 0.03;
    c.lineCap = "butt";
    c.beginPath();
    c.moveTo(w * 0.02, h * 0.92);
    c.bezierCurveTo(w * 0.2, h * 0.7, w * 0.3, h * 0.98, w * 0.42, h * 0.8);
    c.moveTo(w * 0.54, h * 0.82);
    c.bezierCurveTo(w * 0.66, h * 0.7, w * 0.72, h * 0.95, w * 0.82, h * 0.86);
    c.stroke();
    c.fillStyle = ink;
    c.fillRect(w * 0.82, h * 0.82, w * 0.09, h * 0.08);
    c.fillRect(w * 0.91, h * 0.835, w * 0.05, h * 0.015);
    c.fillRect(w * 0.91, h * 0.865, w * 0.05, h * 0.015);
    // Sparks at the cut.
    c.lineWidth = w * 0.01;
    for (let i = 0; i < 9; i++) {
      const a = R() * Math.PI * 2,
        r0 = w * 0.03,
        r1 = w * (0.06 + R() * 0.05);
      c.beginPath();
      c.moveTo(w * 0.48 + Math.cos(a) * r0, h * 0.81 + Math.sin(a) * r0);
      c.lineTo(w * 0.48 + Math.cos(a) * r1, h * 0.81 + Math.sin(a) * r1);
      c.stroke();
    }
    // Overspray.
    for (let i = 0; i < 500; i++) {
      c.globalAlpha = R() * 0.25;
      c.fillRect(R() * w, R() * h, 2, 2);
    }
    c.restore();
  };
}

// ─────────────────────────────── notices, plates, cards ───────────────────────────────

/** Faded 2036 public notice (header, body, date, a stamp). */
export function publicNotice(): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(2036);
      c.fillStyle = "#d9d3c1";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#3f5f78";
      c.fillRect(w * 0.05, h * 0.05, w * 0.9, h * 0.22);
      text(c, SIGNS.notice.jp, w * 0.3, h * 0.16, w * 0.4, h * 0.15, JP_FONT, "#f1ece0");
      text(c, SIGNS.notice.en, w * 0.7, h * 0.16, w * 0.38, h * 0.08, EN_FONT, "#e0e6ea");
      const [jp1, jp2] = SIGNS.noticeBody.jp.split("：");
      text(c, jp1, w / 2, h * 0.37, w * 0.88, h * 0.085, JP_FONT, "#262321");
      text(c, jp2, w / 2, h * 0.49, w * 0.88, h * 0.085, JP_FONT, "#7e1d18");
      const [en1, en2] = SIGNS.noticeBody.en.split(": ");
      text(c, en1, w / 2, h * 0.6, w * 0.88, h * 0.05, EN_FONT, "#33302c");
      text(c, en2, w / 2, h * 0.67, w * 0.88, h * 0.05, EN_FONT, "#7e1d18");
      c.fillStyle = "rgba(40,36,32,0.55)";
      for (let y = h * 0.74; y < h * 0.86; y += h * 0.03) c.fillRect(w * 0.08, y, w * (0.5 + R() * 0.3), h * 0.01);
      text(c, "2036.04.01  ·  NOZOMI CITY", w * 0.36, h * 0.92, w * 0.6, h * 0.045, EN_FONT, "#4a4640", 500);
      drawTriangleMark(c, w * 0.85, h * 0.86, h * 0.16, "rgba(150,40,30,0.7)");
      fade(c, w, h, R, 2.2);
    },
    2036,
    { corner: 1, size: 0.12, grime: 1.3 },
  );
}

/** The bed rows of the Tamashi billboard (shared by the paint and the glow overlay). */
function billboardScreens(w: number, h: number) {
  const out: { x: number; y: number; s: number }[] = [];
  const rows = [
    { y: 0.5, n: 7, s: 0.034 },
    { y: 0.67, n: 6, s: 0.042 },
    { y: 0.86, n: 5, s: 0.052 },
  ];
  for (const r of rows) for (let i = 0; i < r.n; i++) out.push({ x: w * (0.08 + (i + 0.5) * (0.86 / r.n)), y: h * r.y, s: w * r.s });
  return out;
}
/** The intact part of the billboard (everything right of a ragged diagonal is torn away). */
function billboardIntact(c: Ctx, w: number, h: number) {
  const R = rng(95);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(w * 0.66, 0);
  const n = 16;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    c.lineTo(w * (0.66 - 0.2 * t) + (R() - 0.5) * w * 0.07, h * t);
  }
  c.lineTo(w * 0.47, h);
  c.lineTo(0, h);
  c.closePath();
}

/** Tamashi billboard paint: rows of CRT heads on beds; the right side torn to bare board. */
export function billboard(): Draw {
  return (c, w, h) => {
    const R = rng(10);
    // Bare weathered board + old poster remnants (torn region).
    c.fillStyle = "#6a655b";
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w / 8) {
      c.fillStyle = "rgba(20,18,16,0.5)";
      c.fillRect(x, 0, 3, h);
    }
    c.fillStyle = "#b9b09c";
    for (let i = 0; i < 12; i++) c.fillRect(w * (0.55 + R() * 0.42), h * R(), w * (0.02 + R() * 0.06), h * (0.04 + R() * 0.12));
    grime(c, w, h, 1.4, 11);
    c.save();
    billboardIntact(c, w, h);
    c.clip();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#152040");
    g.addColorStop(1, "#28385e");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (const s of billboardScreens(w, h)) {
      // Bed, pillow, blanket, head.
      c.fillStyle = "#d9dce0";
      c.fillRect(s.x - s.s * 1.1, s.y - s.s * 0.3, s.s * 2.2, s.s * 1.4);
      c.fillStyle = "#9fb7cf";
      c.fillRect(s.x - s.s * 1.1, s.y + s.s * 0.35, s.s * 2.2, s.s * 0.75);
      c.fillStyle = "#c9b58e";
      c.fillRect(s.x - s.s * 0.5, s.y - s.s * 0.9, s.s, s.s * 0.8);
      c.fillStyle = "#1d2a33";
      c.fillRect(s.x - s.s * 0.38, s.y - s.s * 0.8, s.s * 0.76, s.s * 0.58);
    }
    text(c, SIGNS.tamashiAd.jp, w * 0.4, h * 0.14, w * 0.74, h * 0.17, JP_FONT, "#f2f4f8");
    text(c, SIGNS.tamashiAd.en, w * 0.36, h * 0.3, w * 0.62, h * 0.08, EN_FONT, "#9fd8ff");
    drawTriangleMark(c, w * 0.06, h * 0.12, h * 0.12, "#e8ecf2");
    fade(c, w, h, R, 0.9);
    grime(c, w, h, 0.9, 12);
    c.restore();
    // Paper edge along the tear.
    c.save();
    billboardIntact(c, w, h);
    c.strokeStyle = "#d8d2c4";
    c.lineWidth = 4;
    c.stroke();
    c.restore();
  };
}

/** The billboard's glowing screens only (lit overlay, transparent elsewhere). */
export function billboardGlow(): Draw {
  return (c, w, h) => {
    const R = rng(12);
    c.save();
    billboardIntact(c, w, h);
    c.clip();
    for (const s of billboardScreens(w, h)) {
      if (R() < 0.12) continue; // a few dead pixels in the ad
      c.fillStyle = "#59d6ff";
      c.fillRect(s.x - s.s * 0.34, s.y - s.s * 0.76, s.s * 0.68, s.s * 0.5);
      c.fillStyle = "#e8fbff";
      c.fillRect(s.x - s.s * 0.15, s.y - s.s * 0.66, s.s * 0.06, s.s * 0.28);
      c.fillRect(s.x + s.s * 0.09, s.y - s.s * 0.66, s.s * 0.06, s.s * 0.28);
    }
    text(c, SIGNS.tamashiAd.en, w * 0.36, h * 0.3, w * 0.62, h * 0.08, EN_FONT, "#9fd8ff");
    c.restore();
  };
}

/** A hanging torn flap of the billboard poster. */
export function billboardFlap(): Draw {
  return torn(
    (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#1b2747");
      g.addColorStop(1, "#2b3a5e");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#d4d7dc";
      c.fillRect(w * 0.1, h * 0.55, w * 0.5, h * 0.2);
      grime(c, w, h, 1.2, 14);
    },
    15,
    { corner: 2, size: 0.5, edge: 10 },
  );
}

/** Sun-bleached festival banner: cloth, frayed. */
export function festivalBanner(): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(14);
      c.fillStyle = "#e3d8c0";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#c98b74";
      c.fillRect(0, 0, w, h * 0.1);
      c.fillRect(0, h * 0.9, w, h * 0.1);
      text(c, SIGNS.festival.jp, w * 0.3, h * 0.52, w * 0.42, h * 0.62, JP_FONT, "#b8574a");
      text(c, SIGNS.festival.en, w * 0.72, h * 0.52, w * 0.42, h * 0.34, EN_FONT, "#5f6f8f");
      fade(c, w, h, R, 3);
      for (let x = w * 0.02; x < w; x += w * 0.1) {
        c.fillStyle = "#7d7666";
        c.beginPath();
        c.arc(x, h * 0.05, h * 0.03, 0, Math.PI * 2);
        c.fill();
      }
    },
    16,
    { edge: 7, grime: 0.9 },
  );
}

export function streetPlate(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#24528a";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e8eef3";
    c.lineWidth = 5;
    c.strokeRect(7, 7, w - 14, h - 14);
    text(c, SIGNS.streetName.jp, w / 2, h * 0.4, w * 0.8, h * 0.44, JP_FONT, "#f2f5f7");
    text(c, SIGNS.streetName.en, w / 2, h * 0.76, w * 0.7, h * 0.2, EN_FONT, "#dbe6ef");
    grime(c, w, h, 0.9, 61);
  };
}

/** Vending machine display window: dummy products and rows of lit red SOLD OUT buttons. */
export function vendingWindow(seed: number): Draw {
  return (c, w, h) => {
    const R = rng(seed);
    c.fillStyle = "#26292b";
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#f2f8ff");
    g.addColorStop(1, "#bcd4ec");
    c.fillStyle = g;
    c.fillRect(w * 0.05, h * 0.04, w * 0.9, h * 0.92);
    const rows = 3,
      cols = 6;
    const pal = ["#8a5a3a", "#3d6f9e", "#c9b34a", "#4d8a5a", "#a84a3e", "#e2e2e2", "#2b2b2b", "#d0742f"];
    for (let r = 0; r < rows; r++) {
      const y0 = h * (0.06 + r * 0.31);
      c.fillStyle = "#9fb3c6";
      c.fillRect(w * 0.06, y0 + h * 0.2, w * 0.88, h * 0.012);
      for (let k = 0; k < cols; k++) {
        const x = w * (0.08 + k * 0.145);
        c.fillStyle = pal[Math.floor(R() * pal.length)];
        const bw = w * 0.1,
          bh = h * (0.15 + R() * 0.04);
        c.fillRect(x + w * 0.012, y0 + h * 0.2 - bh, bw, bh);
        c.fillStyle = "rgba(255,255,255,0.35)";
        c.fillRect(x + w * 0.025, y0 + h * 0.2 - bh + 3, bw * 0.2, bh - 6);
        // SOLD OUT button.
        c.fillStyle = "#ff2a24";
        c.fillRect(x + w * 0.004, y0 + h * 0.225, w * 0.13, h * 0.055);
        fitFont(c, SIGNS.soldOut.jp, w * 0.12, h * 0.045, JP_FONT, 900);
        c.fillStyle = "#fff4ea";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(SIGNS.soldOut.jp, x + w * 0.069, y0 + h * 0.253);
      }
    }
    grime(c, w, h, 0.7, seed);
  };
}

/** Vending machine lower panel: coin slot, bill slot, dispenser flap, in the body colour. */
export function vendingPanel(body: string, seed: number): Draw {
  return (c, w, h) => {
    c.fillStyle = body;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#1a1b1c";
    c.fillRect(w * 0.62, h * 0.1, w * 0.26, h * 0.3);
    c.fillStyle = "#5a0d0b";
    c.fillRect(w * 0.65, h * 0.13, w * 0.2, h * 0.08);
    c.fillStyle = "#c8c8c0";
    c.fillRect(w * 0.7, h * 0.26, w * 0.1, h * 0.03);
    c.fillRect(w * 0.12, h * 0.12, w * 0.36, h * 0.05);
    text(c, SIGNS.soldOut.en, w * 0.3, h * 0.3, w * 0.4, h * 0.07, EN_FONT, "#7a1c18");
    c.fillStyle = "#121314";
    c.fillRect(w * 0.08, h * 0.55, w * 0.84, h * 0.34);
    c.fillStyle = "#2c2f31";
    c.fillRect(w * 0.1, h * 0.57, w * 0.8, h * 0.06);
    grime(c, w, h, 1.4, seed);
  };
}

/** Stonks's hand-lettered cardboard BUYING card. */
export function buyingCard(): Draw {
  return (c, w, h) => {
    const R = rng(35);
    c.fillStyle = "#b08a5c";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(90,60,30,0.25)";
    for (let i = 0; i < 30; i++) c.fillRect(0, R() * h, w, 1);
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-0.04);
    text(c, SIGNS.buying.jp, -w * 0.24, -h * 0.02, w * 0.42, h * 0.6, JP_FONT, "#151210", 900);
    text(c, SIGNS.buying.en, w * 0.23, -h * 0.1, w * 0.44, h * 0.28, EN_FONT, "#151210");
    text(c, SIGNS.topPrices.en, w * 0.23, h * 0.2, w * 0.44, h * 0.12, EN_FONT, "#8a1712");
    c.restore();
    // Tape at the top corners.
    c.fillStyle = "rgba(230,225,200,0.75)";
    c.fillRect(w * 0.02, 0, w * 0.12, h * 0.12);
    c.fillRect(w * 0.86, 0, w * 0.12, h * 0.12);
    grime(c, w, h, 0.6, 35);
  };
}

export function topPricesCard(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#efe9d6";
    c.fillRect(0, 0, w, h);
    text(c, SIGNS.topPrices.jp, w / 2, h * 0.4, w * 0.86, h * 0.5, JP_FONT, "#b0221a", 900);
    text(c, SIGNS.topPrices.en, w / 2, h * 0.8, w * 0.8, h * 0.2, EN_FONT, "#1a1714");
    grime(c, w, h, 0.5, 36);
  };
}

export function hydrantPlate(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#b62a22";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#f1e9e2";
    c.lineWidth = 4;
    c.strokeRect(6, 6, w - 12, h - 12);
    text(c, SIGNS.hydrant.jp, w / 2, h * 0.42, w * 0.8, h * 0.4, JP_FONT, "#f8f1ea");
    text(c, SIGNS.hydrant.en, w / 2, h * 0.77, w * 0.75, h * 0.18, EN_FONT, "#f8f1ea");
    grime(c, w, h, 1.1, 37);
  };
}

export function staffOnlyPlate(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#e8e4da";
    c.fillRect(0, 0, w, h);
    text(c, SIGNS.staffOnly.jp, w / 2, h * 0.38, w * 0.9, h * 0.42, JP_FONT, "#a3211b");
    text(c, SIGNS.staffOnly.en, w / 2, h * 0.78, w * 0.6, h * 0.24, EN_FONT, "#1d1b19");
    grime(c, w, h, 1, 38);
  };
}

/** A noren curtain: indigo cloth in three panels with slits, a pale wave line. */
export function noren(): Draw {
  return (c, w, h) => {
    const R = rng(39);
    c.fillStyle = "#1f2d4a";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#cfd6dd";
    c.lineWidth = 5;
    c.beginPath();
    for (let x = 0; x <= w; x += 4) c.lineTo(x, h * 0.72 + Math.sin(x * 0.07) * h * 0.04);
    c.stroke();
    c.beginPath();
    c.arc(w / 2, h * 0.38, h * 0.14, 0, Math.PI * 2);
    c.stroke();
    fade(c, w, h, R, 0.8);
    grime(c, w, h, 1, 39);
    c.save();
    c.globalCompositeOperation = "destination-out";
    for (const t of [1 / 3, 2 / 3]) c.fillRect(w * t - 2, h * 0.18, 4, h);
    c.restore();
  };
}

export function keepOutBoard(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#e9c21f";
    c.fillRect(0, 0, w, h);
    c.save();
    c.beginPath();
    c.rect(0, 0, w, h);
    c.rect(h * 0.14, h * 0.14, w - h * 0.28, h * 0.72);
    c.clip("evenodd");
    c.fillStyle = "#141210";
    for (let x = -h; x < w + h; x += h * 0.3) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + h * 0.15, 0);
      c.lineTo(x + h * 0.15 - h, h);
      c.lineTo(x - h, h);
      c.closePath();
      c.fill();
    }
    c.restore();
    text(c, SIGNS.keepOut.jp, w / 2, h * 0.42, w * 0.7, h * 0.4, JP_FONT, "#141210", 900);
    text(c, SIGNS.keepOut.en, w / 2, h * 0.72, w * 0.6, h * 0.17, EN_FONT, "#141210");
    grime(c, w, h, 1.3, 40);
  };
}

export function keepOutTape(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#e7c42a";
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w / 4) {
      text(c, SIGNS.keepOut.jp, x + w * 0.08, h / 2, w * 0.12, h * 0.7, JP_FONT, "#171411", 900);
      text(c, SIGNS.keepOut.en, x + w * 0.18, h / 2, w * 0.08, h * 0.5, EN_FONT, "#171411");
    }
    grime(c, w, h, 0.8, 41);
  };
}

/** Vine's dent: a dark shallow crater with cracks radiating (transparent decal). */
export function dentCracks(): Draw {
  return (c, w, h) => {
    const R = rng(25);
    const cx = w / 2,
      cy = h / 2;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, w * 0.2);
    g.addColorStop(0, "rgba(10,9,8,0.85)");
    g.addColorStop(0.6, "rgba(25,22,20,0.55)");
    g.addColorStop(1, "rgba(25,22,20,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(14,12,10,0.75)";
    c.lineCap = "round";
    for (let i = 0; i < 13; i++) {
      let a = (i / 13) * Math.PI * 2 + R() * 0.3;
      let x = cx + Math.cos(a) * w * 0.07,
        y = cy + Math.sin(a) * w * 0.07;
      const lw = 1.2 + R() * 1.6;
      c.beginPath();
      c.moveTo(x, y);
      const len = w * (0.25 + R() * 0.22);
      for (let d = 0; d < len; d += 10) {
        a += (R() - 0.5) * 0.5;
        x += Math.cos(a) * 10;
        y += Math.sin(a) * 10;
        c.lineTo(x, y);
        if (R() < 0.15) {
          // Branch.
          c.moveTo(x, y);
          c.lineTo(x + Math.cos(a + 0.8) * 22, y + Math.sin(a + 0.8) * 22);
          c.moveTo(x, y);
        }
      }
      c.lineWidth = lw;
      c.stroke();
    }
    // A broken ring around the impact.
    c.lineWidth = 3;
    c.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const r = w * (0.13 + R() * 0.02);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.closePath();
    c.stroke();
  };
}

/** Cracked brick around Itamae's knife (transparent decal). */
export function brickCrack(): Draw {
  return (c, w, h) => {
    const R = rng(79);
    c.strokeStyle = "rgba(20,14,12,0.9)";
    c.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      let a = R() * Math.PI * 2,
        x = w / 2,
        y = h / 2;
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        a += (R() - 0.5) * 0.7;
        x += Math.cos(a) * w * 0.08;
        y += Math.sin(a) * h * 0.08;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    c.fillStyle = "rgba(15,10,9,0.8)";
    c.fillRect(w * 0.4, h * 0.46, w * 0.2, h * 0.08);
  };
}

/** Tiny NOZOMI SOUP can label (for the cans on Stonks's table). */
export function soupLabel(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#ea6a1f";
    c.fillRect(0, 0, w, h * 0.5);
    c.fillStyle = "#151112";
    c.fillRect(0, h * 0.5, w, h * 0.5);
    text(c, SIGNS.soup.jp, w / 2, h * 0.27, w * 0.9, h * 0.34, JP_FONT, "#151112");
    text(c, SIGNS.soup.en, w / 2, h * 0.74, w * 0.9, h * 0.26, EN_FONT, "#ea6a1f");
  };
}

/** A soft round gradient (glow pools, puddle feathering). */
export function radial(stops: [number, string][]): Draw {
  return (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [t, col] of stops) g.addColorStop(t, col);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };
}

/** Standby CRT screen: scanlines, a soft centre, a vignette (tinted per instance). */
export function crtStandby(): Draw {
  return (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.7, "#9a9a9a");
    g.addColorStop(1, "#202020");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
    // Two vertical-line eyes (asleep: short and dim).
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.fillRect(w * 0.34, h * 0.46, w * 0.06, h * 0.1);
    c.fillRect(w * 0.6, h * 0.46, w * 0.06, h * 0.1);
  };
}

// ─────────────────────────────── back-street density ───────────────────────────────

/** Vertical (tategaki) lantern lettering: black characters, transparent background. */
export function lanternText(): Draw {
  return (c, w, h) => {
    const chars = [...SIGNS.izakaya.jp];
    const step = h / (chars.length + 0.4);
    for (let i = 0; i < chars.length; i++) text(c, chars[i], w / 2, step * (i + 0.7), w * 0.9, step * 0.86, JP_FONT, "#16100c", 900);
  };
}

/** Izakaya noren: dark indigo cloth, white lettering, three panels. */
export function izakayaNoren(): Draw {
  return (c, w, h) => {
    const R = rng(51);
    c.fillStyle = "#23283a";
    c.fillRect(0, 0, w, h);
    text(c, SIGNS.izakaya.jp, w / 2, h * 0.45, w * 0.8, h * 0.5, JP_FONT, "#ece6d8", 900);
    text(c, SIGNS.izakaya.en, w / 2, h * 0.82, w * 0.4, h * 0.13, EN_FONT, "#c9c2b2");
    fade(c, w, h, R, 0.7);
    grime(c, w, h, 1.1, 51);
    c.save();
    c.globalCompositeOperation = "destination-out";
    for (const t of [1 / 3, 2 / 3]) c.fillRect(w * t - 2, h * 0.2, 4, h);
    c.restore();
  };
}

/** Hand-painted TV REPAIR board, peeling. */
export function repairBoard(): Draw {
  return torn(
    (c, w, h) => {
      const R = rng(52);
      c.fillStyle = "#d8cfb5";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#2f5f6f";
      c.fillRect(0, 0, w * 0.2, h);
      // A little CRT icon.
      c.fillStyle = "#e8e2cc";
      c.fillRect(w * 0.04, h * 0.3, w * 0.12, h * 0.42);
      c.fillStyle = "#2f5f6f";
      c.fillRect(w * 0.055, h * 0.36, w * 0.09, h * 0.28);
      c.strokeStyle = "#e8e2cc";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.3);
      c.lineTo(w * 0.07, h * 0.12);
      c.moveTo(w * 0.1, h * 0.3);
      c.lineTo(w * 0.14, h * 0.12);
      c.stroke();
      text(c, SIGNS.repair.jp, w * 0.6, h * 0.4, w * 0.74, h * 0.48, JP_FONT, "#a3281e", 900);
      text(c, SIGNS.repair.en, w * 0.6, h * 0.8, w * 0.6, h * 0.22, EN_FONT, "#1d1a17");
      fade(c, w, h, R, 1.6);
    },
    52,
    { corner: 2, size: 0.12, grime: 1.3 },
  );
}

export function cctvPlate(): Draw {
  return (c, w, h) => {
    c.fillStyle = "#f0d22a";
    c.fillRect(0, 0, w, h);
    text(c, SIGNS.surveillance.jp, w / 2, h * 0.38, w * 0.9, h * 0.42, JP_FONT, "#141210", 900);
    text(c, SIGNS.surveillance.en, w / 2, h * 0.78, w * 0.8, h * 0.22, EN_FONT, "#141210");
    drawTriangleMark(c, w * 0.93, h * 0.2, h * 0.26, "#141210");
    grime(c, w, h, 1.2, 53);
  };
}

/** Plastic crate side: a frame with a grid of holes (alpha), tinted per instance. */
export function crateLattice(): Draw {
  return (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = "destination-out";
    const cols = 4,
      rows = 2;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) c.fillRect(w * (0.1 + i * 0.21), h * (0.3 + j * 0.3), w * 0.15, h * 0.2);
    c.globalCompositeOperation = "source-over";
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.fillRect(0, h * 0.85, w, h * 0.15);
  };
}

/** One page of the public-notice screen (cycled by StreetProps). */
export function noticeScreenPage(c: Ctx, w: number, h: number, page: number) {
  c.fillStyle = "#04110d";
  c.fillRect(0, 0, w, h);
  const green = "#6dffc0",
    amber = "#ffb347";
  c.shadowBlur = 8;
  switch (page % 4) {
    case 0:
      c.shadowColor = amber;
      text(c, SIGNS.notice.jp + "  " + SIGNS.notice.en, w / 2, h * 0.16, w * 0.9, h * 0.14, JP_FONT, amber);
      text(c, SIGNS.noticeBody.jp.split("：")[0], w / 2, h * 0.42, w * 0.92, h * 0.13, JP_FONT, green);
      text(c, SIGNS.noticeBody.jp.split("：")[1], w / 2, h * 0.6, w * 0.92, h * 0.13, JP_FONT, "#ff6b5a");
      text(c, SIGNS.noticeBody.en, w / 2, h * 0.8, w * 0.94, h * 0.07, EN_FONT, green);
      break;
    case 1:
      c.shadowColor = green;
      drawTriangleMark(c, w * 0.2, h * 0.5, h * 0.55, green);
      text(c, SIGNS.triangleCo.jp, w * 0.62, h * 0.38, w * 0.6, h * 0.2, JP_FONT, green);
      text(c, SIGNS.triangleCo.en, w * 0.62, h * 0.64, w * 0.5, h * 0.13, EN_FONT, green);
      break;
    case 2:
      c.shadowColor = "#ff6b5a";
      text(c, SIGNS.selfNavOff.jp, w / 2, h * 0.24, w * 0.9, h * 0.2, JP_FONT, "#ff6b5a");
      text(c, SIGNS.selfNavOff.en, w / 2, h * 0.42, w * 0.9, h * 0.09, EN_FONT, "#ff6b5a");
      text(c, SIGNS.manualBanned.jp, w / 2, h * 0.64, w * 0.9, h * 0.2, JP_FONT, amber);
      text(c, SIGNS.manualBanned.en, w / 2, h * 0.82, w * 0.9, h * 0.09, EN_FONT, amber);
      break;
    default:
      c.shadowColor = green;
      text(c, SIGNS.surveillance.jp, w / 2, h * 0.3, w * 0.9, h * 0.2, JP_FONT, green);
      text(c, SIGNS.surveillance.en, w / 2, h * 0.52, w * 0.9, h * 0.1, EN_FONT, green);
      text(c, "2036 · NOZOMI", w / 2, h * 0.76, w * 0.6, h * 0.09, EN_FONT, amber, 500);
  }
  c.shadowBlur = 0;
  // Scanlines, a dead row of pixels and burn-in.
  c.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  c.fillStyle = "rgba(0,0,0,0.9)";
  c.fillRect(0, h * 0.71, w, 3);
  c.fillRect(w * 0.83, 0, 4, h);
}
