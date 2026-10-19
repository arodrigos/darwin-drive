import { DEFAULT_PARAMS, seedPopulation, type EvolutionState, type GenerationStats } from "@/evolution/ga";
import { getTrack, type TrackId } from "@/sim/tracks";
import { validateEvolution } from "@/storage/schema";

export interface EscenarioEvolucion {
  generacion: number;
  trackId?: TrackId;
  stagnantFor?: number;
  poblacion?: number;
}

/**
 * Estado de evolución para las pruebas de pantalla. Los coches son los reales de la siembra; el historial
 * es sintético (una mejora lenta o plana según `stagnantFor`), porque solo sirve para pintar la gráfica y los avisos.
 */
export function evolucionSintetica(spec: EscenarioEvolucion, porDefecto: TrackId): EvolutionState {
  const trackId = getTrack(spec.trackId)?.id ?? porDefecto;
  const { state } = seedPopulation({ ...DEFAULT_PARAMS, seed: 11, populationSize: spec.poblacion ?? DEFAULT_PARAMS.populationSize }, trackId, { kind: "random" });
  const generacion = Math.max(1, Math.trunc(spec.generacion));
  const estancada = Math.max(0, Math.trunc(spec.stagnantFor ?? 0));
  const history: GenerationStats[] = [];
  let best = 20;
  for (let g = 1; g < generacion; g++) {
    if (g < generacion - estancada) best += 6 + (g % 3);
    history.push({ generation: g, best, topQuarterMean: best * 0.7, mean: best * 0.4, bestId: state.population[0].id });
  }
  return {
    ...state,
    generation: generacion,
    history,
    stagnantFor: estancada,
    effectiveMutationRate: estancada >= 5 ? Math.min(0.3, state.params.mutationRate * 2) : state.params.mutationRate,
  };
}

/** Escenario `'demo-gen-8'`: una evolución real hecha con el núcleo (npm run generar:escenario-evolucion). */
export async function evolucionDemo(): Promise<EvolutionState> {
  const raw = (await import("./escenarios/evolucion-demo-gen-8.json")).default;
  const state = validateEvolution(raw);
  if (!state) throw new Error("escenario evolucion-demo-gen-8 inválido");
  return state;
}
