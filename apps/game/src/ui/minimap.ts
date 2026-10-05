/**
 * GTA-style circular minimap (bottom-left), drawn on a <canvas>.
 *
 * Owns: drawing a MapSnapshot: roads, buildings, the highlighted shop, blips
 * (deck ♪, cashier $, collector ★, FakeUSD ATM ¤, parked cars, traffic, pedestrians), the player
 * arrow and the waypoint (edge-clamped arrow when it is off the map).
 * Must not: contain game logic or call the world. The controller hands it a
 * snapshot; draw() throttles itself to ≤ 30 Hz.
 *
 * Orientation: NORTH-UP and player-centred (clearer for an audience on a projector
 * than a rotating map). The player arrow rotates with heading; world heading 0
 * faces +z, which is DOWN on the map (x right, z down).
 */
import type { MapSnapshot, Rect } from "../world/api";
import { h } from "./dom";

const SIZE = 250; // CSS px (diameter)
const PX_PER_M = 4.4;
const REDRAW_MS = 1000 / 30;

const COLORS = {
  ground: "#2b3a36",
  road: "#58646a",
  roadLine: "#c9b26a",
  building: "#7b8a86",
  buildingEdge: "#a4b2ac",
  shop: "#e7a64f",
  shopEdge: "#ffe2a8",
  traffic: "#c9d3d8",
  pedestrian: "#e8e3d4",
  car: "#ff6b5b",
  carSmashed: "#5b6366",
  waypoint: "#ffd23f",
  player: "#ffffff",
};

export class Minimap {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticBounds: MapSnapshot["bounds"] | null = null;
  private lastDraw = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(host: HTMLElement) {
    this.canvas = h("canvas", { class: "minimap-canvas", width: SIZE * this.dpr, height: SIZE * this.dpr, "aria-hidden": "true" });
    this.ctx = this.canvas.getContext("2d")!;
    this.root = h("div", { class: "minimap", role: "img", "aria-label": "Minimap" }, this.canvas, h("span", { class: "minimap-north" }, "N"));
    host.append(this.root);
  }

  /**
   * Redraw. Pass the snapshot lazily (a function) so callers can invoke this every
   * frame: it only builds a snapshot and repaints at most 30 times a second.
   */
  draw(source: MapSnapshot | (() => MapSnapshot), force = false): void {
    const now = performance.now();
    if (!force && now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    const snapshot = typeof source === "function" ? source() : source;
    if (!this.staticLayer) this.buildStatic(snapshot);
    const ctx = this.ctx;
    const r = SIZE / 2;
    const { player } = snapshot;
    const b = this.staticBounds!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#1c2624";
    ctx.fillRect(0, 0, SIZE, SIZE);

    // World -> screen: player at centre, north up.
    const sx = (x: number) => r + (x - player.x) * PX_PER_M;
    const sy = (z: number) => r + (z - player.z) * PX_PER_M;
    ctx.drawImage(this.staticLayer!, sx(b.minX), sy(b.minZ), (b.maxX - b.minX) * PX_PER_M, (b.maxZ - b.minZ) * PX_PER_M);

    for (const p of snapshot.pedestrians) dot(ctx, sx(p.x), sy(p.z), 2.2, COLORS.pedestrian);
    for (const c of snapshot.cars) dot(ctx, sx(c.x), sy(c.z), 3, COLORS.traffic);

    for (const point of snapshot.points) {
      const x = sx(point.x),
        y = sy(point.z);
      switch (point.kind) {
        case "deck":
          blip(ctx, x, y, "♪", "#7c5cff");
          break;
        case "cashier":
          blip(ctx, x, y, "$", "#2fbf71");
          break;
        case "buyer":
          if (point.enabled) blip(ctx, x, y, "★", "#ffb020");
          break;
        case "atm":
          blip(ctx, x, y, "¤", "#2b8fd6");
          break;
        case "car":
          carBlip(ctx, x, y, point.enabled ? COLORS.car : COLORS.carSmashed);
          break;
        case "record":
          break; // too many, too small: the shop footprint says "records here"
      }
    }

    if (snapshot.waypoint) this.drawWaypoint(sx(snapshot.waypoint.x), sy(snapshot.waypoint.z), r);
    ctx.restore();

    // Player arrow: forward (sin h, cos h) in map space.
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(Math.PI - player.heading);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fillStyle = COLORS.player;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // Rim.
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.strokeStyle = "#0d1311";
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  private drawWaypoint(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    const dx = x - r,
      dy = y - r;
    const dist = Math.hypot(dx, dy);
    const edge = r - 16;
    if (dist <= edge) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = COLORS.waypoint;
      ctx.strokeStyle = "#1a1300";
      ctx.lineWidth = 2.5;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
      return;
    }
    // Off-map: an arrow on the rim pointing at it.
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(r + Math.cos(a) * edge, r + Math.sin(a) * edge);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-7, -9);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fillStyle = COLORS.waypoint;
    ctx.strokeStyle = "#1a1300";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  /** Roads, buildings and the shop never move: render them once at map scale. */
  private buildStatic(s: MapSnapshot): void {
    const b = s.bounds;
    const scale = PX_PER_M * this.dpr;
    const layer = document.createElement("canvas");
    layer.width = Math.ceil((b.maxX - b.minX) * scale);
    layer.height = Math.ceil((b.maxZ - b.minZ) * scale);
    const c = layer.getContext("2d")!;
    const rect = (r: Rect) => [(r.x - r.w / 2 - b.minX) * scale, (r.z - r.d / 2 - b.minZ) * scale, r.w * scale, r.d * scale] as const;
    c.fillStyle = COLORS.ground;
    c.fillRect(0, 0, layer.width, layer.height);
    c.fillStyle = COLORS.road;
    for (const road of s.roads) c.fillRect(...rect(road));
    // Centre lines.
    c.strokeStyle = COLORS.roadLine;
    c.lineWidth = 1.2 * this.dpr;
    c.setLineDash([5 * this.dpr, 5 * this.dpr]);
    for (const road of s.roads) {
      const [x, y, w, d] = rect(road);
      c.beginPath();
      if (w > d) {
        c.moveTo(x, y + d / 2);
        c.lineTo(x + w, y + d / 2);
      } else {
        c.moveTo(x + w / 2, y);
        c.lineTo(x + w / 2, y + d);
      }
      c.stroke();
    }
    c.setLineDash([]);
    c.lineWidth = 1.5 * this.dpr;
    for (const building of s.buildings) {
      c.fillStyle = COLORS.building;
      c.strokeStyle = COLORS.buildingEdge;
      c.fillRect(...rect(building));
      c.strokeRect(...rect(building));
    }
    c.fillStyle = COLORS.shop;
    c.strokeStyle = COLORS.shopEdge;
    c.lineWidth = 2.5 * this.dpr;
    c.fillRect(...rect(s.shop));
    c.strokeRect(...rect(s.shop));
    const [x, y, w, d] = rect(s.shop);
    c.fillStyle = "#2a1a05";
    c.font = `700 ${11 * this.dpr}px "Space Grotesk", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("RECORDS", x + w / 2, y + d / 2);
    this.staticLayer = layer;
    this.staticBounds = { ...b };
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function blip(ctx: CanvasRenderingContext2D, x: number, y: number, glyph: string, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0b0f0e";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = '700 13px "Space Grotesk", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, x, y + 1);
}

function carBlip(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = "#0b0f0e";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - 7, y - 4, 14, 8);
  ctx.strokeRect(x - 7, y - 4, 14, 8);
}
