// Genera src/debug/escenarios/especies-demo.json con el núcleo real: unos pocos lotes de exploración
// (semilla fija) en dos pistas dejan la rejilla de especies parcialmente descubierta.
import { escribirEscenario } from "./escribir-escenario";
import type { SpeciesArchive } from "../src/evolution/species";
import type { TrackId } from "../src/sim/tracks";
import { explorar } from "../tests/unit/helpers/especies";

export const PISTAS_DEMO: readonly { trackId: TrackId; seed: number; lotes: number }[] = [
  { trackId: "cordillera", seed: 31, lotes: 6 },
  { trackId: "rampa", seed: 32, lotes: 3 },
];

export function construirDemo(): Partial<Record<TrackId, SpeciesArchive>> {
  const out: Partial<Record<TrackId, SpeciesArchive>> = {};
  for (const p of PISTAS_DEMO) out[p.trackId] = explorar(p.trackId, p.seed, p.lotes);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("generar-escenario-especies.ts")) {
  escribirEscenario(new URL("../src/debug/escenarios/especies-demo.json", import.meta.url), construirDemo());
}
