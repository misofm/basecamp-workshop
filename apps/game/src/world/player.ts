/**
 * The player: animated character, walking, third-person camera and input.
 *
 * Owns: the Mixamo character (idle/walk/run), WASD movement relative to the camera
 * (Shift jogs), collision sliding, the follow camera with camera collision, keyboard
 * camera (arrows orbit, + / − zoom, Home resets), optional mouse look (L or drag),
 * the procedural overhead record swing, camera shake, and where the held record sits.
 * Must not: decide what interactions mean or know about records' data; E/Enter are
 * handled by world.ts so this module only ever moves the body and the camera.
 */
import * as THREE from "three";
import { Collision, type Obstacle } from "./collision";
import { loadCharacter, makeCharacter, rotateBoneAboutWorldAxis, type Character } from "./characters";
import { DOOR, groundHeight, inShop, SHOP_FLOOR_Y, SHOP_INTERIOR } from "./layout";
import { DISPLAY_SCALE } from "./record-item";

const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
const DEFAULT_PITCH = 0.14;
const DEFAULT_DISTANCE = 4.6;
const WALK_SPEED = 3.2;
const RUN_SPEED = 6;

interface Swing {
  t: number;
  duration: number;
  targetHeading: number;
  impacted: boolean;
  onImpact: () => void;
}

export class Player {
  readonly root = new THREE.Group();
  character?: Character;
  heading = 0;
  /** Camera orbit around the player (0 = camera south of the player, looking north). */
  yaw = 0;
  pitch = DEFAULT_PITCH;
  distance = DEFAULT_DISTANCE;
  blocked = false;
  moving = false;
  running = false;
  /** Set during a frame when the player pushed into the blocked shop doorway. */
  bumpedDoor = false;
  private keys = new Set<string>();
  private active?: THREE.AnimationAction;
  private swing: Swing | null = null;
  private swingAngle = 0;
  private shakeAmount = 0;
  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private cameraRay = new THREE.Raycaster();
  private fallback: THREE.Group;
  private hit = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private collision: Collision,
    private canvas: HTMLCanvasElement,
  ) {
    this.root.name = "player";
    this.fallback = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: "#d9b26a" }));
    body.position.y = 0.85;
    body.castShadow = true;
    this.fallback.add(body);
    this.root.add(this.fallback);
    scene.add(this.root);
    void loadCharacter("male")
      .then((template) => {
        const c = makeCharacter("male", template, undefined, true);
        this.character = c;
        this.root.add(c.root);
        this.fallback.visible = false;
        this.active = c.actions.Idle;
        this.active?.play();
        document.documentElement.dataset.character = "ready";
      })
      .catch(() => {
        document.documentElement.dataset.character = "fallback";
      });
    this.bindInput();
  }

  get position() {
    return this.root.position;
  }

  teleport(x: number, z: number, heading?: number) {
    this.root.position.set(x, groundHeight(x, z), z);
    if (heading !== undefined) {
      this.heading = heading;
      this.yaw = heading - Math.PI;
    }
    this.root.rotation.y = this.heading;
    this.snapCamera = true;
  }
  private snapCamera = true;

  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    this.keys.clear();
    this.dragging = false;
    if (blocked && document.pointerLockElement) document.exitPointerLock();
  }

  shake(amount: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  /** Turn to face (x, z) and swing the held record overhead. Resolves at the moment of impact. */
  swingAt(x: number, z: number): Promise<void> {
    const p = this.root.position;
    const targetHeading = Math.atan2(x - p.x, z - p.z);
    return new Promise((resolve) => {
      if (this.swing && !this.swing.impacted) this.swing.onImpact();
      this.swing = { t: 0, duration: 0.62, targetHeading, impacted: false, onImpact: resolve };
    });
  }
  get swinging() {
    return this.swing !== null;
  }

  update(dt: number, elapsed: number) {
    this.bumpedDoor = false;
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    let dx = 0,
      dz = 0;
    const running = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    if (!this.blocked) {
      this.yaw += dt * 1.6 * (k("ArrowLeft") - k("ArrowRight"));
      this.pitch = THREE.MathUtils.clamp(this.pitch + dt * 0.8 * (k("ArrowDown") - k("ArrowUp")), -0.15, 0.85);
      if (!this.swing) {
        const h = k("KeyD") - k("KeyA");
        const v = k("KeyS") - k("KeyW");
        dx = h * Math.cos(this.yaw) + v * Math.sin(this.yaw);
        dz = -h * Math.sin(this.yaw) + v * Math.cos(this.yaw);
      }
    }
    const p = this.root.position;
    const length = Math.hypot(dx, dz);
    let moved = false;
    if (length > 0.01) {
      dx /= length;
      dz /= length;
      const step = (running ? RUN_SPEED : WALK_SPEED) * dt;
      const tryAxis = (nx: number, nz: number) => {
        const o: Obstacle | null = this.collision.hit(nx, nz);
        if (!o) {
          p.x = nx;
          p.z = nz;
          return true;
        }
        if (o.tag === "door") this.bumpedDoor = true;
        return false;
      };
      if (!tryAxis(p.x + dx * step, p.z + dz * step)) {
        moved = tryAxis(p.x + dx * step, p.z) || tryAxis(p.x, p.z + dz * step);
      } else moved = true;
      const target = Math.atan2(dx, dz);
      this.heading += angleDelta(this.heading, target) * Math.min(dt * 12, 1);
    }
    if (this.swing) {
      this.heading += angleDelta(this.heading, this.swing.targetHeading) * Math.min(dt * 18, 1);
    }
    this.moving = moved;
    this.running = moved && running;
    this.root.rotation.y = this.heading;
    p.y = THREE.MathUtils.lerp(p.y, groundHeight(p.x, p.z), 1 - Math.exp(-dt * 18));
    if (!this.character) this.fallback.position.y = moved ? Math.abs(Math.sin(elapsed * 10)) * 0.04 : 0;
    this.animate(dt);
  }

  /** Swing timing runs even before the character model has loaded, so the promise always resolves. */
  private swingPhase(dt: number) {
    this.swingAngle = 0;
    this.swingLean = 0;
    const s = this.swing;
    if (!s) return;
    s.t += dt;
    const u = s.t / s.duration;
    const impactAt = 0.62;
    if (u < 0.42) {
      this.swingAngle = -3.25 * easeOut(u / 0.42); // raise the record overhead
      this.swingLean = -0.2 * easeOut(u / 0.42); // lean back on the wind-up
    } else if (u < impactAt) {
      const k = easeIn((u - 0.42) / (impactAt - 0.42));
      this.swingAngle = -3.25 + 2.35 * k; // bring it down hard
      this.swingLean = -0.2 + 0.55 * k; // lean into the hit
    } else {
      const k = 1 - easeOut((u - impactAt) / (1 - impactAt));
      this.swingAngle = -0.9 * k; // recover
      this.swingLean = 0.35 * k;
    }
    if (!s.impacted && u >= impactAt) {
      s.impacted = true;
      this.shake(0.12);
      s.onImpact();
    }
    if (u >= 1) this.swing = null;
  }
  private swingLean = 0;

  private animate(dt: number) {
    this.swingPhase(dt);
    const c = this.character;
    if (!c) return;
    const name = this.moving ? (this.running ? "Run" : "Walk") : "Idle";
    const next = c.actions[name];
    if (next && next !== this.active) {
      this.active?.fadeOut(0.2);
      next.reset().fadeIn(0.2).play();
      this.active = next;
    }
    c.mixer.update(dt);
    // Procedural overhead swing, layered on top of whatever clip is playing
    // (the Mixamo clips have no swing, so the arm and spine are rotated additively).
    if (this.swingAngle !== 0 || this.swingLean !== 0) {
      c.model.updateMatrixWorld(true);
      const right = AXIS.set(1, 0, 0).applyQuaternion(this.root.quaternion); // character's local +x axis in world space
      rotateBoneAboutWorldAxis(c.bones.spine, right, this.swingLean);
      rotateBoneAboutWorldAxis(c.bones.rightArm, right, this.swingAngle);
      rotateBoneAboutWorldAxis(c.bones.rightForeArm, right, this.swingAngle * -0.15);
    }
    c.model.updateMatrixWorld(true);
  }

  /** World matrix for a record held in the right hand (record-item Holder). */
  holdMatrix = (out: THREE.Matrix4) => {
    const hand = this.character?.bones.rightHand;
    if (!hand) return false;
    hand.getWorldPosition(HAND);
    const q = Q.copy(this.root.quaternion).multiply(Q2.setFromAxisAngle(X, this.swingAngle));
    // Hang the sleeve just below the grip, cover turned out to the side and back toward the camera.
    OFFSET.set(-0.04, -0.2, 0.02).applyQuaternion(q);
    HAND.add(OFFSET);
    q.multiply(Q2.setFromEuler(E.set(0.12, -2.1, 0.0)));
    out.compose(HAND, q, S.setScalar(DISPLAY_SCALE));
    return this.root.visible;
  };

  /** Third-person follow camera with collision. Call after update(). */
  updateCamera(dt: number) {
    const p = this.root.position;
    // Indoors (for the camera) = in the shop, except right in the doorway gap, where the
    // camera may still look in from the street through the open door.
    const inDoorway = Math.abs(p.x - DOOR.x) < DOOR.halfWidth + 0.2 && p.z > DOOR.wallMinZ - 0.9;
    const indoors = inShop(p.x, p.z) && !inDoorway;
    const anchor = ANCHOR.set(p.x + Math.cos(this.yaw) * 0.45, p.y + 1.6, p.z - Math.sin(this.yaw) * 0.45);
    if (indoors) clampIndoors(anchor, 0.35);
    // The over-the-shoulder offset must not start inside a wall (e.g. at the door frame),
    // or that wall would be skipped by the ray test: fall back to the player's centre.
    if (this.collision.camera().some((b) => b.containsPoint(anchor))) anchor.set(p.x, p.y + 1.6, p.z);
    let free = this.castCamera(anchor, this.pitch, indoors, SAFE);
    // Cramped (back to a wall, just inside the door)? Rather than jamming the camera into
    // the back of the player's head, rise up and look down from above.
    // Take the lowest pitch that gives enough room (the steepest only as a last resort).
    // Outdoors there is no ceiling to look down from, so it only goes moderately high.
    const enough = this.distance * 0.5;
    if (free < enough) {
      for (const pitch of indoors ? [0.5, 0.85, 1.2, 1.45] : [0.5, 0.85]) {
        if (pitch <= this.pitch) continue;
        const high = this.castCamera(anchor, pitch, indoors, SAFE_HIGH);
        if (high > free + 0.3) {
          SAFE.copy(SAFE_HIGH);
          free = high;
        }
        if (free >= enough) break;
      }
    }
    const safe = SAFE;
    if (this.snapCamera) {
      this.camera.position.copy(safe);
      this.snapCamera = false;
    } else {
      // Pull in fast (never sit behind a wall), ease back out slowly.
      const pullingIn = safe.distanceTo(anchor) < this.camera.position.distanceTo(anchor) - 0.05;
      this.camera.position.lerp(safe, 1 - Math.exp(-dt * (pullingIn ? 28 : 8)));
    }
    // Indoors the camera never leaves the room, even mid-lerp (no peeking through the doorway or walls).
    if (indoors) clampIndoors(this.camera.position, 0.25);
    this.camera.lookAt(anchor);
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.3;
      this.shakeAmount *= Math.exp(-dt * 7);
    }
  }

  /**
   * Cast from the anchor to where the camera wants to be at `pitch`; writes the collision-
   * safe position to `out` and returns its distance from the anchor.
   */
  private castCamera(anchor: THREE.Vector3, pitch: number, indoors: boolean, out: THREE.Vector3) {
    const offset = OFFSET2.set(
      Math.sin(this.yaw) * this.distance * Math.cos(pitch),
      0.35 + Math.sin(pitch) * this.distance,
      Math.cos(this.yaw) * this.distance * Math.cos(pitch),
    );
    const desired = DESIRED.copy(anchor).add(offset);
    desired.y = THREE.MathUtils.clamp(desired.y, 0.7, indoors ? CEILING_Y - 0.4 : 12);
    const direction = DIR.copy(desired).sub(anchor);
    let length = direction.length();
    direction.normalize();
    this.cameraRay.set(anchor, direction);
    for (const box of this.collision.camera()) {
      if (this.cameraRay.ray.intersectBox(box, this.hit)) {
        const d = this.hit.distanceTo(anchor);
        if (d < length) length = Math.max(0.35, d - 0.18);
      }
    }
    // Indoors, the doorway counts as wall: stop at the inside face of the shopfront.
    if (indoors && direction.z > 1e-4) {
      const d = (INSIDE_FRONT_Z - anchor.z) / direction.z;
      if (d < length) length = Math.max(0.35, d);
    }
    out.copy(anchor).addScaledVector(direction, length);
    return length;
  }

  resetCamera() {
    this.yaw = this.heading - Math.PI;
    this.pitch = DEFAULT_PITCH;
    this.distance = DEFAULT_DISTANCE;
  }

  toggleMouseLook() {
    if (document.pointerLockElement) document.exitPointerLock();
    else void this.canvas.requestPointerLock?.()?.catch(() => {});
  }

  private bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.blocked) return;
      if (MOVE_KEYS.includes(e.code)) {
        e.preventDefault();
        this.keys.add(e.code);
      }
      if (e.code === "Home") {
        e.preventDefault();
        this.resetCamera();
      }
      if (e.code === "Equal" || e.code === "Minus" || e.code === "NumpadAdd" || e.code === "NumpadSubtract") {
        e.preventDefault();
        const closer = e.code === "Equal" || e.code === "NumpadAdd";
        this.distance = THREE.MathUtils.clamp(this.distance + (closer ? -0.3 : 0.3), 1.8, 7);
      }
      if (e.code === "KeyL" && !e.repeat) this.toggleMouseLook();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.dragging = false;
    });
    document.addEventListener("visibilitychange", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== this.canvas || this.blocked) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.002, -0.15, 0.85);
    });
    document.addEventListener("pointerlockchange", () => {
      document.documentElement.dataset.mouseLook = String(document.pointerLockElement === this.canvas);
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.blocked || document.pointerLockElement === this.canvas) return;
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging || this.blocked) return;
      const dx = e.clientX - this.lastPointer.x,
        dy = e.clientY - this.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      if (this.dragMoved) {
        this.yaw -= dx * 0.005;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, -0.15, 0.85);
      }
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    const endDrag = () => (this.dragging = false);
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.008, 1.8, 7);
      },
      { passive: false },
    );
  }
}

function angleDelta(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
/** Inside face of the shop's front wall, and the ceiling height (camera limits indoors). */
const INSIDE_FRONT_Z = DOOR.wallMinZ - 0.15;
const CEILING_Y = SHOP_FLOOR_Y + 4.45;
/** Keep a point inside the shop's room volume, `margin` metres from the walls. */
function clampIndoors(v: THREE.Vector3, margin: number) {
  v.x = THREE.MathUtils.clamp(v.x, SHOP_INTERIOR.minX + margin, SHOP_INTERIOR.maxX - margin);
  v.z = THREE.MathUtils.clamp(v.z, SHOP_INTERIOR.minZ + margin, INSIDE_FRONT_Z - margin * 0.5);
  v.y = Math.min(v.y, CEILING_Y - margin);
}
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeIn = (t: number) => Math.pow(Math.min(1, Math.max(0, t)), 2);

const AXIS = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const HAND = new THREE.Vector3();
const OFFSET = new THREE.Vector3();
const OFFSET2 = new THREE.Vector3();
const ANCHOR = new THREE.Vector3();
const DESIRED = new THREE.Vector3();
const DIR = new THREE.Vector3();
const SAFE = new THREE.Vector3();
const SAFE_HIGH = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E = new THREE.Euler();
