import { PHYSICS_VERSION, type CarResult, type CausaParada } from "@/sim/constants";
import { marcaCreible } from "@/sim/clasificacion";
import { TRACKS, type Track, type TrackId } from "@/sim/tracks";
import { entradaPendiente, type RankingEntry, type SavedCar } from "@/storage/schema";

/** Lo que una marca guardada promete de su carrera; una repetición solo es fiel si lo cumple. */
export interface MarcaComparable {
  distance: number;
  bestStep?: number;
  causaParada?: CausaParada | null;
}

/**
 * Una marca solo se puede reproducir si se midió con la pista y la física de hoy: con otra versión el
 * mismo genoma haría otra carrera. Una pendiente de medir, o con la migración en curso, tampoco.
 */
export function repeticionDisponible(entry: RankingEntry | undefined, track: Pick<Track, "version">, migrando: boolean): boolean {
  if (!entry || migrando) return false;
  if (entradaPendiente(entry)) return false;
  return entry.trackVersion === track.version && entry.physicsVersion === PHYSICS_VERSION;
}

/** La fidelidad se comprueba, no se supone: distancia, tiempo y causa de parada iguales a la marca. */
export function resultadoFiel(r: CarResult, marca: MarcaComparable): boolean {
  if (Math.abs(r.distance - marca.distance) > 1e-9) return false;
  if (marca.bestStep === undefined || r.bestStep !== marca.bestStep) return false;
  return r.causaParada === (marca.causaParada ?? null);
}

/** El n.º 1 de la pista que se puede reproducir: contra él corre el fantasma. */
export function marcaFantasma(lista: readonly RankingEntry[] | undefined, track: Pick<Track, "version">, migrando: boolean): RankingEntry | undefined {
  return lista?.find((e) => repeticionDisponible(e, track, migrando));
}

/**
 * La mejor marca de un coche del garaje que se puede reproducir: medida con las versiones de hoy y con su
 * tiempo guardado. Una marca sin versión o sin detalle es anterior al versionado y no vale como repetición.
 */
export function mejorMarcaGaraje(car: SavedCar, migrando: boolean): { trackId: TrackId; marca: MarcaComparable } | null {
  if (migrando) return null;
  let mejor: { trackId: TrackId; marca: MarcaComparable } | null = null;
  for (const t of TRACKS) {
    const distance = car.marks[t.id];
    const v = car.markVersions?.[t.id];
    const d = car.markDetails?.[t.id];
    if (distance === undefined || !v || !d) continue;
    if (v.trackVersion !== t.version || v.physicsVersion !== PHYSICS_VERSION) continue;
    if (!marcaCreible({ distance, bestStep: d.bestStep, piezasPerdidas: d.piezasPerdidas })) continue;
    if (!mejor || distance > mejor.marca.distance) mejor = { trackId: t.id, marca: { distance, bestStep: d.bestStep, causaParada: d.causaParada ?? null } };
  }
  return mejor;
}
