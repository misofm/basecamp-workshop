/**
 * The FakeUSD ATM in TriMart's open vestibule (the testnet faucet, in-world).
 *
 * Owns: the cabinet (chunky beige 1990s/2030s casing with privacy wings and a backlit
 * "ATM" header carrying the Triangle mark, a CRT screen with green phosphor, scanlines and
 * a curved-glass sheen reading "ATM · SIGNS.atm / WITHDRAWAL" and "FakeUSD", a steel
 * keypad, card slot, glowing cash slot, grime), its collision box and the "atm"
 * interactable. The CRT and header glow past the bloom threshold and throw a faked light
 * pool on the vestibule floor, so the ATM reads from the sidewalk (no real light).
 * Must not: know about money or the faucet; pressing E is reported like any other
 * interactable and the game layer (flows/atm-flow.ts) decides what it means.
 * The vestibule walls belong to city.ts.
 *
 * Cost: a handful of draw calls (merged flat materials, one sign atlas, one additive glow mesh).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { ATM, CURB_HEIGHT } from "./layout";
import { batchStaticGeometry, box, flat } from "./materials";
import { mergeFlatColors } from "./shop";
import { canvasTexture } from "./labels";
import { drawTriangleMark, EN_FONT, EN_ONLY, fitFont, grime, JP_FONT, SignAtlas, SIGNS } from "./signage";

const BEIGE = flat("#c9bc9c", 0.75);
const BEIGE_DARK = flat("#9e9278", 0.8);
const TRIM = flat("#26231f", 0.6);
const STEEL = flat("#a9aeb0", 0.35);
const KEY = flat("#d5d8d6", 0.4);
const SLOT = flat("#2a1a05", 0.6, "#ffb35c", 2.6);
const LED = flat("#103010", 0.5, "#5cff7a", 3);
const FN_KEYS = [flat("#8a1f1a", 0.5), flat("#b8901e", 0.5), flat("#1f6a2e", 0.5)];

const HEIGHT = 1.95;
/** The CRT face's tilt back from vertical (radians) and size / height (local). */
const SCREEN_TILT = 0.2;
const SCREEN = { y: 1.24, w: 0.5, h: 0.37 };

export class Atm {
  readonly root = new THREE.Group();

  constructor(scene: THREE.Scene, collision: Collision, interactables: Interactables) {
    this.root.name = "atm";
    this.root.position.set(ATM.x, CURB_HEIGHT, ATM.z);
    scene.add(this.root);
    this.build();
    mergeFlatColors(this.root);
    batchStaticGeometry(this.root);
    collision.add({ x: ATM.x, z: ATM.z, w: ATM.w + 0.1, d: ATM.d + 0.06, h: HEIGHT, tag: "atm" });
    interactables.register({ id: "atm", kind: "atm", x: ATM.interactX, z: ATM.interactZ, radius: 1.5 });
  }

  /** Built in local space: +z faces the street (the player's side). */
  private build() {
    const r = this.root;
    const w = ATM.w,
      d = ATM.d,
      front = d / 2;
    // Plinth and the chunky lower body.
    box(r, w + 0.08, 0.1, d + 0.06, 0, 0.05, 0, TRIM);
    box(r, w, 0.86, d, 0, 0.53, 0, BEIGE);
    // A bevelled lip where the keypad shelf meets the body, and a darker kick band.
    box(r, w + 0.02, 0.06, d + 0.02, 0, 0.96, 0, BEIGE_DARK);
    box(r, w - 0.04, 0.12, 0.02, 0, 0.17, front + 0.005, BEIGE_DARK, {});
    // Upper body set back, so the screen sits in a recess under the header.
    box(r, w, 0.62, d - 0.14, 0, 1.3, -0.07, BEIGE);
    // Privacy wings either side of the screen.
    for (const x of [-1, 1]) box(r, 0.05, 0.84, 0.2, x * (w / 2 - 0.025), 1.38, front - 0.1, BEIGE);
    // Header: a projecting box with the backlit sign on its face.
    box(r, w + 0.06, 0.3, d + 0.06, 0, 1.78, 0.03, BEIGE);
    box(r, w + 0.08, 0.04, d + 0.08, 0, 1.95, 0.03, BEIGE_DARK);
    // CRT bezel: a dark tube housing behind the tilted face.
    const bezel = new THREE.Group();
    bezel.position.set(0, SCREEN.y, front - 0.12);
    bezel.rotation.x = -SCREEN_TILT;
    r.add(bezel);
    box(bezel, SCREEN.w + 0.1, SCREEN.h + 0.1, 0.06, 0, 0, 0, TRIM, {});
    box(bezel, SCREEN.w + 0.16, SCREEN.h + 0.16, 0.03, 0, 0, -0.03, BEIGE_DARK, {});
    // Keypad shelf (steel, tilted toward the user), 4×3 keys + three function keys.
    const pad = new THREE.Group();
    pad.position.set(0, 0.99, front + 0.06);
    pad.rotation.x = 0.32;
    r.add(pad);
    box(pad, w - 0.12, 0.03, 0.26, 0, 0, 0, STEEL);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 3; col++) box(pad, 0.05, 0.022, 0.04, -0.13 + col * 0.065, 0.024, -0.08 + row * 0.052, KEY, {});
    FN_KEYS.forEach((m, i) => box(pad, 0.07, 0.022, 0.04, 0.14, 0.024, -0.08 + i * 0.052, m, {}));
    // Card slot (with a green LED) right of the keypad, receipt slot left.
    box(r, 0.13, 0.05, 0.03, 0.25, 0.86, front + 0.015, TRIM, {});
    box(r, 0.1, 0.008, 0.01, 0.25, 0.86, front + 0.032, SLOT, {});
    box(r, 0.018, 0.018, 0.01, 0.33, 0.86, front + 0.032, LED, {});
    box(r, 0.12, 0.012, 0.02, -0.25, 0.86, front + 0.012, TRIM, {});
    // Cash slot below the keypad: a steel shutter with a warm glow along its lip.
    box(r, 0.5, 0.1, 0.03, 0, 0.7, front + 0.015, STEEL, {});
    box(r, 0.44, 0.022, 0.01, 0, 0.68, front + 0.032, SLOT, {});
    // Signs, screen and grime: one atlas, one draw call.
    const atlas = new SignAtlas("atm", 1024, 2.6);
    const crt = atlas.add(512, 384, drawCrt, 1);
    const header = atlas.add(512, 160, drawHeader, 0.45);
    const dirt = atlas.add(256, 256, (c, cw, ch) => grime(c, cw, ch, 1.4, 23), 0);
    const mark = atlas.add(256, 256, (c, cw, ch) => {
      drawTriangleMark(c, cw / 2, ch / 2, cw * 0.55, "rgba(60,52,40,0.85)");
      grime(c, cw, ch, 0.8, 5);
    }, 0);
    atlas.quad(crt, SCREEN.w, SCREEN.h, new THREE.Vector3(0, SCREEN.y, front - 0.085), 0, new THREE.Euler(-SCREEN_TILT, 0, 0));
    atlas.quad(header, w + 0.02, 0.26, new THREE.Vector3(0, 1.78, front + 0.065));
    atlas.quad(dirt, w - 0.02, 0.84, new THREE.Vector3(0, 0.52, front + 0.004));
    for (const x of [-1, 1]) atlas.quad(mark, 0.36, 0.36, new THREE.Vector3(x * (w / 2 + 0.004), 0.55, 0), (x * Math.PI) / 2);
    const signs = atlas.build();
    (signs.material as THREE.MeshStandardMaterial).toneMapped = false;
    r.add(signs);
    // Faked light: a soft phosphor halo around the CRT and a pool on the floor in front.
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: "#6dffa8",
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const halo = new THREE.PlaneGeometry(1.2, 0.95).rotateX(-SCREEN_TILT).translate(0, SCREEN.y, front - 0.06);
    const pool = new THREE.PlaneGeometry(1.9, 1.5).rotateX(-Math.PI / 2).translate(0, 0.012, front + 0.8);
    const glow = new THREE.Mesh(mergeGeometries([halo, pool])!, glowMat);
    glow.userData.keepDynamic = true;
    glow.renderOrder = 5;
    r.add(glow);
  }
}

/** The CRT face: green phosphor text, scanlines, vignette, rounded tube corners and a glass sheen. */
function drawCrt(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = "#020603";
  c.fillRect(0, 0, w, h);
  // Rounded, slightly bulging tube mask.
  const r = 46;
  c.save();
  c.beginPath();
  c.moveTo(r, 6);
  c.quadraticCurveTo(w / 2, -4, w - r, 6);
  c.quadraticCurveTo(w - 6, 6, w - 6, r);
  c.quadraticCurveTo(w + 4, h / 2, w - 6, h - r);
  c.quadraticCurveTo(w - 6, h - 6, w - r, h - 6);
  c.quadraticCurveTo(w / 2, h + 4, r, h - 6);
  c.quadraticCurveTo(6, h - 6, 6, h - r);
  c.quadraticCurveTo(-4, h / 2, 6, r);
  c.quadraticCurveTo(6, 6, r, 6);
  c.clip();
  const bg = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.62);
  bg.addColorStop(0, "#0b2a14");
  bg.addColorStop(1, "#020a04");
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  const ink = "#7dffa0";
  c.shadowColor = ink;
  c.shadowBlur = 14;
  c.fillStyle = ink;
  c.textBaseline = "middle";
  // Header row: "ATM · " + SIGNS.atm.jp, then the English line.
  const lead = "ATM · ";
  fitFont(c, lead, w * 0.3, 50, EN_FONT);
  const left = c.measureText(lead).width;
  fitFont(c, SIGNS.atm.jp, w * 0.5, 50, JP_FONT);
  const right = c.measureText(SIGNS.atm.jp).width;
  const x0 = (w - left - right) / 2;
  c.textAlign = "left";
  fitFont(c, lead, w * 0.3, 50, EN_FONT);
  c.fillText(lead, x0, h * 0.17);
  fitFont(c, SIGNS.atm.jp, w * 0.5, 50, JP_FONT);
  c.fillText(SIGNS.atm.jp, x0 + left, h * 0.17);
  c.textAlign = "center";
  fitFont(c, SIGNS.atm.en, w * 0.8, 34, EN_FONT);
  c.fillText(SIGNS.atm.en, w / 2, h * 0.31);
  c.fillRect(w * 0.1, h * 0.4, w * 0.8, 3);
  fitFont(c, EN_ONLY.fusd, w * 0.82, 104, EN_FONT);
  c.fillStyle = "#ffd36a"; // amber accent: the currency
  c.shadowColor = "#ffb030";
  c.fillText(EN_ONLY.fusd, w / 2, h * 0.6);
  c.fillStyle = ink;
  c.shadowColor = ink;
  const menu = "▸ 50    ▸ 100    ▸ OTHER";
  fitFont(c, menu, w * 0.8, 30, EN_FONT, 500);
  c.fillText(menu, w / 2, h * 0.84);
  c.shadowBlur = 0;
  // Scanlines and a faint rolling band.
  c.fillStyle = "rgba(0,0,0,0.38)";
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 2);
  const band = c.createLinearGradient(0, h * 0.62, 0, h * 0.78);
  band.addColorStop(0, "rgba(120,255,160,0)");
  band.addColorStop(0.5, "rgba(120,255,160,0.08)");
  band.addColorStop(1, "rgba(120,255,160,0)");
  c.fillStyle = band;
  c.fillRect(0, h * 0.62, w, h * 0.16);
  // Vignette (curvature) and a glass sheen across the top-left.
  const vig = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.75)");
  c.fillStyle = vig;
  c.fillRect(0, 0, w, h);
  const sheen = c.createLinearGradient(0, 0, w * 0.5, h * 0.6);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = sheen;
  c.beginPath();
  c.ellipse(w * 0.3, h * 0.22, w * 0.32, h * 0.14, -0.25, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** The backlit header: cream panel, "ATM" in amber-orange, the Triangle mark, yellowed and dirty. */
function drawHeader(c: CanvasRenderingContext2D, w: number, h: number) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#f4e6c0");
  g.addColorStop(1, "#d9c393");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  drawTriangleMark(c, h * 0.62, h * 0.52, h * 0.66, "#2b2620");
  c.fillStyle = "#e0611c";
  c.textAlign = "center";
  c.textBaseline = "middle";
  fitFont(c, "ATM", w * 0.5, h * 0.78, EN_FONT, 800);
  c.fillText("ATM", w * 0.56, h * 0.54);
  c.fillStyle = "#2b2620";
  fitFont(c, "24H", w * 0.14, h * 0.3, EN_FONT, 700);
  c.fillText("24H", w * 0.88, h * 0.54);
  // A dying tube: one end of the panel darker.
  const dead = c.createLinearGradient(w * 0.75, 0, w, 0);
  dead.addColorStop(0, "rgba(40,30,20,0)");
  dead.addColorStop(1, "rgba(40,30,20,0.55)");
  c.fillStyle = dead;
  c.fillRect(0, 0, w, h);
  grime(c, w, h, 0.9, 3);
}

/** A soft radial falloff (white → transparent) for the faked phosphor glow. */
function glowTexture() {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.4, "rgba(255,255,255,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}
