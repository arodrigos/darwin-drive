import { nextGeneration, seedPopulation, type EvolutionState, type GaParams } from "../../../src/evolution/ga";
import type { LineageNode } from "../../../src/evolution/lineage";
import { createRace } from "../../../src/sim/race";
import type { CarResult } from "../../../src/sim/constants";
import type { TrackId } from "../../../src/sim/tracks";

/** Corre de verdad la generación actual (física real) y devuelve los resultados de todos sus coches. */
export function raceGeneration(state: EvolutionState, maxSteps?: number): CarResult[] {
  const race = createRace(
    state.population.map((p) => ({ carId: p.id, genome: p.genome })),
    state.trackId,
    maxSteps ? { maxSteps } : undefined,
  );
  while (!race.done()) race.step(120);
  const results = race.results();
  race.dispose();
  return results;
}

export interface Evolution {
  states: EvolutionState[];
  lineage: LineageNode[];
  results: CarResult[][];
}

/** `generations` generaciones corridas: states[i] es la población de la generación i+1 ya evaluada. */
export function evolve(
  params: GaParams,
  trackId: TrackId,
  generations: number,
  opts: { maxSteps?: number; from?: Parameters<typeof seedPopulation>[2] } = {},
): Evolution {
  const seeded = seedPopulation(params, trackId, opts.from ?? { kind: "random" });
  let state = seeded.state;
  const out: Evolution = { states: [], lineage: [...seeded.lineageAdded], results: [] };
  for (let g = 0; g < generations; g++) {
    out.states.push(state);
    const results = raceGeneration(state, opts.maxSteps);
    out.results.push(results);
    const next = nextGeneration(state, results);
    out.lineage.push(...next.lineageAdded);
    state = next.state;
  }
  return out;
}
