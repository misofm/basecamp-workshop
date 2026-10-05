/**
 * The city around the shop: streets, sidewalks, buildings, streetlights, props and rain.
 *
 * Owns: everything static outdoors except the shop building itself (shop.ts) and the
 * cars (traffic.ts / cars.ts). Buildings share ONE material with a procedural window
 * atlas and are merged into one mesh; streetlights are InstancedMeshes whose light
 * pools are additive ground decals instead of real lights. Registers building and
 * prop footprints with Collision.
 * Must not: animate gameplay objects or know about records, money or the UI.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Collision } from "./collision";
import { BUILDINGS, CROSS_ROAD, CROSSWALKS, CURB_HEIGHT, LANES, MAIN_ROAD, STREETLIGHTS, inShop, type BuildingSpec } from "./layout";
import { batchStaticGeometry, box, flat, physicalUVs, surfaces } from "./materials";
import { canvasTexture } from "./labels";

/** Out-of-bounds buildings that close off the horizon (no collision needed: outside the walkable area). */
const BACKDROP: BuildingSpec[] = [
  { x: -46, z: -6, w: 20, d: 14, h: 22, tint: "#7d8590" },
  { x: 46, z: -6, w: 20, d: 14, h: 26, tint: "#8a7f74" },
  { x: -46, z: 24, w: 20, d: 12, h: 18, tint: "#806e66" },
  { x: 46, z: 24, w: 20, d: 12, h: 24, tint: "#6f7e86" },
  { x: -64, z: 9, w: 8, d: 30, h: 20, tint: "#77706a" },
  { x: 64, z: 9, w: 8, d: 30, h: 28, tint: "#6c7480" },
  { x: 18, z: -44, w: 30, d: 8, h: 30, tint: "#7a8088" },
  { x: 18, z: 48, w: 30, d: 8, h: 18, tint: "#8a7a70" },
  { x: 7, z: -34, w: 12, d: 10, h: 26, tint: "#837a73" },
  { x: 30, z: -34, w: 12, d: 10, h: 34, tint: "#6d7783" },
];

export class City {
  readonly root = new THREE.Group();
  private rain: THREE.LineSegments;
  private rainPositions: Float32Array;
  constructor(
    scene: THREE.Scene,
    private collision: Collision,
  ) {
    this.root.name = "city";
    scene.add(this.root);
    this.ground();
    this.markings();
    this.buildings();
    this.streetlights();
    this.props();
    const { lines, positions } = this.makeRain();
    this.rain = lines;
    this.rainPositions = positions;
    scene.add(this.rain);
    batchStaticGeometry(this.root);
  }

  /** Raised pavement blocks between the roads (their sides are the curbs) and the asphalt. */
  private ground() {
    const r = this.root;
    const main = { minZ: MAIN_ROAD.z - MAIN_ROAD.d / 2, maxZ: MAIN_ROAD.z + MAIN_ROAD.d / 2 };
    const cross = { minX: CROSS_ROAD.x - CROSS_ROAD.w / 2, maxX: CROSS_ROAD.x + CROSS_ROAD.w / 2 };
    const E = 70,
      N = -50,
      S = 55;
    const blocks = [
      [-E, N, cross.minX, main.minZ],
      [cross.maxX, N, E, main.minZ],
      [-E, main.maxZ, cross.minX, S],
      [cross.maxX, main.maxZ, E, S],
    ];
    const curb = flat("#a7a9a3", 0.8);
    for (const [x0, z0, x1, z1] of blocks) {
      box(r, x1 - x0, CURB_HEIGHT, z1 - z0, (x0 + x1) / 2, CURB_HEIGHT / 2, (z0 + z1) / 2, surfaces.pavement, { receive: true });
      // Curb stones along the road-facing edges.
      const edges: [number, number, number, number][] = [];
      if (z1 === main.minZ) edges.push([x0, z1 - 0.25, x1, z1]);
      if (z0 === main.maxZ) edges.push([x0, z0, x1, z0 + 0.25]);
      if (x1 === cross.minX) edges.push([x1 - 0.25, z0, x1, z1]);
      if (x0 === cross.maxX) edges.push([x0, z0, x0 + 0.25, z1]);
      for (const [a, b, c, d] of edges) box(r, c - a, 0.02, d - b, (a + c) / 2, CURB_HEIGHT + 0.005, (b + d) / 2, curb, { receive: true });
    }
    // Asphalt: Main Street full length, the cross street north and south of it.
    const asphalt = (x0: number, z0: number, x1: number, z1: number) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      physicalUVs(g, 0.25);
      const m = new THREE.Mesh(g, surfaces.asphalt);
      m.receiveShadow = true;
      r.add(m);
    };
    asphalt(-E, main.minZ, E, main.maxZ);
    asphalt(cross.minX, N, cross.maxX, main.minZ);
    asphalt(cross.minX, main.maxZ, cross.maxX, S);
    // Wet puddles: darker-than-asphalt, mirror-smooth patches with feathered edges, so
    // they read as standing water catching the light instead of grey discs.
    const feather = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.55, "#fff");
      g.addColorStop(1, "#000");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    feather.colorSpace = THREE.NoColorSpace;
    const puddle = new THREE.MeshStandardMaterial({
      color: "#06090c",
      roughness: 0.04,
      metalness: 0.0,
      transparent: true,
      opacity: 0.62,
      alphaMap: feather,
      depthWrite: false,
      envMapIntensity: 0.55,
    });
    const geometries: THREE.BufferGeometry[] = [];
    const spots = [
      [-20, 6.2], [-9, 12.5], [-2, 7], [4, 12.8], [9, 5.8], [17, -4], [19.5, 18], [27, 10], [-30, 11], [15.5, 9],
    ];
    spots.forEach(([x, z], i) => {
      const g = new THREE.CircleGeometry(0.9 + (i % 3) * 0.45, 20);
      g.rotateX(-Math.PI / 2);
      g.scale(1, 1, 0.45 + (i % 2) * 0.2);
      g.rotateY(i * 0.7);
      g.translate(x, 0.01, z);
      geometries.push(g);
    });
    const puddles = new THREE.Mesh(mergeGeometries(geometries)!, puddle);
    puddles.receiveShadow = true;
    puddles.userData.keepDynamic = true;
    r.add(puddles);
  }

  /** Lane lines, parking bays and zebra crosswalks: one merged mesh. */
  private markings() {
    const parts: THREE.BufferGeometry[] = [];
    const stripe = (x: number, z: number, w: number, d: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.012, z);
      parts.push(g);
    };
    const inCrosswalkOrJunction = (x: number, z: number) =>
      (x > CROSS_ROAD.x - CROSS_ROAD.w / 2 - 2 && x < CROSS_ROAD.x + CROSS_ROAD.w / 2 + 2 && z > 3 && z < 15) ||
      CROSSWALKS.some((c) => Math.abs(x - c.x) < c.w / 2 + 0.6 && Math.abs(z - c.z) < c.d / 2 + 0.6);
    // Main Street centre dashes and the parking lane edge.
    const centreZ = (LANES.eastbound + LANES.westbound) / 2 + 0.05;
    for (let x = -70; x < 70; x += 4) if (!inCrosswalkOrJunction(x, centreZ)) stripe(x, centreZ, 2.2, 0.14);
    for (let x = -70; x < 70; x += 1) if (!inCrosswalkOrJunction(x, 6.15)) stripe(x, 6.15, 0.98, 0.1);
    // Parking bay ticks.
    for (let x = -23; x < 11; x += 6) if (!inCrosswalkOrJunction(x, 5)) stripe(x, 5.1, 0.1, 2.0);
    // Cross street centre dashes.
    for (let z = -50; z < 55; z += 4) if (!inCrosswalkOrJunction(CROSS_ROAD.x, z)) stripe(CROSS_ROAD.x, z, 0.14, 2.2);
    // Stop lines.
    stripe(CROSS_ROAD.x - 2, 0.8 - 0.4, 4, 0.35);
    stripe(CROSS_ROAD.x + 2, 17.2 + 0.4, 4, 0.35);
    stripe(10.2, LANES.eastbound, 0.35, 3.4);
    stripe(25.8, LANES.westbound, 0.35, 3.4);
    // Zebra crossings.
    for (const c of CROSSWALKS) {
      if (c.along === "x") for (let z = c.z - c.d / 2 + 0.5; z < c.z + c.d / 2; z += 1) stripe(c.x, z, c.w, 0.5);
      else for (let x = c.x - c.w / 2 + 0.5; x < c.x + c.w / 2; x += 1) stripe(x, c.z, 0.5, c.d);
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ color: "#e6e2d0", roughness: 0.6 }));
    mesh.receiveShadow = true;
    mesh.userData.keepDynamic = true;
    this.root.add(mesh);
  }

  /** All buildings in one mesh with one window-atlas material (vertex colours tint each). */
  private buildings() {
    const { map, emissive } = windowAtlas();
    const material = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.6,
      vertexColors: true,
      roughness: 0.86,
    });
    material.name = "building-atlas";
    const parts: THREE.BufferGeometry[] = [];
    const roofParts: THREE.BufferGeometry[] = [];
    const shopfronts = new Map<string, THREE.BufferGeometry[]>();
    let seed = 1;
    const all = [...BUILDINGS, ...BACKDROP];
    all.forEach((b, i) => {
      parts.push(buildingGeometry(b, (i * 0.37) % 1));
      if (i < BUILDINGS.length) this.collision.add({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, tag: "building" });
      // Parapet and a rooftop box or two for a varied skyline.
      const parapet = new THREE.BoxGeometry(b.w + 0.3, 0.5, b.d + 0.3);
      parapet.translate(b.x, b.h + 0.25, b.z);
      roofParts.push(parapet);
      seed = (seed * 9301 + 49297) % 233280;
      const r = seed / 233280;
      const unit = new THREE.BoxGeometry(2 + r * 2, 1.4 + r, 2);
      unit.translate(b.x + (r - 0.5) * b.w * 0.5, b.h + 1.1, b.z + (0.5 - r) * b.d * 0.4);
      roofParts.push(unit);
      // A lit ground-floor shopfront on the street-facing side.
      if (i < BUILDINGS.length && b.h > 0) {
        const facesSouth = b.z < 4; // north of Main Street → front faces +z
        const frontZ = facesSouth ? b.z + b.d / 2 + 0.06 : b.z - b.d / 2 - 0.06;
        const colors = ["#ffb35c", "#7fd6ff", "#ff7a9c", "#b8f27c", "#ffd98a"];
        const color = colors[i % colors.length];
        const glass = new THREE.BoxGeometry(b.w * 0.62, 2.3, 0.08);
        glass.translate(b.x, CURB_HEIGHT + 1.45, frontZ);
        const list = shopfronts.get(color) ?? [];
        list.push(glass);
        shopfronts.set(color, list);
        const awning = new THREE.BoxGeometry(b.w * 0.7, 0.18, 1.2);
        awning.translate(b.x, CURB_HEIGHT + 2.95, frontZ + (facesSouth ? 0.6 : -0.6));
        roofParts.push(awning);
      }
    });
    const shopfrontTexture = shopfrontGlow();
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.keepDynamic = true;
    mesh.name = "buildings";
    this.root.add(mesh);
    const roofs = new THREE.Mesh(mergeGeometries(roofParts)!, flat("#4d5050", 0.9));
    roofs.castShadow = true;
    roofs.receiveShadow = true;
    roofs.userData.keepDynamic = true;
    this.root.add(roofs);
    for (const [color, list] of shopfronts) {
      const glow = new THREE.Mesh(
        mergeGeometries(list)!,
        new THREE.MeshStandardMaterial({ color: "#1a2024", emissive: color, emissiveMap: shopfrontTexture, emissiveIntensity: 1.1, roughness: 0.2 }),
      );
      glow.userData.keepDynamic = true;
      this.root.add(glow);
    }
  }

  /** Streetlights: instanced poles, arms and glowing heads; pools of light are additive decals. */
  private streetlights() {
    const n = STREETLIGHTS.length;
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 6.4, 8), surfaces.metal, n);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 1.7), surfaces.metal, n);
    const head = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.7),
      new THREE.MeshStandardMaterial({ color: "#fff2d6", emissive: "#ffd8a0", emissiveIntensity: 5, toneMapped: false }),
      n,
    );
    const poolTexture = radialTexture("rgba(255,214,150,0.85)", "rgba(255,190,120,0)");
    const pool = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
      n,
    );
    const coneGeometry = new THREE.ConeGeometry(2.4, 6, 20, 1, true);
    coneGeometry.translate(0, -3, 0);
    const cone = new THREE.InstancedMesh(
      coneGeometry,
      new THREE.MeshBasicMaterial({ color: "#ffd9a8", transparent: true, opacity: 0.022, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      n,
    );
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3(1, 1, 1),
      p = new THREE.Vector3();
    STREETLIGHTS.forEach((l, i) => {
      const dx = Math.sin(l.facing),
        dz = Math.cos(l.facing);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.facing);
      pole.setMatrixAt(i, m.compose(p.set(l.x, CURB_HEIGHT + 3.2, l.z), q, s));
      arm.setMatrixAt(i, m.compose(p.set(l.x + dx * 0.8, CURB_HEIGHT + 6.3, l.z + dz * 0.8), q, s));
      head.setMatrixAt(i, m.compose(p.set(l.x + dx * 1.55, CURB_HEIGHT + 6.22, l.z + dz * 1.55), q, s));
      cone.setMatrixAt(i, m.compose(p.set(l.x + dx * 1.55, CURB_HEIGHT + 6.15, l.z + dz * 1.55), q, s));
      pool.setMatrixAt(i, m.compose(p.set(l.x + dx * 1.7, 0.03 + CURB_HEIGHT * 0.5, l.z + dz * 1.7), q, new THREE.Vector3(8.5, 1, 8.5)));
      this.collision.add({ x: l.x, z: l.z, w: 0.25, d: 0.25, h: 0 });
    });
    pole.castShadow = true;
    for (const im of [pole, arm, head, pool, cone]) {
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.root.add(im);
    }
    pool.renderOrder = 1;
    cone.renderOrder = 3;
  }

  /** Bins, hydrant, benches, bus stop, bollards and a few trees. Batched by world.ts. */
  private props() {
    const r = this.root;
    const green = flat("#2f5b4a", 0.6);
    const red = flat("#b8322a", 0.5);
    const wood = surfaces.wood;
    const dark = flat("#25292a", 0.6);
    const y = CURB_HEIGHT;
    const solid = (x: number, z: number, w: number, d: number) => this.collision.add({ x, z, w, d, h: 0 });
    // Litter bins.
    for (const [x, z] of [[-3.4, 3.6], [11, 3.6], [-14, 14.7], [25.2, 15]]) {
      box(r, 0.6, 0.95, 0.6, x, y + 0.48, z, green);
      box(r, 0.66, 0.08, 0.66, x, y + 0.98, z, dark);
      solid(x, z, 0.6, 0.6);
    }
    // Fire hydrant.
    const hydrant = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.75, 12), red);
    hydrant.position.set(2.8, y + 0.38, 3.65);
    hydrant.castShadow = true;
    r.add(hydrant);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), red);
    cap.position.set(2.8, y + 0.78, 3.65);
    r.add(cap);
    solid(2.8, 3.65, 0.4, 0.4);
    // Benches (one by the collector, one at the bus stop).
    const bench = (x: number, z: number, rotated: boolean) => {
      const w = rotated ? 0.55 : 1.9,
        d = rotated ? 1.9 : 0.55;
      box(r, w, 0.08, d, x, y + 0.48, z, wood);
      box(r, rotated ? 0.08 : 1.9, 0.5, rotated ? 1.9 : 0.08, x + (rotated ? 0.25 : 0), y + 0.78, z - (rotated ? 0 : 0.25), wood);
      for (const o of [-0.8, 0.8]) box(r, rotated ? 0.5 : 0.08, 0.46, rotated ? 0.08 : 0.5, x + (rotated ? 0 : o), y + 0.23, z + (rotated ? o : 0), dark);
      solid(x, z, w, d);
    };
    bench(6.6, 0.75, false);
    bench(-12, 17.3, false);
    // Bus stop shelter on the south sidewalk.
    const glass = new THREE.MeshStandardMaterial({ color: "#9fc3d0", transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false });
    box(r, 4.2, 0.12, 1.7, -12, y + 2.6, 17.1, dark);
    box(r, 4, 2.4, 0.04, -12, y + 1.35, 17.95, glass, {});
    box(r, 0.04, 2.4, 1.5, -14, y + 1.35, 17.2, glass, {});
    for (const x of [-14, -10]) box(r, 0.1, 2.6, 0.1, x, y + 1.3, 17.95, dark);
    const ad = box(r, 0.06, 2.0, 1.3, -10, y + 1.3, 17.2, new THREE.MeshStandardMaterial({ color: "#222", emissive: "#e8f0ff", emissiveIntensity: 0.0 }));
    ad.material = new THREE.MeshStandardMaterial({
      map: canvasTexture(256, 400, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "#ff6f59");
        g.addColorStop(1, "#2b59c3");
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.fillStyle = "#fff8e8";
        c.font = '700 54px "Space Grotesk", sans-serif';
        c.textAlign = "center";
        c.fillText("LISTEN", w / 2, h * 0.42);
        c.fillText("LOCAL", w / 2, h * 0.58);
        c.font = '500 26px "Space Grotesk", sans-serif';
        c.fillText("miso records ↗", w / 2, h * 0.8);
      }),
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
    });
    (ad.material as THREE.MeshStandardMaterial).emissiveMap = (ad.material as THREE.MeshStandardMaterial).map;
    ad.userData.keepDynamic = true;
    solid(-12, 17.95, 4.2, 0.3);
    solid(-14, 17.2, 0.3, 1.6);
    // Bollards at the corners.
    for (const [x, z] of [[13.4, 3.5], [13.4, 14.6], [22.6, 3.5], [22.6, 14.6]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 10), flat("#c9a227", 0.5));
      b.position.set(x, y + 0.45, z);
      r.add(b);
      solid(x, z, 0.25, 0.25);
    }
    // Street trees in grates.
    const trunk = flat("#4a3a2c", 0.9);
    const leaves = [flat("#3f6b45", 0.9), flat("#557a3e", 0.9)];
    for (const [x, z] of [[-29, 15.4], [-19.5, 15.4], [-2, 15.4], [6, 15.4], [27, 15.4], [-21.5, 3.2]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 3, 8), trunk);
      t.position.set(x, y + 1.5, z);
      t.castShadow = true;
      r.add(t);
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25 - k * 0.2, 0), leaves[k % 2]);
        c.position.set(x + (k - 1) * 0.5, y + 3.4 + k * 0.6, z + ((k * 7) % 3 - 1) * 0.3);
        c.castShadow = true;
        r.add(c);
      }
      box(r, 1.2, 0.03, 1.2, x, y + 0.01, z, dark);
      solid(x, z, 0.4, 0.4);
    }
  }

  private drops = new Float32Array(0);
  private makeRain() {
    const count = 1400;
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.drops.set([(Math.random() - 0.5) * 36, Math.random() * 14, (Math.random() - 0.5) * 36], i * 3);
    const positions = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: "#b9cdd8", transparent: true, opacity: 0.32, depthWrite: false }),
    );
    lines.frustumCulled = false;
    return { lines, positions };
  }

  /** Rain falls in a box that wraps around the camera, and is never drawn inside the shop. */
  update(dt: number, camera: THREE.Camera) {
    const d = this.drops,
      p = this.rainPositions;
    const cx = camera.position.x,
      cz = camera.position.z;
    for (let i = 0, j = 0; i < d.length; i += 3, j += 6) {
      let x = d[i],
        y = d[i + 1] - dt * 11,
        z = d[i + 2];
      if (x - cx > 18) x -= 36;
      else if (cx - x > 18) x += 36;
      if (z - cz > 18) z -= 36;
      else if (cz - z > 18) z += 36;
      if (y < 0) y += 14;
      d[i] = x;
      d[i + 1] = y;
      d[i + 2] = z;
      const drawY = inShop(x, z) ? -50 : y;
      p[j] = x;
      p[j + 1] = drawY;
      p[j + 2] = z;
      p[j + 3] = x - 0.04;
      p[j + 4] = drawY - 0.32;
      p[j + 5] = z;
    }
    this.rain.geometry.getAttribute("position").needsUpdate = true;
  }
}

/** Facade atlas: 4 bays × 4 floors of windows. `map` is the wall/glass, `emissive` the lit windows. */
function windowAtlas() {
  const size = 512,
    cell = 128;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lit: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = rand();
    lit.push(r < 0.3 ? "#ffc982" : r < 0.42 ? "#ffe2b0" : r < 0.52 ? "#a9d8ff" : r < 0.56 ? "#ff9fb3" : "");
  }
  const map = canvasTexture(size, size, (c) => {
    c.fillStyle = "#d9d4ca";
    c.fillRect(0, 0, size, size);
    // Subtle brick/concrete noise.
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
      c.fillRect(rand() * size, rand() * size, 6 + rand() * 10, 3);
    }
    for (let fy = 0; fy < 4; fy++) {
      c.fillStyle = "rgba(0,0,0,0.18)";
      c.fillRect(0, fy * cell + cell - 10, size, 6); // floor ledge
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * cell + 26,
          y = fy * cell + 22;
        c.fillStyle = "#8c8a86";
        c.fillRect(x - 5, y - 5, 86, 86);
        c.fillStyle = lit[fy * 4 + bx] ? "#5b4a36" : "#1d2730";
        c.fillRect(x, y, 76, 76);
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.fillRect(x, y, 76, 22);
        c.fillStyle = "#8c8a86";
        c.fillRect(x + 36, y, 4, 76);
      }
    }
  });
  const emissive = canvasTexture(size, size, (c) => {
    c.fillStyle = "#000";
    c.fillRect(0, 0, size, size);
    for (let fy = 0; fy < 4; fy++)
      for (let bx = 0; bx < 4; bx++) {
        const color = lit[fy * 4 + bx];
        if (!color) continue;
        const x = bx * cell + 26,
          y = fy * cell + 22;
        const g = c.createLinearGradient(0, y, 0, y + 76);
        g.addColorStop(0, color);
        g.addColorStop(1, "#4a3420");
        c.fillStyle = g;
        c.fillRect(x, y, 76, 76);
        c.fillStyle = "#000";
        c.fillRect(x + 36, y, 4, 76);
        // A drawn blind on some windows.
        if ((fy + bx) % 3 === 0) {
          c.fillStyle = "rgba(0,0,0,0.55)";
          c.fillRect(x, y, 76, 30);
        }
      }
  });
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissive };
}

/** A box with facade UVs (2.5 m bays, 3 m floors; 4 × 4 per atlas tile), vertex-colour tint, flat roof. */
function buildingGeometry(b: BuildingSpec, uOffset: number) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  g.translate(b.x, b.h / 2, b.z);
  const pos = g.getAttribute("position"),
    normal = g.getAttribute("normal"),
    uv = g.getAttribute("uv");
  const colors = new Float32Array(pos.count * 3);
  const tint = new THREE.Color(b.tint);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const nx = normal.getX(i),
      ny = normal.getY(i);
    if (Math.abs(ny) > 0.5) uv.setXY(i, 0.01, 0.995); // roof: a plain wall texel
    else {
      const along = Math.abs(nx) > 0.5 ? z - (b.z - b.d / 2) : x - (b.x - b.w / 2);
      uv.setXY(i, along / 10 + uOffset, (y - 0.4) / 12);
    }
    const shade = Math.abs(ny) > 0.5 ? 0.55 : 1;
    colors.set([tint.r * shade, tint.g * shade, tint.b * shade], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A lit shop window seen from the street: warm gradient, mullions, shelf silhouettes. */
function shopfrontGlow() {
  return canvasTexture(256, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#9a9a9a");
    g.addColorStop(0.5, "#ffffff");
    g.addColorStop(1, "#6a6a6a");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.55)";
    for (let i = 0; i < 6; i++) c.fillRect(10 + i * 42, 70 + (i % 2) * 8, 26, 58);
    c.fillRect(0, 44, w, 4);
    c.fillStyle = "#000";
    for (let x = 0; x <= w; x += w / 4) c.fillRect(x - 3, 0, 6, h);
    c.fillRect(0, 0, w, 6);
  });
}

function radialTexture(inner: string, outer: string) {
  return canvasTexture(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, "0.35)"));
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}
