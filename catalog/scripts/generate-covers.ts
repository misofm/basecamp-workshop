// Procedural cover art for every release in catalog.json.
// Output: catalog/out/covers/<release>.webp (1600x1600) and .png (for the game/SPA fallbacks).
//
//   bun catalog/scripts/generate-covers.ts

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const catalog = await Bun.file(join(root, "catalog.json")).json();
const parties = await Bun.file(join(root, "../parties/parties.json")).json().catch(() => ({ parties: [] }));
const S = 1600;

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

type Motif = (p: string[], r: () => number) => string;
const motifs: Record<string, Motif> = {
  // stacked tide lines with a low sun
  "low-tide-tapes": (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/><circle cx="${S * 0.68}" cy="${S * 0.46}" r="230" fill="${p[3]}"/>`;
    for (let i = 0; i < 14; i++) {
      const y = 760 + i * 62, a = 18 + r() * 22, f = 0.004 + r() * 0.004;
      let d = `M0 ${y}`;
      for (let x = 0; x <= S; x += 40) d += ` L${x} ${y + Math.sin(x * f + i) * a}`;
      s += `<path d="${d} L${S} ${S} L0 ${S}Z" fill="${i % 2 ? p[1] : p[0]}" opacity="${0.55 + i * 0.03}"/>`;
    }
    return s;
  },
  // perspective grid and striped sun
  "night-drive-atlas": (p) => {
    let s = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="#3a0ca3"/></linearGradient>
      <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="${p[1]}"/></linearGradient></defs>
      <rect width="${S}" height="${S}" fill="url(#sky)"/><circle cx="800" cy="820" r="380" fill="url(#sun)"/>`;
    for (let i = 0; i < 7; i++) s += `<rect x="380" y="${700 + i * 42}" width="840" height="${6 + i * 3}" fill="#3a0ca3"/>`;
    s += `<rect y="900" width="${S}" height="700" fill="${p[0]}"/>`;
    for (let i = 0; i < 16; i++) { const y = 900 + Math.pow(i / 15, 2) * 700; s += `<line x1="0" y1="${y}" x2="${S}" y2="${y}" stroke="${p[2]}" stroke-width="3"/>`; }
    for (let i = -12; i <= 12; i++) s += `<line x1="${800 + i * 30}" y1="900" x2="${800 + i * 260}" y2="${S}" stroke="${p[2]}" stroke-width="3"/>`;
    return s;
  },
  // woodcut flames
  kindling: (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[2]}"/>`;
    for (let i = 0; i < 9; i++) {
      const x = 300 + i * 125 + r() * 40, h = 380 + r() * 420;
      s += `<path d="M${x - 90} 1200 C${x - 120} ${1200 - h * 0.5} ${x + 40} ${1200 - h * 0.7} ${x} ${1200 - h} C${x + 60} ${1200 - h * 0.6} ${x + 140} ${1200 - h * 0.4} ${x + 90} 1200Z" fill="${i % 2 ? p[1] : p[0]}" opacity="0.9"/>`;
    }
    for (let i = 0; i < 3; i++) s += `<rect x="${380 + i * 40}" y="${1200 + i * 60}" width="${840 - i * 80}" height="44" rx="22" fill="${p[0]}" transform="rotate(${i % 2 ? 4 : -4} 800 ${1220 + i * 60})"/>`;
    return s;
  },
  // concentric city lights and bold bands
  "lagos-after-dark": (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/>`;
    for (let i = 12; i > 0; i--) s += `<circle cx="800" cy="800" r="${i * 62}" fill="none" stroke="${[p[1], p[2], p[3]][i % 3]}" stroke-width="${18 + (i % 3) * 8}"/>`;
    for (let i = 0; i < 160; i++) s += `<circle cx="${r() * S}" cy="${r() * S}" r="${2 + r() * 5}" fill="${p[1]}" opacity="${0.3 + r() * 0.6}"/>`;
    return s;
  },
  // piano keys at an angle under a blue wash
  "blue-hours": (p) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/><g transform="rotate(-18 800 800)">`;
    for (let i = 0; i < 26; i++) s += `<rect x="${-200 + i * 80}" y="500" width="74" height="700" fill="${p[2]}" opacity="0.92"/>`;
    for (let i = 0; i < 26; i++) if (![2, 6, 9, 13, 16, 20, 23].includes(i)) s += `<rect x="${-150 + i * 80}" y="500" width="46" height="420" fill="${p[0]}"/>`;
    return s + `</g><rect width="${S}" height="${S}" fill="${p[1]}" opacity="0.35"/><circle cx="1240" cy="330" r="120" fill="${p[3]}"/>`;
  },
  // topographic contour lines
  "field-notes": (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/>`;
    const cx = 700 + r() * 200, cy = 750 + r() * 100;
    for (let i = 1; i < 26; i++) {
      let d = "";
      for (let a = 0; a <= 360; a += 6) {
        const t = (a * Math.PI) / 180, rad = i * 34 + Math.sin(t * 3 + i * 0.4) * 22 + Math.cos(t * 5) * 12;
        d += `${a ? "L" : "M"}${cx + Math.cos(t) * rad} ${cy + Math.sin(t) * rad}`;
      }
      s += `<path d="${d}Z" fill="none" stroke="${i % 5 ? p[1] : p[2]}" stroke-width="${i % 5 ? 3 : 6}"/>`;
    }
    return s;
  },
  // pastel sunset bands with a palm silhouette
  "summer-static": (p) => {
    let s = "";
    const bands = [p[0], p[1], "#ffd6a5", p[3], "#ff9b85"];
    bands.forEach((c, i) => (s += `<rect y="${i * 230}" width="${S}" height="${S - i * 230}" fill="${c}"/>`));
    s += `<circle cx="800" cy="1010" r="300" fill="#fff4e0"/><rect y="1100" width="${S}" height="500" fill="${p[2]}"/>`;
    for (let i = 0; i < 9; i++) s += `<rect x="${200 + i * 40}" y="${1180 + i * 40}" width="${1200 - i * 80}" height="10" fill="#fff4e0" opacity="0.7"/>`;
    s += `<path d="M1180 1100 C1170 900 1200 700 1230 560" stroke="#1b1b3a" stroke-width="26" fill="none"/>`;
    for (let i = 0; i < 6; i++) s += `<path d="M1230 560 Q${1230 + Math.cos(i) * 260} ${470 + Math.sin(i * 1.7) * 90} ${1230 + Math.cos(i) * 360} ${640 + i * 18}" stroke="#1b1b3a" stroke-width="22" fill="none"/>`;
    return s;
  },
  // subway map lines
  "third-rail": (p) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/>`;
    const lines = [
      { c: p[1], d: "M-50 400 H600 L1000 800 H1650" },
      { c: p[2], d: "M300 -50 V700 L700 1100 V1650" },
      { c: p[3], d: "M-50 1200 H500 L900 800 V-50" },
      { c: "#ffffff", d: "M1650 1300 H1100 L800 1000 H-50" },
    ];
    for (const l of lines) s += `<path d="${l.d}" stroke="${l.c}" stroke-width="56" fill="none" stroke-linejoin="round"/>`;
    for (const [x, y] of [[600, 400], [300, 700], [800, 1000], [900, 800], [1000, 800], [500, 1200]]) s += `<circle cx="${x}" cy="${y}" r="44" fill="${p[0]}" stroke="#fff" stroke-width="16"/>`;
    return s;
  },
  // halftone sunburst
  "sun-bleached": (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[3]}"/>`;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 0.5) / 24) * Math.PI * 2;
      s += `<path d="M800 900 L${800 + Math.cos(a0) * 1400} ${900 + Math.sin(a0) * 1400} L${800 + Math.cos(a1) * 1400} ${900 + Math.sin(a1) * 1400}Z" fill="${p[1]}" opacity="0.55"/>`;
    }
    s += `<circle cx="800" cy="900" r="300" fill="${p[2]}"/>`;
    for (let y = 1100; y < S; y += 36) for (let x = 0; x < S; x += 36) s += `<circle cx="${x + (y % 72 ? 18 : 0)}" cy="${y}" r="${((y - 1100) / 500) * 16}" fill="${p[0]}"/>`;
    return s;
  },
  // stained-glass arches
  "warehouse-gospel": (p, r) => {
    let s = `<rect width="${S}" height="${S}" fill="${p[0]}"/>`;
    for (let i = 0; i < 5; i++) {
      const x = 160 + i * 270, c = [p[1], p[2], p[3], p[1], p[2]][i];
      s += `<path d="M${x} 1300 V600 A115 115 0 0 1 ${x + 230} 600 V1300Z" fill="${c}" opacity="${0.55 + r() * 0.4}"/>`;
      for (let j = 0; j < 4; j++) s += `<line x1="${x}" y1="${700 + j * 150}" x2="${x + 230}" y2="${700 + j * 150}" stroke="${p[0]}" stroke-width="14"/>`;
    }
    return s + `<rect y="1300" width="${S}" height="300" fill="#10002b"/>`;
  },
};

mkdirSync(join(root, "out", "covers"), { recursive: true });
for (const rel of catalog.releases) {
  const p = rel.palette;
  const artist = parties.parties.find((x: any) => x.slug === rel.artist)?.name ?? rel.artist;
  const art = (motifs[rel.slug] ?? motifs["field-notes"])(p, rng(rel.slug));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${art}
    <rect x="70" y="70" width="${S - 140}" height="150" fill="#000" opacity="0.55"/>
    <text x="110" y="135" font-family="DejaVu Sans" font-weight="bold" font-size="58" fill="#fff" letter-spacing="2">${esc(artist.toUpperCase())}</text>
    <text x="110" y="196" font-family="DejaVu Serif" font-style="italic" font-size="48" fill="#fff" opacity="0.9">${esc(rel.title)}</text>
  </svg>`;
  const out = join(root, "out", "covers", rel.slug);
  await sharp(Buffer.from(svg)).webp({ quality: 90 }).toFile(`${out}.webp`);
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(`${out}.png`);
  console.log(`cover ${rel.slug}`);
}
