import { COLOR_PREDETERMINADO, PALETA_COCHES } from "../game/colores-coche";
import type { RankingEntry } from "../storage/schema";
import type { EntradaClip } from "./nucleo";

/** Lo que el Worker necesita de una marca del ranking; el nombre sin poner es el mismo «Coche xxxx» de la tabla. */
export function entradaDeMarca(e: RankingEntry): EntradaClip {
  return {
    genome: e.genome,
    trackId: e.trackId,
    trackVersion: e.trackVersion,
    nombre: e.name ?? `Coche ${e.genomeHash.slice(0, 4)}`,
    color: PALETA_COCHES[e.color ?? COLOR_PREDETERMINADO].hex,
    distancia: e.distance,
  };
}
