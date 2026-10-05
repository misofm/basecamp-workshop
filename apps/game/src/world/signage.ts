/**
 * Signage: EVERY Japanese string in the level, and the sign atlas that draws them.
 *
 * Owns: the bilingual (Japanese / English) sign copy from the world bible §7.5 (all of it
 * a [P] proposal, listed in docs/SIGNAGE.md and awaiting native-speaker review), the sign
 * font stacks (a Japanese subset font served from /fonts, see docs/SIGNAGE.md), and SignAtlas:
 * many signs drawn into ONE canvas texture and merged into ONE mesh per module, so a
 * street full of signs costs a single draw call.
 * Must not: place signs (callers decide where) or hold Japanese text anywhere else:
 * other modules import the strings from here (scripts/subset-signage-font.sh builds the
 * font subset from this file).
 *
 * Content rules (bible §8): no real brands, logos, banks, chains or labels; no 組 or other
 * yakuza-coded naming; no Rising Sun motifs; the Triangle mark must not resemble a real
 * company's mark; no real artworks.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canvasTexture } from "./labels";

/** Japanese sign face: the bundled subset first, then whatever the system has. */
export const JP_FONT = '"Nozomi JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';
/** Latin sign face (bundled via Fontsource). */
export const EN_FONT = '"Space Grotesk", "DM Sans", system-ui, sans-serif';

export interface Bilingual {
  jp: string;
  en: string;
  /** Short note for the reviewer (meaning, register, where it hangs). */
  note: string;
}

/** The sign copy. Keys are referenced by the world modules; docs/SIGNAGE.md lists them all. */
export const SIGNS = {
  saisei: { jp: "再生レコード", en: "SAISEI RECORDS", note: "Shop name. 再生 = playback / rebirth. Neon over the shutter." },
  open: { jp: "営業中", en: "OPEN", note: "On the CRT in the shop window." },
  listen: { jp: "試聴", en: "LISTEN", note: "Over the listening bar (turntable)." },
  byGenre: { jp: "ジャンル別", en: "BY GENRE", note: "Over the record bins." },
  payHere: { jp: "お会計", en: "PAY HERE", note: "Hand-lettered card on the counter by the register (neutral; not 'cash only')." },
  concert: { jp: "のぞみ 初コンサート", en: "FIRST CONCERT OF NOZOMI", note: "Concert poster inside the shop; sub-line 'STADIUM ON THE HILL'." },
  stadium: { jp: "丘のスタジアム", en: "STADIUM ON THE HILL", note: "Sub-line of the concert poster." },
  trimart: { jp: "トライマート", en: "TRIMART", note: "Convenience store fascia (fictional chain of the Triangle Company)." },
  atm: { jp: "お引き出し", en: "WITHDRAWAL", note: "On the ATM header ('ATM · お引き出し')." },
  selfNavOff: { jp: "自動運転停止", en: "SELF-NAVIGATION DISABLED", note: "Window sticker on the dead sedan." },
  manualBanned: { jp: "手動運転禁止", en: "MANUAL DRIVING PROHIBITED", note: "Second window sticker on the dead sedan." },
  triangleCo: { jp: "トライアングル社", en: "TRIANGLE CO.", note: "Small corporate line under the Triangle mark (sedan, ATM, TriMart, billboard)." },
  notice: { jp: "公告", en: "PUBLIC NOTICE", note: "Header of the faded 2036 public notice board." },
  noticeBody: {
    jp: "ポイ捨て・徘徊・支払い延滞：タマシ接続の対象",
    en: "LITTERING · LOITERING · LATE PAYMENT: SUBJECT TO TAMASHI CONNECTION",
    note: "Body of the public notice (plug-in sentencing, canon 1.2). Dated 2036.",
  },
  tamashiAd: { jp: "タマシ — 魂を休めよう", en: "TAMASHI — REST YOUR SOUL", note: "Torn billboard (dystopian satire, not an endorsement)." },
  fitting: { jp: "タマシ装着センター", en: "TAMASHI FITTING CENTER", note: "Shuttered clinic fascia." },
  closed: { jp: "閉鎖", en: "CLOSED", note: "Paper sign on the fitting center's glass." },
  festival: { jp: "のぞみ祭", en: "NOZOMI FESTIVAL", note: "Sun-bleached banner across the street, among the festival bulbs." },
  nozomi: { jp: "ノゾミ", en: "NOZOMI", note: "Mural lettering in orange and black." },
  gang: { jp: "のぞみギャング — 我らが法", en: "WE ARE THE NOZOMI GANG — WE ARE THE LAW", note: "Old political poster, crossed out. Uses ギャング, not 組." },
  order: { jp: "秩序", en: "ORDER — A NEW AGE OF RULES AND PROSPERITY", note: "Order's poster on the poster wall." },
  chaos: { jp: "夜明けに集え", en: "MEET ME HERE AT DAWN", note: "Chaos's poster (red and black)." },
  casino: { jp: "カジノ", en: "CASINO", note: "Back-lit sign on the casino's back wall, half dead." },
  fireExit: { jp: "非常口", en: "FIRE EXIT", note: "Over the casino's fire door." },
  hydrant: { jp: "消火栓", en: "HYDRANT", note: "Plate by the dead hydrant." },
  diner: { jp: "ダイナー", en: "DINER", note: "Fascia under the 'EAT Here' neon arrow (English neon stays English)." },
  staffOnly: { jp: "関係者以外立入禁止", en: "STAFF ONLY", note: "Diner kitchen door in the alley." },
  buying: { jp: "買取", en: "BUYING", note: "Stonks's folding-table sign (records bought here)." },
  topPrices: { jp: "高価買取", en: "TOP PRICES PAID", note: "Second line / window card at Stonks's walk-up." },
  soldOut: { jp: "売切", en: "SOLD OUT", note: "Lit on every vending-machine button." },
  keepOut: { jp: "立入禁止", en: "KEEP OUT", note: "Tape and board on the west barricade." },
  hotel: { jp: "ホテル", en: "HOTEL", note: "The old hotel's vertical sign (Order's HQ)." },
  streetName: { jp: "灯り通り", en: "AKARI-DŌRI", note: "Street name plate (invented: 'Lantern Street'). The street sign with a box on top." },
  soup: { jp: "のぞみスープ", en: "NOZOMI SOUP", note: "Pop-art soup-can mural (never the real brand)." },
  izakaya: { jp: "居酒屋", en: "IZAKAYA", note: "Paper lanterns and noren of the tiny pub at the back of the diner alley (street-props)." },
  repair: { jp: "テレビ修理", en: "TV REPAIR", note: "Hand-painted board over the stacked CRTs on the south sidewalk (street-props)." },
  surveillance: { jp: "防犯カメラ作動中", en: "CCTV IN OPERATION", note: "Small plate under the dead surveillance cameras (street-props)." },
  // Vertical lightbox signs (tategaki) on the facades (city.ts). Invented small businesses.
  snackYunagi: { jp: "スナック夕凪", en: "SNACK YUNAGI", note: "Vertical lightbox: a tiny snack bar ('evening calm'). city.ts." },
  ramenAkari: { jp: "らーめん灯", en: "RAMEN AKARI", note: "Vertical lightbox: noodle shop ('lamp'). city.ts." },
  denkiRepair: { jp: "電器修理", en: "ELECTRICAL REPAIR", note: "Vertical lightbox: appliance repair shop. city.ts." },
  pawn: { jp: "質", en: "PAWN", note: "Vertical lightbox: pawn shop (single kanji), by Stonks's walk-up. city.ts." },
  karaoke: { jp: "カラオケ", en: "KARAOKE", note: "Vertical lightbox (dead). city.ts." },
  clinicNaika: { jp: "内科医院", en: "INTERNAL MEDICINE", note: "Vertical lightbox: a small GP clinic. city.ts." },
  barberMinato: { jp: "理容ミナト", en: "BARBER MINATO", note: "Vertical lightbox: barber shop (invented name). city.ts." },
  coinLaundry: { jp: "コインランドリー", en: "COIN LAUNDRY", note: "Vertical lightbox. city.ts." },
  kissaHotaru: { jp: "喫茶ほたる", en: "KISSA HOTARU", note: "Vertical lightbox: old coffee house ('firefly'). city.ts." },
  mahjong: { jp: "雀荘", en: "MAHJONG PARLOUR", note: "Vertical lightbox (dead), in the dark west rows. city.ts." },
} as const satisfies Record<string, Bilingual>;

export type SignKey = keyof typeof SIGNS;

/** Latin-only neon/lettering that is part of the art (no Japanese): listed for completeness. */
export const EN_ONLY = {
  eatHere: "EAT Here",
  fusd: "FakeUSD",
} as const;

// ─────────────────────────────── fonts ───────────────────────────────

// The Japanese subset font ("Nozomi JP", public/fonts/nozomi-jp-signs.woff2, Noto Sans JP
// Bold, SIL OFL) is registered and awaited in labels.ts, so every canvas sign repaints once
// it has loaded. scripts/subset-signage-font.sh rebuilds it from this file.

// ─────────────────────────────── drawing ───────────────────────────────

export type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;

/** Fit `text` into `maxWidth` at up to `size` px in `family`. Returns the size used. */
export function fitFont(c: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, family: string, weight = 700) {
  let s = size;
  c.font = `${weight} ${s}px ${family}`;
  while (s > 8 && c.measureText(text).width > maxWidth) {
    s -= 1;
    c.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

export interface BilingualStyle {
  bg?: string;
  ink: string;
  /** English line colour (default: ink). */
  inkEn?: string;
  border?: string;
  /** Share of the height for the Japanese line (default 0.58); the rest is English. */
  jpShare?: number;
  /** Lay the two lines side by side instead of stacked. */
  row?: boolean;
  /** Glow (canvas shadow blur, px) for neon-looking text. */
  glow?: number;
  /** Grime: 0..1 of dirt speckle and fading drawn over the sign. */
  grime?: number;
}

/** A bilingual sign face: Japanese large, English small under it (or beside it). */
export function drawBilingual(key: SignKey, style: BilingualStyle): Draw {
  const s = SIGNS[key];
  return (c, w, h) => {
    if (style.bg) {
      c.fillStyle = style.bg;
      c.fillRect(0, 0, w, h);
    }
    if (style.border) {
      c.strokeStyle = style.border;
      c.lineWidth = Math.max(2, h * 0.05);
      c.strokeRect(c.lineWidth, c.lineWidth, w - 2 * c.lineWidth, h - 2 * c.lineWidth);
    }
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = style.ink;
    c.shadowBlur = style.glow ?? 0;
    c.fillStyle = style.ink;
    if (style.row) {
      fitFont(c, s.jp, w * 0.5, h * 0.62, JP_FONT);
      c.fillText(s.jp, w * 0.28, h * 0.54);
      c.fillStyle = style.inkEn ?? style.ink;
      fitFont(c, s.en, w * 0.4, h * 0.36, EN_FONT);
      c.fillText(s.en, w * 0.74, h * 0.54);
    } else {
      const share = style.jpShare ?? 0.58;
      fitFont(c, s.jp, w * 0.88, h * share * 0.8, JP_FONT);
      c.fillText(s.jp, w / 2, h * share * 0.55);
      c.fillStyle = style.inkEn ?? style.ink;
      fitFont(c, s.en, w * 0.88, h * (1 - share) * 0.62, EN_FONT);
      c.fillText(s.en, w / 2, h * (share + (1 - share) * 0.45));
    }
    c.shadowBlur = 0;
    if (style.grime) grime(c, w, h, style.grime, key.length * 31 + w);
  };
}

/** Speckle, streaks and fading: seven years of dust over a sign. Deterministic per seed. */
export function grime(c: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 1) {
  let s = Math.floor(seed) % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  c.save();
  for (let i = 0; i < 160 * amount * (w * h) / 65536 + 20; i++) {
    c.fillStyle = `rgba(${30 + rand() * 30},${24 + rand() * 20},${18 + rand() * 14},${0.08 + rand() * 0.25 * amount})`;
    const r = 1 + rand() * 4;
    c.fillRect(rand() * w, rand() * h, r, r);
  }
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(20,14,10,${0.05 * amount})`);
  g.addColorStop(1, `rgba(20,14,10,${0.35 * amount})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/**
 * The Triangle Company mark: a hollow equilateral triangle with a small solid circle near
 * its base (an invented mark; deliberately not any real company's logo).
 */
export function drawTriangleMark(c: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = size * 0.11;
  c.lineJoin = "round";
  const r = size / 2;
  c.beginPath();
  c.moveTo(cx, cy - r);
  c.lineTo(cx + r * 0.9, cy + r * 0.62);
  c.lineTo(cx - r * 0.9, cy + r * 0.62);
  c.closePath();
  c.stroke();
  c.beginPath();
  c.arc(cx, cy + r * 0.18, size * 0.1, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// ─────────────────────────────── atlas ───────────────────────────────

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface Entry {
  x: number;
  y: number;
  w: number;
  h: number;
  draw: Draw;
  lit: number;
}

/**
 * Many signs, one texture, one mesh. Usage:
 *   const atlas = new SignAtlas("city-signs");
 *   const r = atlas.add(512, 128, drawBilingual("trimart", {...}), 1.4); // lit
 *   atlas.quad(r, 4, 1, new THREE.Vector3(x, y, z), rotationY);
 *   root.add(atlas.build());               // after the last add/quad
 * `lit` (0 = paint, >0 = emissive strength relative to the material's) goes into a
 * separate emissive canvas, so painted posters and glowing neon share one draw call.
 * Pixel sizes are packed in rows into a square canvas (default 2048).
 */
export class SignAtlas {
  private entries: Entry[] = [];
  private quads: THREE.BufferGeometry[] = [];
  private cursorX = 0;
  private cursorY = 0;
  private rowH = 0;
  constructor(
    readonly name: string,
    readonly size = 2048,
    readonly emissiveIntensity = 2.2,
  ) {}

  /** Reserve a w × h px cell and remember how to draw it. `lit` 0..1 scales its glow. */
  add(w: number, h: number, draw: Draw, lit = 0): AtlasRect {
    const pad = 4;
    if (this.cursorX + w + pad > this.size) {
      this.cursorX = 0;
      this.cursorY += this.rowH + pad;
      this.rowH = 0;
    }
    if (this.cursorY + h > this.size) throw new Error(`SignAtlas ${this.name} is full`);
    const e: Entry = { x: this.cursorX, y: this.cursorY, w, h, draw, lit };
    this.entries.push(e);
    this.cursorX += w + pad;
    this.rowH = Math.max(this.rowH, h);
    const S = this.size;
    return { u0: e.x / S, v0: 1 - (e.y + h) / S, u1: (e.x + w) / S, v1: 1 - e.y / S };
  }

  /**
   * A flat quad of `width × height` m showing `rect`, centred at `position`, facing +z
   * rotated by `rotationY` (0 = faces south/+z, π/2 = faces east/+x, -π/2 = west, π = north).
   * Optional extra rotation (tilt) via `euler`.
   */
  quad(rect: AtlasRect, width: number, height: number, position: THREE.Vector3, rotationY = 0, euler?: THREE.Euler) {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
    if (euler) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(euler));
    g.rotateY(rotationY);
    g.translate(position.x, position.y, position.z);
    this.quads.push(g);
    return g;
  }

  /** Paint the atlas, merge every quad into one mesh (no shadows), and return it. */
  build(): THREE.Mesh {
    const entries = this.entries;
    const map = canvasTexture(this.size, this.size, (c) => {
      c.clearRect(0, 0, this.size, this.size);
      for (const e of entries) {
        c.save();
        c.translate(e.x, e.y);
        c.beginPath();
        c.rect(0, 0, e.w, e.h);
        c.clip();
        e.draw(c, e.w, e.h);
        c.restore();
      }
    });
    const emissive = canvasTexture(this.size, this.size, (c) => {
      c.fillStyle = "#000";
      c.fillRect(0, 0, this.size, this.size);
      for (const e of entries) {
        if (!e.lit) continue;
        c.save();
        c.translate(e.x, e.y);
        c.beginPath();
        c.rect(0, 0, e.w, e.h);
        c.clip();
        c.fillStyle = "#000";
        c.fillRect(0, 0, e.w, e.h);
        c.globalAlpha = Math.min(1, e.lit);
        e.draw(c, e.w, e.h);
        c.restore();
      }
    });
    map.anisotropy = emissive.anisotropy = 8;
    const material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: this.emissiveIntensity,
      transparent: true,
      alphaTest: 0.04,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    material.name = `signs:${this.name}`;
    const mesh = new THREE.Mesh(this.quads.length ? mergeGeometries(this.quads)! : new THREE.BufferGeometry(), material);
    this.quads.forEach((q) => q.dispose());
    mesh.name = `signs:${this.name}`;
    mesh.userData.keepDynamic = true;
    mesh.renderOrder = 1;
    return mesh;
  }
}
