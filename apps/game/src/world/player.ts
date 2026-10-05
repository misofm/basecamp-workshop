/**
 * The player: animated character, walking, third-person camera and input.
 *
 * Owns: the player's Tamashi (CAST.player, src/tamashi/) and its per-frame animation
 * inputs (speed, carry, the procedural overhead record swing), WASD movement relative to the camera
 * (Shift jogs), collision sliding, the follow camera with camera collision, keyboard
 * camera (arrows orbit, + / − zoom, Home resets), optional mouse look (L or drag),
 * the swing timing, camera shake, and where the held record sits (the Tamashi's right hand).
 * Space jumps (vertical physics in jump.ts; collision stays 2D, so a jump never clears a
 * wall, car or shelf) and feeds the Tamashi's jump pose (crouch, airborne, land()).
 * Must not: decide what interactions mean or know about records' data; E/Enter are
 * handled by world.ts so this module only ever moves the body and the camera.
 */
import * as THREE from "three";
import { Collision, type Obstacle } from "./collision";
import { DOOR, groundHeight, inShop, SHOP_FLOOR_Y, SHOP_INTERIOR } from "./layout";
import { createTamashi, type TamashiCharacter } from "../tamashi/character";
import { cancelJump, initialJump, JUMP_CROUCH, JUMP_SPEED, requestJump, resetJump, stepJump } from "./jump";
import { CAST } from "../tamashi/cast";

const MOVE_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];
const DEFAULT_PITCH = 0.14;
const DEFAULT_DISTANCE = 4.6;
const WALK_SPEED = 3.2;
const RUN_SPEED = 6;
/** Mid-air steering rate (1/s): the body keeps its momentum and turns toward the input slowly. */
const AIR_CONTROL = 4;
/** While airborne the camera follows this share of the jump height (the rest stays smooth). */
const CAMERA_JUMP_FOLLOW = 0.45;

interface Swing {
  t: number;
  duration: number;
  targetHeading: number;
  impacted: boolean;
  onImpact: () => void;
}

export class Player {
  /** The Tamashi's own root: the player moves and turns it directly (no wrapper group). */
  readonly root: THREE.Group;
  readonly character: TamashiCharacter;
  /** Holding a record (world.ts sets it from setRecordPlace): eases the carry pose in/out. */
  carrying = false;
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
  /** False while a chain transaction is pending (world.setJumpAllowed). */
  jumpAllowed = true;
  /** Vertical physics (jump.ts). */
  readonly jumpState = initialJump(0);
  /** Horizontal velocity, m/s: carried through the air so a jump keeps its momentum. */
  private vel = { x: 0, z: 0 };
  /** Smoothed height of the camera's follow anchor (never snaps on landing or curbs). */
  private camY = 0;
  private keys = new Set<string>();
  private swing: Swing | null = null;
  private swingAngle = 0;
  private shakeAmount = 0;
  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private cameraRay = new THREE.Raycaster();
  private hit = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private collision: Collision,
    private canvas: HTMLCanvasElement,
  ) {
    this.character = createTamashi(CAST.player.id, { role: "player", castShadow: true });
    this.root = this.character.root;
    scene.add(this.root);
    document.documentElement.dataset.character = "ready";
    this.bindInput();
  }

  get position() {
    return this.root.position;
  }

  teleport(x: number, z: number, heading?: number) {
    const y = groundHeight(x, z);
    this.root.position.set(x, y, z);
    resetJump(this.jumpState, y);
    this.vel.x = this.vel.z = 0;
    this.camY = y;
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
    if (blocked) cancelJump(this.jumpState);
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

  /** Off the ground (lift-off to touchdown). */
  get airborne() {
    return this.jumpState.phase === "airborne";
  }

  /** Allow or forbid jumping (false while a chain transaction is pending). */
  setJumpAllowed(allowed: boolean) {
    this.jumpAllowed = allowed;
    if (!allowed) cancelJump(this.jumpState);
  }

  /**
   * Jump (what Space does; also the e2e hook). Refused while a menu is open, during the
   * smash swing or while a transaction is pending; never a double jump (a press just
   * before landing is buffered). Returns true if a jump started.
   */
  jump(): boolean {
    if (this.blocked || this.swing || !this.jumpAllowed) return false;
    return requestJump(this.jumpState);
  }

  update(dt: number) {
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
    const js = this.jumpState;
    const inAir = js.phase === "airborne";
    if (length > 0.01) {
      dx /= length;
      dz /= length;
    }
    // Horizontal velocity: on the ground it follows the input directly (as before); in
    // the air it keeps its momentum and only steers toward the input (no dead stop when
    // the keys are released or a menu opens mid-jump).
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const want = length > 0.01 ? { x: dx * speed, z: dz * speed } : null;
    if (!inAir) {
      this.vel.x = want ? want.x : 0;
      this.vel.z = want ? want.z : 0;
    } else if (want) {
      const a = 1 - Math.exp(-dt * AIR_CONTROL);
      this.vel.x += (want.x - this.vel.x) * a;
      this.vel.z += (want.z - this.vel.z) * a;
    }
    let moved = false;
    const vlen = Math.hypot(this.vel.x, this.vel.z);
    if (vlen > 0.01) {
      // Collision stays 2D whatever the height: a jump never clears a wall, car or shelf.
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
      const sx = this.vel.x * dt,
        sz = this.vel.z * dt;
      if (!tryAxis(p.x + sx, p.z + sz)) {
        if (tryAxis(p.x + sx, p.z)) {
          moved = true;
          if (inAir) this.vel.z = 0;
        } else if (tryAxis(p.x, p.z + sz)) {
          moved = true;
          if (inAir) this.vel.x = 0;
        } else if (inAir) this.vel.x = this.vel.z = 0;
      } else moved = true;
      const turn = want ? Math.atan2(want.x, want.z) : Math.atan2(this.vel.x, this.vel.z);
      if (want || moved) this.heading += angleDelta(this.heading, turn) * Math.min(dt * (inAir ? 6 : 12), 1);
    }
    if (this.swing) {
      this.heading += angleDelta(this.heading, this.swing.targetHeading) * Math.min(dt * 18, 1);
    }
    this.moving = moved;
    this.running = moved && Math.hypot(this.vel.x, this.vel.z) > (WALK_SPEED + RUN_SPEED) / 2;
    this.root.rotation.y = this.heading;
    // Vertical: grounded eases onto curbs; airborne falls under gravity onto whatever floor is below now.
    if (js.phase === "crouch" && (this.blocked || this.swing || !this.jumpAllowed)) cancelJump(js);
    js.y = p.y;
    const ev = stepJump(js, dt, groundHeight(p.x, p.z));
    p.y = js.y;
    if (ev.landed) {
      this.character.land(Math.min(1, ev.impact / JUMP_SPEED));
      if (ev.impact > 4) this.shake(0.02);
    }
    this.animate(dt);
  }

  /** Swing timing: raise, bring down hard (impact resolves swingAt's promise), recover. */
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
    c.speed = this.moving ? Math.hypot(this.vel.x, this.vel.z) : 0;
    c.carry += ((this.carrying ? 1 : 0) - c.carry) * Math.min(1, dt * 8);
    if (Math.abs(c.carry - (this.carrying ? 1 : 0)) < 0.001) c.carry = this.carrying ? 1 : 0;
    c.swingArm = this.swingAngle;
    c.swingLean = this.swingLean;
    const js = this.jumpState;
    c.jumpCrouch = js.phase === "crouch" ? Math.min(1, js.phaseT / JUMP_CROUCH) : 0;
    c.airborne = js.phase === "airborne";
    c.verticalSpeed = js.vy;
    c.update(dt, this.camera);
  }

  /** World matrix for a record held in the right hand (record-item Holder). */
  holdMatrix = (out: THREE.Matrix4) => this.character.recordMatrix(out);

  /** Third-person follow camera with collision. Call after update(). */
  updateCamera(dt: number) {
    const p = this.root.position;
    // Indoors (for the camera) = in the shop, except right in the doorway gap, where the
    // camera may still look in from the street through the open door.
    const inDoorway = Math.abs(p.x - DOOR.x) < DOOR.halfWidth + 0.2 && p.z > DOOR.wallMinZ - 0.9;
    const indoors = inShop(p.x, p.z) && !inDoorway;
    // The anchor's height is smoothed on its own: it follows only part of a jump and eases
    // onto curbs and landings, so the camera never snaps (the landing squash is in the model only).
    const js = this.jumpState;
    const floor = js.phase === "airborne" ? Math.min(js.takeoffY, groundHeight(p.x, p.z)) : p.y;
    const targetY = floor + (p.y - floor) * CAMERA_JUMP_FOLLOW;
    if (this.snapCamera) this.camY = targetY;
    else this.camY += (targetY - this.camY) * (1 - Math.exp(-dt * 7));
    const anchorY = this.camY + 1.6;
    const anchor = ANCHOR.set(p.x + Math.cos(this.yaw) * 0.45, anchorY, p.z - Math.sin(this.yaw) * 0.45);
    if (indoors) clampIndoors(anchor, 0.35);
    // The over-the-shoulder offset must not start inside a wall (e.g. at the door frame),
    // or that wall would be skipped by the ray test: fall back to the player's centre.
    if (this.collision.camera().some((b) => b.containsPoint(anchor))) anchor.set(p.x, anchorY, p.z);
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
      if (e.code === "Space") {
        // Menus and the intro handle their own Space in the capture phase (and stop it), so
        // a Space that confirms a dialog or starts the game never reaches here. A focused
        // control keeps its own Space; otherwise never scroll the page, and no auto-repeat hops.
        const t = e.target as HTMLElement | null;
        if (t && (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
        e.preventDefault();
        if (!e.repeat) this.jump();
        return;
      }
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

const OFFSET2 = new THREE.Vector3();
const ANCHOR = new THREE.Vector3();
const DESIRED = new THREE.Vector3();
const DIR = new THREE.Vector3();
const SAFE = new THREE.Vector3();
const SAFE_HIGH = new THREE.Vector3();
