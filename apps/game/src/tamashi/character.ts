/**
 * A Tamashi character: assembles the TV head, screen and body for one token and runs a
 * procedural animation rig (idle, walk, run, carry, overhead swing, cheer).
 *
 * STUB: the public surface below is the contract the game uses (src/world/player.ts,
 * npcs.ts). The implementation is a placeholder until the real rig lands.
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { traitsFor, type TamashiTraits } from "./traits";
import { DISPLAY_SCALE } from "../world/record-item";

/**
 * Rig joints. Every bone has an identity rest rotation, so its local axes are the body's:
 * +x = the character's LEFT, +y = up, +z = forward. "R" bones are on the character's right (−x).
 */
export type BoneName =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "upperArmL"
  | "foreArmL"
  | "handL"
  | "upperArmR"
  | "foreArmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR";

export interface TamashiOptions {
  /** "player": highest detail (larger screen texture, casts + receives shadows). Default "npc". */
  role?: "player" | "npc";
  /** Default: true for the player, false for NPCs. */
  castShadow?: boolean;
}

export class TamashiCharacter {
  readonly traits: TamashiTraits;
  /** Put this in the scene: upright, feet at y = 0, facing +z. */
  readonly root = new THREE.Group();
  /** Child of root holding the body; npcs.ts shifts it sideways for sidesteps. */
  readonly model = new THREE.Group();
  /** Height to the top of the TV (antennas excluded), metres. */
  readonly height = 1.75;

  // ── Animation inputs: set them every frame (or whenever they change). ──
  /** Ground speed, m/s. 0 idle · ~1.3 stroll · 3.2 walk · 6 run. The gait blends by speed. */
  speed = 0;
  /** 0..1: blend into the carry pose (right arm holding a record at the side). */
  carry = 0;
  /** Overhead swing: right-arm rotation about the body's x axis (rad; negative raises it forward-up and overhead, about -3.25 at the top). */
  swingArm = 0;
  /** Torso lean for the swing (rad; positive leans forward). */
  swingLean = 0;
  /** Head nod amplitude (rad, 0..~0.25) on a ~96 bpm beat. */
  nod = 0;
  /** Sideways head/TV tilt (rad), e.g. while thinking. */
  tilt = 0;
  /** Wave the right arm (beckoning the player over). */
  waving = false;

  private bones = new Map<BoneName, THREE.Object3D>();

  constructor(
    readonly id: number,
    options: TamashiOptions = {},
  ) {
    this.traits = traitsFor(id);
    this.root.name = `tamashi:${id}`;
    this.root.add(this.model);
    const t = this.traits;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color: t.outfit.primary }));
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.38), new THREE.MeshStandardMaterial({ color: t.tv.bodyColor }));
    head.position.y = 1.55;
    this.model.add(body, head);
    const shadow = options.castShadow ?? options.role === "player";
    body.castShadow = head.castShadow = shadow;
    for (const name of ["hips", "spine", "chest", "neck", "head", "upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR", "thighL", "shinL", "footL", "thighR", "shinR", "footR"] as BoneName[]) {
      const b = new THREE.Object3D();
      b.name = name;
      this.bones.set(name, b);
      this.model.add(b);
    }
    this.bones.get("handR")!.position.set(-0.3, 0.85, 0.05);
    this.bones.get("head")!.position.set(0, 1.4, 0);
    this.bones.get("chest")!.position.set(0, 1.25, 0);
  }

  /** Bone to attach props to. Child positions are relative to the joint, in body axes (metres). */
  bone(name: BoneName): THREE.Object3D {
    return this.bones.get(name)!;
  }

  /** Short happy reaction: a hop, arms up, antennas wiggle. */
  cheer(): void {}

  /** Advance the rig. With `camera`, also picks the level of detail by distance. */
  update(_dt: number, _camera?: THREE.Camera): void {}

  /**
   * World matrix for a record held in the right hand (a record-item.ts Holder body):
   * sleeve hanging just below the grip, cover turned out, at DISPLAY_SCALE.
   * Returns whether the character is visible.
   */
  recordMatrix(out: THREE.Matrix4): boolean {
    const hand = this.bones.get("handR")!;
    this.root.updateMatrixWorld(true);
    hand.getWorldPosition(P);
    Q.copy(this.root.quaternion).multiply(Q2.setFromEuler(E.set(0.12, -2.1, 0)));
    out.compose(P, Q, S.setScalar(DISPLAY_SCALE));
    return this.root.visible;
  }

  /** Free per-instance GPU resources (shared caches stay). Remove root from the scene first. */
  dispose(): void {}
}

/** Build Tamashi #id (1..100). */
export function createTamashi(id: number, options?: TamashiOptions): TamashiCharacter {
  return new TamashiCharacter(id, options);
}

/** Global detail level: "low" pulls the far-LOD distance in (weak GPUs, ?quality=low). */
export function setTamashiQuality(_quality: "low" | "high"): void {}

const P = new THREE.Vector3();
const S = new THREE.Vector3();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const E = new THREE.Euler();
