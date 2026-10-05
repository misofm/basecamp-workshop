/**
 * In-world text: canvas-texture signs and speech-bubble sprites.
 *
 * Owns: drawing text onto canvases (redrawn once the web fonts are ready), flat sign
 * meshes, and the SpeechBubble sprite used by the clerk, the collector and others.
 * Must not: decide what any character says; callers pass the text.
 */
import * as THREE from "three";

export const FONT_STACK = '"Space Grotesk", "DM Sans", system-ui, sans-serif';

type Draw = (c: CanvasRenderingContext2D, w: number, h: number) => void;
const redraws: (() => void)[] = [];
let fontsReady = false;
if (typeof document !== "undefined" && document.fonts) {
  void Promise.all([
    document.fonts.load(`700 64px "Space Grotesk"`),
    document.fonts.load(`500 64px "Space Grotesk"`),
  ])
    .catch(() => undefined)
    .then(() => document.fonts.ready)
    .then(() => {
      fontsReady = true;
      redraws.splice(0).forEach((r) => r());
    });
}

/** A canvas texture that is drawn now and redrawn once the fonts have loaded. */
export function canvasTexture(width: number, height: number, draw: Draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  paint();
  if (!fontsReady) redraws.push(paint);
  return texture;
}

/** Fit text into a width by shrinking the font size. Returns the size used. */
export function fitText(c: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight = 700) {
  let s = size;
  c.font = `${weight} ${s}px ${FONT_STACK}`;
  while (s > 12 && c.measureText(text).width > maxWidth) {
    s -= 2;
    c.font = `${weight} ${s}px ${FONT_STACK}`;
  }
  return s;
}

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export interface SignStyle {
  bg: string;
  ink: string;
  /** Emissive strength (0 = unlit paint). Lit signs read on a dark projector image. */
  glow?: number;
  border?: string;
  weight?: number;
  /** Text height as a fraction of the sign height. */
  scale?: number;
  sub?: string;
}

/** A flat, single-sided sign with centred text. */
export function signMesh(text: string, w: number, h: number, style: SignStyle) {
  const px = 1024;
  const texture = canvasTexture(px, Math.max(32, Math.round((px * h) / w)), (c, cw, ch) => {
    c.fillStyle = style.bg;
    c.fillRect(0, 0, cw, ch);
    if (style.border) {
      c.strokeStyle = style.border;
      c.lineWidth = ch * 0.07;
      c.strokeRect(ch * 0.06, ch * 0.06, cw - ch * 0.12, ch - ch * 0.12);
    }
    c.fillStyle = style.ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    const main = (style.scale ?? 0.56) * ch;
    fitText(c, text, cw * 0.88, main, style.weight ?? 700);
    c.fillText(text, cw / 2, style.sub ? ch * 0.42 : ch * 0.53);
    if (style.sub) {
      fitText(c, style.sub, cw * 0.8, ch * 0.18, 500);
      c.globalAlpha = 0.8;
      c.fillText(style.sub, cw / 2, ch * 0.8);
      c.globalAlpha = 1;
    }
  });
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  if (style.glow) {
    material.emissive.set("#ffffff");
    material.emissiveMap = texture;
    material.emissiveIntensity = style.glow;
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.userData.keepDynamic = true; // own texture: not worth merging
  return mesh;
}

export interface BubbleStyle {
  accent: string;
  /** Show an animated spinner + trailing dots ("Processing…"). */
  busy?: boolean;
  icon?: string;
}

/**
 * A speech bubble that floats above a character. Canvas sprite, big readable text,
 * drawn on top of nearby clutter (no depth test) but faded out when a building or
 * wall box sits between it and the camera, no fog, and kept between a minimum
 * on-screen size (so it reads from across the street) and a maximum one (so it never
 * covers the screen when the camera is right next to the character).
 */
export class SpeechBubble {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private text: string | null = null;
  private style: BubbleStyle = { accent: "#f2b544" };
  private time = 0;
  private lastPaint = -1;
  private pop = 0;
  /** Boxes that hide the bubble (buildings, shop walls); set by the owner. */
  occluders: () => THREE.Box3[] = () => [];
  private ray = new THREE.Ray();
  private hit = new THREE.Vector3();
  private fade = 1;
  /**
   * @param baseWidth      world width (m) when the camera is within `minScreenScale` metres
   * @param minScreenScale beyond this distance (m) the bubble grows to keep its screen size
   * @param maxScreenFraction cap on the bubble's projected height, as a fraction of the
   *   viewport height (0.12 = 12%); kicks in when the camera is close (≈ < 6 m)
   */
  constructor(
    private baseWidth = 2.6,
    private minScreenScale = 9,
    private maxScreenFraction = MAX_BUBBLE_SCREEN_FRACTION,
  ) {
    this.canvas.width = 1024;
    this.canvas.height = 300;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, color: "#d6d6d6", transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    );
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    this.sprite.userData.keepDynamic = true;
  }
  get visible() {
    return this.sprite.visible;
  }
  get current() {
    return this.text;
  }
  set(text: string | null, style?: BubbleStyle) {
    if (text === this.text && (!style || (style.accent === this.style.accent && style.busy === this.style.busy))) return;
    this.text = text;
    if (style) this.style = style;
    this.sprite.visible = text !== null;
    this.pop = 0;
    this.paint();
  }
  private paint() {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    if (!this.text) return;
    const tail = 46;
    const bodyH = h - tail - 8;
    // Shadow, body, accent border.
    c.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(c, 14, 14, w - 20, bodyH - 4, 56);
    c.fill();
    c.fillStyle = "#fffaf0";
    roundRect(c, 6, 4, w - 20, bodyH - 8, 56);
    c.fill();
    c.lineWidth = 12;
    c.strokeStyle = this.style.accent;
    c.stroke();
    // Tail.
    c.beginPath();
    c.moveTo(w / 2 - 40, bodyH - 10);
    c.lineTo(w / 2, h - 6);
    c.lineTo(w / 2 + 40, bodyH - 10);
    c.closePath();
    c.fillStyle = "#fffaf0";
    c.fill();
    c.strokeStyle = this.style.accent;
    c.stroke();
    c.fillStyle = "#fffaf0";
    c.fillRect(w / 2 - 34, bodyH - 22, 68, 16);
    // Text (one or two lines), optional spinner on the left.
    let left = 40;
    if (this.style.busy) {
      const cx = 120,
        cy = bodyH / 2;
      c.lineWidth = 16;
      c.strokeStyle = "#e3ddd0";
      c.beginPath();
      c.arc(cx, cy, 52, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = this.style.accent;
      c.lineCap = "round";
      c.beginPath();
      const a = this.time * 6;
      c.arc(cx, cy, 52, a, a + Math.PI * 1.25);
      c.stroke();
      c.lineCap = "butt";
      left = 190;
    }
    let text = this.text;
    if (this.style.busy) text = text.replace(/[.…]+$/, "") + ".".repeat(1 + (Math.floor(this.time * 3) % 3));
    c.fillStyle = "#1d2422";
    c.textBaseline = "middle";
    c.textAlign = this.style.busy ? "left" : "center";
    const maxW = w - left - 60;
    const words = text.split(" ");
    let lines = [text];
    let size = 104;
    c.font = `700 ${size}px ${FONT_STACK}`;
    if (c.measureText(text).width > maxW) {
      // Split into two balanced lines.
      let best = 1,
        bestDiff = Infinity;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(" "),
          b = words.slice(i).join(" ");
        const diff = Math.abs(c.measureText(a).width - c.measureText(b).width);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
      lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
      size = 84;
      c.font = `700 ${size}px ${FONT_STACK}`;
      const widest = Math.max(...lines.map((l) => c.measureText(l).width));
      if (widest > maxW) size = Math.floor((size * maxW) / widest);
      c.font = `700 ${size}px ${FONT_STACK}`;
    } else {
      size = fitText(c, text, maxW, size);
    }
    const x = this.style.busy ? left : w / 2 - 4;
    lines.forEach((line, i) => c.fillText(line, x, bodyH / 2 + (i - (lines.length - 1) / 2) * size * 1.08 + 4));
    this.texture.needsUpdate = true;
  }
  /** Animate (spinner, pop-in) and keep the on-screen size between the min and max. */
  update(dt: number, camera: THREE.Camera) {
    if (!this.sprite.visible) return;
    this.time += dt;
    this.pop = Math.min(1, this.pop + dt * 5);
    if (this.style.busy && this.time - this.lastPaint > 1 / 15) {
      this.lastPaint = this.time;
      this.paint();
    }
    const world = this.sprite.getWorldPosition(TMP);
    const distance = world.distanceTo(camera.position);
    // Occlusion: hide behind buildings even though the sprite ignores the depth buffer.
    this.ray.origin.copy(camera.position);
    this.ray.direction.copy(world).sub(camera.position).normalize();
    let blocked = false;
    for (const box of this.occluders()) {
      if (box.containsPoint(world)) continue;
      if (this.ray.intersectBox(box, this.hit) && this.hit.distanceTo(camera.position) < distance - 0.3) {
        blocked = true;
        break;
      }
    }
    this.fade = THREE.MathUtils.clamp(this.fade + (blocked ? -dt : dt) * 6, 0, 1);
    (this.sprite.material as THREE.SpriteMaterial).opacity = this.fade;
    const grow = Math.max(1, distance / this.minScreenScale);
    const ease = 1 - Math.pow(1 - this.pop, 3);
    const parentScale = this.sprite.parent ? this.sprite.parent.getWorldScale(TMP2).x : 1;
    let worldWidth = this.baseWidth * Math.min(grow, 3.2);
    // Max on-screen size: projected height = worldHeight / (2 · depth · tan(fov/2)).
    if (camera instanceof THREE.PerspectiveCamera) {
      const depth = Math.max(0.1, -TMP3.copy(world).applyMatrix4(camera.matrixWorldInverse).z);
      const maxHeight = this.maxScreenFraction * 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      worldWidth = Math.min(worldWidth, (maxHeight * this.canvas.width) / this.canvas.height);
    }
    const w = (worldWidth * (0.6 + 0.4 * ease)) / parentScale;
    this.sprite.scale.set(w, (w * this.canvas.height) / this.canvas.width, 1);
  }
}
/** Default cap on a speech bubble's height: 12% of the viewport. */
export const MAX_BUBBLE_SCREEN_FRACTION = 0.12;
const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const TMP3 = new THREE.Vector3();
