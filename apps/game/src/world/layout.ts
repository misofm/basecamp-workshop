/**
 * City layout: every fixed coordinate of the little open world, as plain data.
 *
 * Owns: world bounds, road/sidewalk/building rectangles, the shop footprint and
 * doorway, lanes, crosswalks, pedestrian routes, parked-car slots and the fixed
 * positions of the shop's stations.
 * Must not: import Three.js or touch the scene. Other world modules read these
 * numbers so the minimap, collision, traffic and rendering always agree.
 *
 * Axes: x = east (right on the minimap), z = south (down on the minimap), y = up.
 * The shop faces south onto Main Street; its door is at (0, 0).
 */
import type { Rect } from "./api";

/** Walkable bounds of the whole map (≈ 70 × 56 m). */
export const BOUNDS = { minX: -35, maxX: 35, minZ: -26, maxZ: 30 };

/** Sidewalks, plazas and the shop floor sit this high above the asphalt. */
export const CURB_HEIGHT = 0.15;

/** Main Street runs east–west in front of the shop. */
export const MAIN_ROAD: Rect = { x: 0, z: 9, w: 70, d: 10 }; // z 4 → 14
/** Cross street runs north–south, east of the shop. */
export const CROSS_ROAD: Rect = { x: 18, z: 2, w: 8, d: 56 }; // x 14 → 22
export const ROADS: Rect[] = [MAIN_ROAD, CROSS_ROAD];

/** Lane centre lines (right-hand traffic). */
export const LANES = {
  eastbound: 11.2, // z, heading +x
  westbound: 7.6, // z, heading -x
  southbound: 16, // x, heading +z
  northbound: 20, // x, heading -z
  parkingNorth: 5.05, // z, cars parked at the shop-side curb
};

/** Crosswalk rectangles (stripes are painted inside these). `along` = stripe direction. */
export const CROSSWALKS: (Rect & { along: "x" | "z" })[] = [
  { x: 12, z: 9, w: 3, d: 10, along: "x" }, // west of the intersection
  { x: 24, z: 9, w: 3, d: 10, along: "x" }, // east of the intersection
  { x: 18, z: 2, w: 8, d: 3, along: "z" }, // north of the intersection
  { x: 18, z: 16, w: 8, d: 3, along: "z" }, // south of the intersection
  { x: -25, z: 9, w: 3, d: 10, along: "x" }, // mid-block, west
];

/** The record shop building (outer walls). Interior is x -9 → 9, z -14 → -0.3. */
export const SHOP: Rect = { x: 0, z: -7.15, w: 18.6, d: 14.3 };
export const SHOP_INTERIOR = { minX: -9, maxX: 9, minZ: -14, maxZ: -0.3 };
export const SHOP_FLOOR_Y = CURB_HEIGHT;
/** Doorway gap in the front wall (x range) and the wall's z extent. */
export const DOOR = { x: 0, z: 0, halfWidth: 1.25, wallMinZ: -0.3, wallMaxZ: 0 };

/** Buildings: rect + height + tint index. The shop is separate. */
export interface BuildingSpec extends Rect {
  h: number;
  tint: string;
}
export const BUILDINGS: BuildingSpec[] = [
  // North side of Main Street, west of the shop.
  { x: -28.5, z: -7, w: 13, d: 14, h: 14, tint: "#b98a6a" },
  { x: -15.5, z: -7, w: 11, d: 14, h: 9, tint: "#8fa3a8" },
  // Behind the shop (backdrop).
  { x: -12.5, z: -20.5, w: 45, d: 12, h: 17, tint: "#7d6f69" },
  // North-east block.
  { x: 30.5, z: -6, w: 9, d: 12, h: 12, tint: "#a7957a" },
  { x: 30.5, z: -19.5, w: 9, d: 13, h: 21, tint: "#6f7d8c" },
  // South side of Main Street.
  { x: -29.5, z: 24, w: 11, d: 12, h: 10, tint: "#9c6b5a" },
  { x: -17.75, z: 24, w: 11.5, d: 12, h: 16, tint: "#c2b49b" },
  { x: -6.25, z: 24, w: 10.5, d: 12, h: 8, tint: "#7f9a86" },
  { x: 4.75, z: 24, w: 10.5, d: 12, h: 13, tint: "#a88e9e" },
  // South-east block.
  { x: 30.5, z: 24, w: 9, d: 12, h: 15, tint: "#8c8f9c" },
];

/** Player spawn: on the sidewalk in front of the shop, facing the door (north). */
export const SPAWN = { x: 0, z: 3.4, heading: Math.PI };

/** Shop stations (all on the shop floor). */
export const DECK = { x: -5.5, z: -12.9, interactX: -5.5, interactZ: -11.5 };
export const COUNTER = { x: 5.5, z: -12.6, interactX: 5.5, interactZ: -11.2, clerkZ: -13.5 };

/** Parked cars at the shop-side curb (x centres), all facing west. */
export const PARKED_CARS = [-18, -11.5, -5.6, 6.2].map((x) => ({ x, z: LANES.parkingNorth }));

/** The collector stands on the sidewalk east of the door, by the bench. */
export const BUYER_SPOT = { x: 4.4, z: 1.5, heading: -Math.PI / 2 - 0.6 };
/** After a sale the collector strolls off west along the sidewalk. */
export const BUYER_EXIT = [
  { x: 3.2, z: 2.9 },
  { x: -30, z: 2.9 },
];

/** Pedestrian routes (closed loops or ping-pong lines), all on sidewalks/crosswalks. */
export const PED_ROUTES: { points: { x: number; z: number }[]; loop: boolean }[] = [
  // Big loop: shop sidewalk → west crosswalk → south sidewalk → mid-block crosswalk.
  {
    loop: true,
    points: [
      { x: -25, z: 2.9 },
      { x: 12, z: 2.9 },
      { x: 12, z: 16 },
      { x: -25, z: 16 },
    ],
  },
  // Small loop around the intersection using all four crosswalks.
  {
    loop: true,
    points: [
      { x: 12, z: 2.2 },
      { x: 24, z: 2.2 },
      { x: 24, z: 16 },
      { x: 12, z: 16 },
    ],
  },
  // Up and down the cross street sidewalks.
  { loop: false, points: [{ x: 12, z: -22 }, { x: 12, z: 26 }] },
  { loop: false, points: [{ x: 24, z: -22 }, { x: 24, z: 26 }] },
];

/** Streetlights (pole base positions) and which way the arm points (radians, 0 = +z). */
export const STREETLIGHTS: { x: number; z: number; facing: number }[] = [
  { x: -27, z: 3.7, facing: 0 },
  { x: -16, z: 3.7, facing: 0 },
  { x: -7.5, z: 3.7, facing: 0 },
  { x: 8.5, z: 3.7, facing: 0 },
  { x: -21, z: 14.3, facing: Math.PI },
  { x: -6, z: 14.3, facing: Math.PI },
  { x: 8, z: 14.3, facing: Math.PI },
  { x: 13.7, z: -6, facing: Math.PI / 2 },
  { x: 13.7, z: -18, facing: Math.PI / 2 },
  { x: 22.3, z: 0.5, facing: -Math.PI / 2 },
  { x: 22.3, z: 20, facing: -Math.PI / 2 },
  { x: 29, z: 14.3, facing: Math.PI },
];

export function inRect(r: Rect, x: number, z: number, pad = 0) {
  return Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad;
}
export function onRoad(x: number, z: number) {
  return ROADS.some((r) => inRect(r, x, z));
}
export function inShop(x: number, z: number) {
  const s = SHOP_INTERIOR;
  return x > s.minX && x < s.maxX && z > s.minZ && z < DOOR.wallMinZ + 0.05;
}
/** Ground height for anything walking: asphalt is 0, sidewalks and the shop floor are raised. */
export function groundHeight(x: number, z: number) {
  return onRoad(x, z) ? 0 : CURB_HEIGHT;
}
