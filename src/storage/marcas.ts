import { PHYSICS_VERSION } from "@/sim/constants";
import { getTrack, type TrackId } from "@/sim/tracks";
import type { SavedCar, VersionMarca } from "./schema";

type Marcas = Pick<SavedCar, "marks" | "markVersions">;

const esVigente = (v: VersionMarca | undefined, trackId: TrackId): boolean =>
  v !== undefined && v.trackVersion === getTrack(trackId)?.version && v.physicsVersion === PHYSICS_VERSION;

const igual = (a: VersionMarca | undefined, b: VersionMarca): boolean =>
  !!a && a.trackVersion === b.trackVersion && a.physicsVersion === b.physicsVersion;

/**
 * Apunta una marca con la versión con que se midió. Misma versión: gana la mayor. Versiones distintas no se
 * comparan (una distancia de otra pista o física no es comparable): manda la vigente, y si ninguna lo es, la nueva.
 * Sin la versión junto a la marca, la migración al abrir el juego la tomaría por antigua y la volvería a medir.
 */
export function aplicarMarca(base: Marcas | undefined, trackId: TrackId, distance: number, versiones: VersionMarca): Marcas {
  const marks: SavedCar["marks"] = { ...base?.marks };
  const markVersions: NonNullable<SavedCar["markVersions"]> = { ...base?.markVersions };
  const previa = marks[trackId];
  const vPrevia = markVersions[trackId];
  const nueva = previa === undefined || (igual(vPrevia, versiones) ? distance > previa : esVigente(versiones, trackId) || !esVigente(vPrevia, trackId));
  if (nueva) {
    marks[trackId] = distance;
    markVersions[trackId] = { trackVersion: versiones.trackVersion, physicsVersion: versiones.physicsVersion };
  }
  return { marks, markVersions };
}

/**
 * Conserva las versiones del coche ya guardado para las marcas que el reemplazo no cambia, para que ningún
 * guardado pueda dejar una marca sin versión. Una marca nueva o distinta sin versión se queda sin ella (es lo
 * que la migración debe volver a medir).
 */
export function conservarVersiones(guardado: SavedCar | undefined, car: SavedCar): SavedCar {
  if (!guardado?.markVersions) return car;
  const markVersions: NonNullable<SavedCar["markVersions"]> = { ...car.markVersions };
  for (const t of Object.keys(car.marks) as TrackId[]) {
    const v = guardado.markVersions[t];
    if (markVersions[t] === undefined && v !== undefined && guardado.marks[t] === car.marks[t]) markVersions[t] = v;
  }
  return Object.keys(markVersions).length > 0 ? { ...car, markVersions } : car;
}
