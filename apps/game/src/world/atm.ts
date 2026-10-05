/**
 * The FakeUSD ATM: a small street kiosk outside the shop (the testnet faucet, in-world).
 *
 * Owns: the kiosk mesh (body, lit screen, "FakeUSD ATM" topper, cash slot), its
 * collision box and the "atm" interactable.
 * Must not: know about money or the faucet; pressing E is reported like any other
 * interactable and the game layer (flows/atm-flow.ts) decides what it means.
 *
 * Cost: a handful of draw calls. Plain parts use cached flat() materials and are
 * merged by material; the screen and topper are two canvas-texture signs.
 */
import * as THREE from "three";
import { Collision } from "./collision";
import { Interactables } from "./interactables";
import { ATM, CURB_HEIGHT } from "./layout";
import { batchStaticGeometry, box, flat } from "./materials";
import { signMesh } from "./labels";

const BODY = flat("#1f4f6e", 0.45);
const TRIM = flat("#1b1f1e", 0.5);
const STEEL = flat("#c9cdd1", 0.4);
const SLOT = flat("#2a1a05", 0.6, "#ffb35c", 2.2);

const HEIGHT = 1.95;

export class Atm {
  readonly root = new THREE.Group();

  constructor(scene: THREE.Scene, collision: Collision, interactables: Interactables) {
    this.root.name = "atm";
    this.root.position.set(ATM.x, CURB_HEIGHT, ATM.z);
    scene.add(this.root);
    this.build();
    batchStaticGeometry(this.root);
    collision.add({ x: ATM.x, z: ATM.z, w: ATM.w + 0.06, d: ATM.d + 0.06, h: HEIGHT, tag: "atm" });
    interactables.register({ id: "atm", kind: "atm", x: ATM.interactX, z: ATM.interactZ, radius: 1.5 });
  }

  /** Built in local space: +z faces the street (the player's side). */
  private build() {
    const r = this.root;
    const w = ATM.w,
      d = ATM.d,
      front = d / 2;
    // Plinth, body, and a darker inset fascia around the screen.
    box(r, w + 0.06, 0.1, d + 0.06, 0, 0.05, 0, TRIM);
    box(r, w, 1.5, d, 0, 0.85, 0, BODY);
    box(r, w - 0.12, 0.62, 0.03, 0, 1.25, front + 0.015, TRIM, {});
    // Lit screen.
    const screen = signMesh("FakeUSD", 0.56, 0.38, { bg: "#062018", ink: "#59f0b8", glow: 2.2, sub: "CASH · 24 HRS", scale: 0.4 });
    screen.position.set(0, 1.27, front + 0.036);
    r.add(screen);
    // Sloped keypad shelf and the cash slot below it.
    const shelf = box(r, w - 0.1, 0.05, 0.22, 0, 0.88, front + 0.09, STEEL);
    shelf.rotation.x = 0.3;
    box(r, 0.42, 0.045, 0.02, 0, 0.66, front + 0.01, SLOT, {});
    // Topper: a lit "FakeUSD ATM" sign on a header box, readable from the spawn.
    box(r, w + 0.1, 0.36, d + 0.04, 0, 1.6 + 0.18, 0, TRIM);
    const topper = signMesh("FakeUSD ATM", w + 0.04, 0.3, { bg: "#141b19", ink: "#ffd08a", glow: 1.8, border: "#ffb35c" });
    topper.position.set(0, 1.78, front + 0.025);
    r.add(topper);
  }
}
