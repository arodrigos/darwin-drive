import { PHYSICS_VERSION } from "@/sim/constants";
import { getTrack, type TrackId } from "@/sim/tracks";
import { compararMarcas } from "@/sim/clasificacion";
import type { DetalleMarca, SavedCar, VersionMarca } from "./schema";

type Marcas = Pick<SavedCar, "marks" | "markVersions" | "markDetails">;

const esVigente = (v: VersionMarca | undefined, trackId: TrackId): boolean =>
  v !== undefined && v.trackVersion === getTrack(trackId)?.version && v.physicsVersion === PHYSICS_VERSION;

/** Misma regla que el ranking: la marca nueva solo sustituye a la previa si compararMarcas la pone delante. */
export const mejorMarca = (nueva: Parameters<typeof compararMarcas>[0], previa: Parameters<typeof compararMarcas>[0]): boolean =>
  compararMarcas(nueva, previa) < 0;

const igual = (a: VersionMarca | undefined, b: VersionMarca): boolean =>
  !!a && a.trackVersion === b.trackVersion && a.physicsVersion === b.physicsVersion;

/**
 * Apunta una marca con la versión con que se midió. Misma versión: gana la mayor. Versiones distintas no se
 * comparan (una distancia de otra pista o física no es comparable): manda la vigente, y si ninguna lo es, la nueva.
 * Sin la versión junto a la marca, la migración al abrir el juego la tomaría por antigua y la volvería a medir.
 */
export function aplicarMarca(base: Marcas | undefined, trackId: TrackId, distance: number, versiones: VersionMarca, detalle?: DetalleMarca): Marcas {
  const marks: SavedCar["marks"] = { ...base?.marks };
  const markDetails: NonNullable<SavedCar["markDetails"]> = { ...base?.markDetails };
  const markVersions: NonNullable<SavedCar["markVersions"]> = { ...base?.markVersions };
  const previa = marks[trackId];
  const vPrevia = markVersions[trackId];
  const nueva = previa === undefined || (igual(vPrevia, versiones) ? mejorMarca({ distance, ...detalle }, { distance: previa, ...base?.markDetails?.[trackId] }) : esVigente(versiones, trackId) || !esVigente(vPrevia, trackId));
  if (nueva) {
    marks[trackId] = distance;
    markVersions[trackId] = { trackVersion: versiones.trackVersion, physicsVersion: versiones.physicsVersion };
    if (detalle) markDetails[trackId] = { ...detalle };
    else delete markDetails[trackId];
  }
  return Object.keys(markDetails).length > 0 ? { marks, markVersions, markDetails } : { marks, markVersions };
}

/**
 * Conserva las versiones del coche ya guardado para las marcas que el reemplazo no cambia, para que ningún
 * guardado pueda dejar una marca sin versión. Una marca nueva o distinta sin versión se queda sin ella (es lo
 * que la migración debe volver a medir).
 */
export function conservarVersiones(guardado: SavedCar | undefined, car: SavedCar): SavedCar {
  if (!guardado?.markVersions && !guardado?.markDetails) return car;
  const markVersions: NonNullable<SavedCar["markVersions"]> = { ...car.markVersions };
  for (const t of Object.keys(car.marks) as TrackId[]) {
    const v = guardado.markVersions?.[t];
    if (markVersions[t] === undefined && v !== undefined && guardado.marks[t] === car.marks[t]) markVersions[t] = v;
  }
  const markDetails: NonNullable<SavedCar["markDetails"]> = { ...car.markDetails };
  for (const t of Object.keys(car.marks) as TrackId[]) {
    const d = guardado.markDetails?.[t];
    if (markDetails[t] === undefined && d !== undefined && guardado.marks[t] === car.marks[t]) markDetails[t] = d;
  }
  const conDetalles = Object.keys(markDetails).length > 0 ? { markDetails } : {};
  return Object.keys(markVersions).length > 0 ? { ...car, markVersions, ...conDetalles } : { ...car, ...conDetalles };
}
