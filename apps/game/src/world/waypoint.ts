/**
 * Waypoint: the GTA-style floating marker over the current objective.
 *
 * Owns: a bobbing, spinning chevron and a translucent light column, both visible from
 * across the street (no fog, additive column), shown at a target or hidden.
 * Must not: choose the target; the game layer passes it via WorldApi.setWaypoint.
 */
import * as THREE from "three";
import { groundHeight } from "./layout";

export class Waypoint {
  readonly root = new THREE.Group();
  target: { x: number; z: number } | null = null;
  private chevron: THREE.Mesh;
  private time = 0;
  constructor(scene: THREE.Scene) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.55, 0.45);
    shape.lineTo(0, -0.25);
    shape.lineTo(0.55, 0.45);
    shape.lineTo(0.3, 0.45);
    shape.lineTo(0, 0.08);
    shape.lineTo(-0.3, 0.45);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
    geometry.translate(0, 0, -0.08);
    this.chevron = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: "#ffd23f", emissive: "#ffc21a", emissiveIntensity: 2.2, toneMapped: false, fog: false }),
    );
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.6, 8, 24, 1, true).translate(0, 4, 0),
      new THREE.MeshBasicMaterial({
        color: "#ffd23f",
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.75, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    disc.position.y = 0.03;
    column.renderOrder = 5;
    // A second, crossed copy so the spinning chevron is never seen edge-on.
    const cross = new THREE.Mesh(geometry, this.chevron.material);
    cross.rotation.y = Math.PI / 2;
    this.chevron.add(cross);
    this.root.add(column, disc, this.chevron);
    this.root.visible = false;
    this.root.userData.keepDynamic = true;
    scene.add(this.root);
  }
  set(target: { x: number; z: number } | null) {
    this.target = target ? { x: target.x, z: target.z } : null;
    this.root.visible = target !== null;
    if (target) this.root.position.set(target.x, groundHeight(target.x, target.z), target.z);
  }
  update(dt: number, camera: THREE.Camera) {
    if (!this.root.visible) return;
    this.time += dt;
    this.chevron.position.y = 2.9 + Math.sin(this.time * 2.6) * 0.18;
    this.chevron.rotation.y += dt * 1.8;
    // Grow a little with distance so it stays visible across the map.
    const d = camera.position.distanceTo(this.root.position);
    this.chevron.scale.setScalar(THREE.MathUtils.clamp(d / 8, 1.2, 3));
  }
}
