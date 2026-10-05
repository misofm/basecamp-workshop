/**
 * Interactables: the registry of everything the player can press E on, plus proximity.
 *
 * Owns: registering interactables (records, deck, cashier, cars, buyer), enabling and
 * disabling them, finding the nearest enabled one within its radius each frame, and a
 * small ground ring that marks it.
 * Must not: interpret an interaction; it only reports "near X" and "pressed E at X"
 * (world.ts forwards those to the game layer's onNear / onInteract).
 */
import * as THREE from "three";
import type { Interactable } from "./api";

export class Interactables {
  private byId = new Map<string, Interactable>();
  nearest: Interactable | null = null;
  readonly ring: THREE.Mesh;
  private time = 0;
  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.55, 48),
      new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    scene.add(this.ring);
  }
  register(i: Omit<Interactable, "enabled"> & { enabled?: boolean }) {
    const full: Interactable = { ...i, enabled: i.enabled ?? true };
    this.byId.set(full.id, full);
    return full;
  }
  get(id: string) {
    return this.byId.get(id);
  }
  all() {
    return [...this.byId.values()];
  }
  setEnabled(id: string, enabled: boolean) {
    const i = this.byId.get(id);
    if (i) i.enabled = enabled;
  }
  move(id: string, x: number, z: number) {
    const i = this.byId.get(id);
    if (i) {
      i.x = x;
      i.z = z;
    }
  }
  /** Recompute the nearest enabled interactable; returns true if it changed. */
  update(dt: number, x: number, z: number, groundY: number) {
    let best: Interactable | null = null;
    let bestDistance = Infinity;
    for (const i of this.byId.values()) {
      if (!i.enabled) continue;
      const d = Math.hypot(x - i.x, z - i.z);
      if (d <= i.radius && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    this.time += dt;
    this.ring.visible = best !== null;
    if (best) {
      this.ring.position.set(best.x, groundY + 0.03, best.z);
      this.ring.scale.setScalar(1 + Math.sin(this.time * 5) * 0.06);
    }
    const changed = best !== this.nearest;
    this.nearest = best;
    return changed;
  }
}
