/**
 * Character models: loads the two rigged Mixamo GLBs once and hands out clones.
 *
 * Owns: GLTF loading of public/models/player-male.glb ("male", the player rig) and
 * public/models/visitor.glb ("female", Michelle from the three.js examples), height
 * normalisation, facing correction, per-clone tinted materials (clothing only: skin
 * is detected in the shader and left untinted so faces never turn red), bone lookup,
 * and a helper for layering procedural bone rotations on top of a playing clip.
 * Must not: animate, place or decide behaviour; player.ts and npcs.ts do that.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

export type CharacterKind = "male" | "female";

export interface CharacterTemplate {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export interface Character {
  /** Put this in the scene; it is upright, feet at y = 0, facing +z. */
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  bones: {
    rightHand?: THREE.Object3D;
    rightArm?: THREE.Object3D;
    rightForeArm?: THREE.Object3D;
    spine?: THREE.Object3D;
    /** Upper chest (Spine2): where a necklace or a shoulder bag hangs. */
    chest?: THREE.Object3D;
    neck?: THREE.Object3D;
    head?: THREE.Object3D;
  };
}

const FILES: Record<CharacterKind, { url: string; height: number; faceFix: number; hasSkin: boolean }> = {
  // The Vanguard rig faces -z in its file; rotate it to face +z like everything else.
  // It is fully armoured (no visible skin), so its whole texture may be tinted.
  male: { url: "/models/player-male.glb", height: 1.82, faceFix: Math.PI, hasSkin: false },
  female: { url: "/models/visitor.glb", height: 1.7, faceFix: 0, hasSkin: true },
};

const cache = new Map<CharacterKind, Promise<CharacterTemplate>>();
export function loadCharacter(kind: CharacterKind): Promise<CharacterTemplate> {
  let p = cache.get(kind);
  if (!p) {
    p = new GLTFLoader().loadAsync(FILES[kind].url).then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
    cache.set(kind, p);
  }
  return p;
}

/**
 * Clone a loaded character. `tint` multiplies the clothing colour (materials are cloned
 * per character so pedestrians don't all look identical). On rigs with visible skin the
 * tint is masked off warm, skin-like texels so faces and arms keep their natural colour.
 */
export function makeCharacter(kind: CharacterKind, template: CharacterTemplate, tint?: THREE.ColorRepresentation, isPlayer = false): Character {
  const spec = FILES[kind];
  const model = cloneSkinned(template.scene);
  const root = new THREE.Group();
  root.name = `character:${kind}`;
  // Measure height in bind pose and normalise.
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const height = bounds.max.y - bounds.min.y || 1;
  model.scale.multiplyScalar(spec.height / height);
  model.position.y = -bounds.min.y * (spec.height / height);
  model.rotation.y = spec.faceFix;
  root.add(model);
  const color = tint !== undefined ? new THREE.Color(tint) : null;
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = isPlayer;
    o.frustumCulled = false; // skinned bounds don't follow the animation
    const fix = (m: THREE.Material) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      if (c instanceof THREE.MeshStandardMaterial) {
        c.roughness = 0.88;
        c.metalness = 0;
        if (color && !/visor/i.test(c.name)) applyClothingTint(c, color, spec.hasSkin);
      }
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
  const mixer = new THREE.AnimationMixer(model);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const clip of template.clips) actions[clip.name] = mixer.clipAction(clip);
  const bones: Character["bones"] = {};
  model.traverse((o) => {
    const n = o.name.replace(/^mixamorig:?/, "");
    if (n === "RightHand") bones.rightHand = o;
    else if (n === "RightArm") bones.rightArm = o;
    else if (n === "RightForeArm") bones.rightForeArm = o;
    else if (n === "Spine1") bones.spine = o;
    else if (n === "Spine2") bones.chest = o;
    else if (n === "Neck") bones.neck = o;
    else if (n === "Head") bones.head = o;
  });
  return { root, model, mixer, actions, bones };
}

/**
 * Multiply the texture colour by `tint`, except on skin. Skin is "warm and moderately
 * saturated, red-to-orange hue" in (approximately) sRGB space; clothes, hair and grey
 * fabrics fall outside that and get the full tint.
 */
function applyClothingTint(material: THREE.MeshStandardMaterial, tint: THREE.Color, protectSkin: boolean) {
  if (!protectSkin) {
    material.color.multiply(tint);
    return;
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClothingTint = { value: tint };
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 uClothingTint;\nvoid main() {")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 srgb = sqrt(max(diffuseColor.rgb, vec3(0.0)));
          float hi = max(srgb.r, max(srgb.g, srgb.b));
          float lo = min(srgb.r, min(srgb.g, srgb.b));
          float sat = (hi - lo) / max(hi, 1e-4);
          float hue = (srgb.g - srgb.b) / max(hi - lo, 1e-4); // 0 = red .. 1 = yellow (when red is max)
          float warm = step(srgb.g, srgb.r) * step(srgb.b, srgb.g);
          float skin = warm * smoothstep(0.12, 0.25, sat) * (1.0 - smoothstep(0.82, 0.95, sat)) * (1.0 - smoothstep(0.5, 0.68, hue));
          diffuseColor.rgb = mix(diffuseColor.rgb * uClothingTint, diffuseColor.rgb, skin);
        }`,
      );
  };
  material.customProgramCacheKey = () => "clothing-tint-v1";
}

const PARENT_Q = new THREE.Quaternion();
const DELTA_Q = new THREE.Quaternion();
const INV_Q = new THREE.Quaternion();
/**
 * Rotate a bone about a world-space axis, regardless of how the rig's local axes are
 * oriented. Call after the mixer update so the rotation layers on top of the clip.
 */
export function rotateBoneAboutWorldAxis(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number) {
  if (!bone || !bone.parent || angle === 0) return;
  bone.parent.getWorldQuaternion(PARENT_Q);
  const delta = DELTA_Q.setFromAxisAngle(axis, angle);
  // local' = parent⁻¹ · delta · parent · local
  const inv = INV_Q.copy(PARENT_Q).invert();
  bone.quaternion.premultiply(PARENT_Q).premultiply(delta).premultiply(inv);
  bone.updateMatrixWorld(true);
}
