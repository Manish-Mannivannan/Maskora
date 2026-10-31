/**
 * Builds raised-UV coating meshes off the main thread, so a large or detailed
 * mask never freezes the window. Receives a coverage plane and a profile;
 * returns the bounded mesh with its buffers transferred, not copied.
 */
import { buildBoundedReliefMesh, type ReliefProfile } from "./reliefMesh";

export interface ReliefRequest {
  id: number;
  coverage: Uint8Array;
  width: number;
  height: number;
  pxPerMm: number;
  profile: ReliefProfile;
}

self.onmessage = (event: MessageEvent<ReliefRequest>) => {
  const { id, coverage, width, height, pxPerMm, profile } = event.data;
  const t0 = performance.now();
  try {
    const result = buildBoundedReliefMesh(coverage, width, height, pxPerMm, profile);
    const ms = performance.now() - t0;
    const transfer = result.mesh
      ? [result.mesh.positions.buffer, result.mesh.normals.buffer, result.mesh.indices.buffer]
      : [];
    (self as unknown as Worker).postMessage({ id, ok: true, result, ms }, transfer as Transferable[]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      message: String((error as Error)?.message ?? error),
    });
  }
};
