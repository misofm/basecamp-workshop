/**
 * Procedural car geometry shared by moving traffic (traffic.ts) and parked cars (cars.ts).
 *
 * Owns: low-poly car part geometries in a car-local frame (forward = +z, y = 0 at the
 * tyres' contact patch) and a few shared materials. Built once, reused by every car.
 * Must not: create scene objects, animate, or know which cars exist.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const CAR_LENGTH = 4.2;
export const CAR_WIDTH = 1.8;

function part(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  g.translate(x, y, z);
  return g.index ? g.toNonIndexed() : g;
}

/** Lower body (subdivided so it can be dented) + roof. Painted. */
export function bodyGeometry() {
  const lower = new THREE.BoxGeometry(CAR_WIDTH, 0.62, CAR_LENGTH, 6, 2, 12);
  // Round the nose and tail a little.
  const p = lower.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i),
      y = p.getY(i);
    const end = Math.abs(z) / (CAR_LENGTH / 2);
    if (end > 0.85 && y > 0) p.setY(i, y - (end - 0.85) * 0.6);
    p.setX(i, p.getX(i) * (1 - Math.max(0, end - 0.9) * 0.6));
  }
  lower.computeVertexNormals();
  const roof = new THREE.BoxGeometry(1.5, 0.07, 1.75);
  return mergeGeometries([part(lower, 0, 0.66, 0), part(roof, 0, 1.47, -0.3)])!;
}

/** The greenhouse: one tapered glass shell (separate mesh so it can shatter). */
export function glassGeometry() {
  const g = new THREE.BoxGeometry(1.62, 0.52, 2.3, 1, 1, 1);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * 0.9);
      p.setZ(i, p.getZ(i) * 0.74 - 0.12);
    }
  }
  g.computeVertexNormals();
  g.translate(0, 1.2, -0.2);
  return g;
}

/** Wheels and bumpers. Dark trim. */
export function trimGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.82, 0.82])
    for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
      wheel.rotateZ(Math.PI / 2);
      parts.push(part(wheel, x, 0.34, z));
    }
  parts.push(part(new THREE.BoxGeometry(CAR_WIDTH + 0.04, 0.16, 0.18), 0, 0.42, CAR_LENGTH / 2));
  parts.push(part(new THREE.BoxGeometry(CAR_WIDTH + 0.04, 0.16, 0.18), 0, 0.42, -CAR_LENGTH / 2));
  return mergeGeometries(parts)!;
}

export function headlightGeometry() {
  return mergeGeometries([-0.6, 0.6].map((x) => part(new THREE.BoxGeometry(0.36, 0.14, 0.05), x, 0.78, CAR_LENGTH / 2 - 0.05)))!;
}
export function taillightGeometry() {
  return mergeGeometries([-0.62, 0.62].map((x) => part(new THREE.BoxGeometry(0.34, 0.12, 0.05), x, 0.82, -CAR_LENGTH / 2 + 0.06)))!;
}
/** Four corner indicator lamps (hazard lights). */
export function indicatorGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.86, 0.86])
    for (const z of [-CAR_LENGTH / 2 + 0.08, CAR_LENGTH / 2 - 0.08]) parts.push(part(new THREE.BoxGeometry(0.16, 0.14, 0.08), x * 1.01, 0.68, z * 1.01));
  return mergeGeometries(parts)!;
}

export const carMaterials = {
  glass: new THREE.MeshStandardMaterial({ color: "#1b2a33", roughness: 0.08, metalness: 0.6 }),
  trim: new THREE.MeshStandardMaterial({ color: "#151819", roughness: 0.8 }),
  headlight: new THREE.MeshStandardMaterial({ color: "#fff8e0", emissive: "#fff2cc", emissiveIntensity: 4, toneMapped: false }),
  taillight: new THREE.MeshStandardMaterial({ color: "#ff3030", emissive: "#ff1a1a", emissiveIntensity: 3, toneMapped: false }),
  lampOff: new THREE.MeshStandardMaterial({ color: "#d8d2c0", roughness: 0.3 }),
  tailOff: new THREE.MeshStandardMaterial({ color: "#6a1a1a", roughness: 0.3 }),
};

export const CAR_COLORS = ["#c23b3b", "#2f6fb5", "#e3c04f", "#e8e6df", "#3d8a6b", "#7a4fb0", "#1f2326", "#d97a2b"];
