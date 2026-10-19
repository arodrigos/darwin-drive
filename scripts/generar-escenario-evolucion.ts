// Genera src/debug/escenarios/evolucion-demo-gen-8.json con el núcleo real: siete generaciones corridas
// en La Cordillera (semilla fija) dejan la evolución lista para continuar en la generación 8.
import { writeFileSync } from "node:fs";
import { DEFAULT_PARAMS, nextGeneration, seedPopulation, type EvolutionState } from "../src/evolution/ga";
import { raceGeneration } from "../tests/unit/helpers/evolucionar";

export const SEMILLA_DEMO = 8;
export const GENERACIONES_DEMO = 7;

export function construirDemo(generaciones: number = GENERACIONES_DEMO): EvolutionState {
  let { state } = seedPopulation({ ...DEFAULT_PARAMS, seed: SEMILLA_DEMO }, "cordillera", { kind: "random" });
  for (let g = 0; g < generaciones; g++) state = nextGeneration(state, raceGeneration(state)).state;
  return state;
}

if (process.argv[1] && process.argv[1].endsWith("generar-escenario-evolucion.ts")) {
  const destino = new URL("../src/debug/escenarios/evolucion-demo-gen-8.json", import.meta.url);
  writeFileSync(destino, `${JSON.stringify(construirDemo(), null, 1)}\n`);
  console.log(`escrito ${destino.pathname}`);
}
