/**
 * The Tamashi skeleton layout: bone names, parents and rest joint positions (body frame:
 * +x = the character's LEFT, +y up, +z forward, feet at y = 0).
 *
 * Owns: the joint layout every body/head part is built against, and making a fresh
 * THREE.Skeleton for one character instance. All rest rotations are identity.
 * Must not: animate (character.ts does) or build geometry (geometry.ts, body.ts, tv-head.ts).
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";

export const RIG_BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "foreArmL",
  "handL",
  "upperArmR",
  "foreArmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
  // Internal (not part of the public BoneName): antenna rods, for wobble.
  "antennaL",
  "antennaR",
] as const;
export type RigBone = (typeof RIG_BONES)[number];

export const BI = Object.fromEntries(RIG_BONES.map((n, i) => [n, i])) as Record<RigBone, number>;

const PARENT: Record<RigBone, RigBone | null> = {
  hips: null,
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  upperArmL: "chest",
  foreArmL: "upperArmL",
  handL: "foreArmL",
  upperArmR: "chest",
  foreArmR: "upperArmR",
  handR: "foreArmR",
  thighL: "hips",
  shinL: "thighL",
  footL: "shinL",
  thighR: "hips",
  shinR: "thighR",
  footR: "shinR",
  antennaL: "head",
  antennaR: "head",
};

/** Joint heights and offsets, metres (body frame). */
export const J = {
  hipsY: 0.92,
  spineY: 1.02,
  chestY: 1.15,
  neckY: 1.27,
  /** Head joint = bottom centre of the TV. */
  headY: 1.37,
  shoulderX: 0.2,
  shoulderY: 1.245,
  elbowY: 0.985,
  wristY: 0.745,
  hipX: 0.093,
  hipJointY: 0.87,
  kneeY: 0.475,
  ankleY: 0.085,
};

/** Rest joint positions in the body frame, indexed like RIG_BONES. */
export function restPositions(antennaL: THREE.Vector3, antennaR: THREE.Vector3): THREE.Vector3[] {
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const head = v(0, J.headY);
  const map: Record<RigBone, THREE.Vector3> = {
    hips: v(0, J.hipsY),
    spine: v(0, J.spineY),
    chest: v(0, J.chestY),
    neck: v(0, J.neckY),
    head,
    upperArmL: v(J.shoulderX, J.shoulderY),
    foreArmL: v(J.shoulderX, J.elbowY),
    handL: v(J.shoulderX, J.wristY),
    upperArmR: v(-J.shoulderX, J.shoulderY),
    foreArmR: v(-J.shoulderX, J.elbowY),
    handR: v(-J.shoulderX, J.wristY),
    thighL: v(J.hipX, J.hipJointY),
    shinL: v(J.hipX, J.kneeY),
    footL: v(J.hipX, J.ankleY),
    thighR: v(-J.hipX, J.hipJointY),
    shinR: v(-J.hipX, J.kneeY),
    footR: v(-J.hipX, J.ankleY),
    antennaL: head.clone().add(antennaL),
    antennaR: head.clone().add(antennaR),
  };
  return RIG_BONES.map((n) => map[n]);
}

/** A fresh bone hierarchy + skeleton at rest. `rest` from restPositions(); inverses shared. */
export function makeSkeleton(rest: THREE.Vector3[], inverses: THREE.Matrix4[]): { skeleton: THREE.Skeleton; bones: THREE.Bone[] } {
  const bones = RIG_BONES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  RIG_BONES.forEach((name, i) => {
    const p = PARENT[name];
    const pos = rest[i].clone();
    if (p) {
      pos.sub(rest[BI[p]]);
      bones[BI[p]].add(bones[i]);
    }
    bones[i].position.copy(pos);
  });
  return { skeleton: new THREE.Skeleton(bones, inverses), bones };
}

/** Bind inverses for a rest layout (pure translations, identity rotations). */
export function boneInverses(rest: THREE.Vector3[]): THREE.Matrix4[] {
  return rest.map((p) => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}
