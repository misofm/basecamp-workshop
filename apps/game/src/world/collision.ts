/**
 * Collision: axis-aligned boxes on the ground plane, for walking and for the camera.
 *
 * Owns: the list of solid footprints (buildings, shop walls, furniture, parked cars,
 * props), the optional doorway wall, `valid(x, z)` for anything that walks, and the
 * 3D boxes the third-person camera is pulled in front of.
 * Must not: move anything or know about gameplay; callers decide what to do with a "no".
 */
import * as THREE from "three";
import { BOUNDS, DOOR } from "./layout";

export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Height used for camera collision (0 = ignore for the camera). */
  h: number;
  tag?: string;
  enabled?: boolean;
}

export class Collision {
  readonly obstacles: Obstacle[] = [];
  /** Camera boxes are rebuilt lazily when obstacles change. */
  private cameraBoxes: THREE.Box3[] = [];
  private dirty = true;
  /** The invisible wall in the shop doorway (setExitBlocked). */
  readonly doorWall: Obstacle = {
    x: DOOR.x,
    z: (DOOR.wallMinZ + DOOR.wallMaxZ) / 2 - 0.25,
    w: DOOR.halfWidth * 2,
    d: 0.8,
    h: 0,
    tag: "door",
    enabled: false,
  };
  constructor() {
    this.obstacles.push(this.doorWall);
  }
  add(o: Obstacle) {
    this.obstacles.push(o);
    this.dirty = true;
    return o;
  }
  /** Add a box given min/max corners. */
  addBounds(minX: number, minZ: number, maxX: number, maxZ: number, h: number, tag?: string) {
    return this.add({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ, h, tag });
  }
  /** The obstacle blocking a body of `radius` at (x, z), or null if free. Out of bounds returns a sentinel. */
  hit(x: number, z: number, radius = 0.28): Obstacle | null {
    if (x < BOUNDS.minX + radius || x > BOUNDS.maxX - radius || z < BOUNDS.minZ + radius || z > BOUNDS.maxZ - radius)
      return OUT_OF_BOUNDS;
    for (const o of this.obstacles) {
      if (o.enabled === false) continue;
      if (Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius) return o;
    }
    return null;
  }
  valid(x: number, z: number, radius = 0.28) {
    return this.hit(x, z, radius) === null;
  }
  /** Only buildings and shop walls: what may hide a speech bubble from the camera. */
  occluders(): THREE.Box3[] {
    const boxes = this.camera(); // rebuilds (and clears occluderBoxes) if obstacles changed
    if (!this.occluderBoxes) {
      this.occluderBoxes = this.obstacles
        .filter((o) => o.h > 0)
        .map((o, i) => [o, boxes[i]] as const)
        .filter(([o]) => o.tag === "building" || o.tag === "shop-wall" || o.tag === "shop-front")
        .map(([, b]) => b);
    }
    return this.occluderBoxes;
  }
  private occluderBoxes: THREE.Box3[] | null = null;
  /** Boxes the camera ray is tested against (slightly inflated so the near plane never clips a wall). */
  camera(): THREE.Box3[] {
    if (this.dirty) {
      this.occluderBoxes = null;
      this.cameraBoxes = this.obstacles
        .filter((o) => o.h > 0)
        .map(
          (o) =>
            new THREE.Box3(
              new THREE.Vector3(o.x - o.w / 2 - 0.12, -1, o.z - o.d / 2 - 0.12),
              new THREE.Vector3(o.x + o.w / 2 + 0.12, o.h, o.z + o.d / 2 + 0.12),
            ),
        );
      this.dirty = false;
    }
    return this.cameraBoxes;
  }
}

const OUT_OF_BOUNDS: Obstacle = { x: 0, z: 0, w: 0, d: 0, h: 0, tag: "bounds" };
