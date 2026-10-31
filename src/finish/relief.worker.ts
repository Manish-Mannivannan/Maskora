/**
 * Builds raised-UV relief off the main thread, so a large or detailed mask
 * never freezes the window: the bounded coating mesh, or the normal map the
 * lighter mode (and the mesh's fallback) draws. Receives a coverage plane and
 * a profile; returns the result with its buffers transferred, not copied.
 */
import { heightProfile, normalMap } from "./height";
import { buildBoundedReliefMesh, type ReliefProfile } from "./reliefMesh";

export interface ReliefRequest {
  id: number;
  kind: "mesh" | "normals";
  coverage: Uint8Array;
  width: number;
  height: number;
  pxPerMm: number;
  profile: ReliefProfile;
}

self.onmessage = (event: MessageEvent<ReliefRequest>) => {
  const { id, kind, coverage, width, height, pxPerMm, profile } = event.data;
  const t0 = performance.now();
  try {
    if (kind === "normals") {
      const data = normalMap(
        heightProfile(coverage, width, height, pxPerMm, profile),
        width,
        height,
        pxPerMm,
      );
      (self as unknown as Worker).postMessage({ id, ok: true, data, ms: performance.now() - t0 }, [
        data.buffer,
      ]);
      return;
    }
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
