/**
 * A page face's material from the shared finish maps (architecture §4.4, §7.4).
 *
 * - The artwork is the base colour, never altered by a finish.
 * - Ordinary and raised UV are a clearcoat masked by coverage: they add
 *   reflection on top of the artwork and change no colour.
 * - Raised UV also bends the normals of the stock and the coating from its
 *   height profile (an approximation: no silhouette, no cast shadow).
 *
 * One RGBA "coat" texture serves both clearcoat slots (three.js reads the
 * amount from red and the roughness from green). Its blue and alpha channels
 * hold the raised-UV and ordinary-UV maps exactly as the pipeline returned
 * them, so the coverage the material was built from can be read back and
 * compared byte for byte with the registration overlay's. Mask and normal
 * textures are non-colour data; only the artwork is sRGB.
 */
import * as THREE from "three";
import { heightProfile, normalMap } from "@/finish/height";
import type { RegistrationResult } from "@/finish/pipeline";
import type { FinishRecipe, FinishType, Stock } from "@/project/model";

export interface FinishLook {
  recipes: Record<FinishType, FinishRecipe>;
  stock: Stock;
  show: Record<FinishType, boolean>;
  /** Compare against the print alone: no coating, no relief. */
  printOnly: boolean;
  /** Raised UV drawn as a normal map, or as a coating mesh (then the face carries no relief normals). */
  raisedMode: "normals" | "mesh";
}

const dataTexture = (data: Uint8Array, width: number, height: number) => {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
};

export function artworkTexture(result: RegistrationResult) {
  const t = new THREE.CanvasTexture(result.artwork);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** R: clearcoat amount, G: clearcoat roughness, B: raised-UV map, A: ordinary-UV map. */
export function coatTexture(result: RegistrationResult, look: Pick<FinishLook, "recipes" | "show">) {
  const { width, height, uv, raisedUv } = result.maps;
  const data = new Uint8Array(width * height * 4);
  const ru = Math.round((1 - look.recipes.uv.gloss) * 255);
  const rr = Math.round((1 - look.recipes.raisedUv.gloss) * 255);
  for (let i = 0; i < uv.length; i += 1) {
    const u = look.show.uv ? uv[i] * look.recipes.uv.strength : 0;
    const r = look.show.raisedUv ? raisedUv[i] * look.recipes.raisedUv.strength : 0;
    const p = i * 4;
    data[p] = Math.min(255, Math.round(u + r));
    data[p + 1] = r >= u ? rr : ru;
    data[p + 2] = raisedUv[i];
    data[p + 3] = uv[i];
  }
  return dataTexture(data, width, height);
}

/** A normal map the relief worker built, as a texture. */
export function reliefTextureFrom(data: Uint8Array, width: number, height: number) {
  return dataTexture(data, width, height);
}

/** The raised-UV normal map, or null when there is no raised coverage. */
export function reliefTexture(result: RegistrationResult, recipe: FinishRecipe) {
  const { width, height, raisedUv } = result.maps;
  if (!raisedUv.some((v) => v > 0)) return null;
  const profile = heightProfile(raisedUv, width, height, result.pxPerMm, recipe);
  return dataTexture(normalMap(profile, width, height, result.pxPerMm), width, height);
}

export function faceMaterial(
  artwork: THREE.Texture,
  coat: THREE.DataTexture,
  relief: THREE.DataTexture | null,
  look: FinishLook,
) {
  const finishes = !look.printOnly;
  const raised = finishes && look.show.raisedUv && relief !== null && look.raisedMode === "normals";
  return new THREE.MeshPhysicalMaterial({
    map: artwork,
    roughness: look.stock.roughness,
    metalness: 0,
    clearcoat: finishes ? 1 : 0,
    clearcoatMap: coat,
    // The map's green channel carries each finish's roughness.
    clearcoatRoughness: 1,
    clearcoatRoughnessMap: coat,
    normalMap: raised ? relief : null,
    clearcoatNormalMap: raised ? relief : null,
  });
}

/**
 * The stock's material, for the box between a leaf's faces. The box sits only
 * 2% of the stock thickness behind each face (3 µm on 0.3 mm stock), less than
 * the depth buffer resolves beyond about 0.7 m, and it is drawn after the
 * faces, so it won ties and showed through the artwork as flickering streaks.
 * The polygon offset keeps it at least one depth step behind at any distance,
 * angle or thickness.
 */
export function stockMaterial(roughness: number) {
  return new THREE.MeshStandardMaterial({
    color: "#efece4",
    roughness,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/** FNV-1a over the ordinary-UV then raised-UV planes held in a coat texture: equals the pipeline's map digest. */
export function coatDigest(coat: THREE.DataTexture): string {
  const { data, width, height } = coat.image as { data: Uint8Array; width: number; height: number };
  let h = 0x811c9dc5;
  for (const channel of [3, 2])
    for (let p = channel; p < data.length; p += 4) {
      h ^= data[p];
      h = Math.imul(h, 0x01000193);
    }
  return `${width}x${height}:${(h >>> 0).toString(16).padStart(8, "0")}`;
}
