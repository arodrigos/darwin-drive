import type { Genome } from "../sim/genome";
import type { TrackId } from "../sim/tracks";

// Solo los tipos del contrato: el guardado los valida antes de que exista el
// algoritmo genético, que añadirá aquí sus funciones sin cambiar estas formas.
export interface GaParams {
  populationSize: number;
  eliteCount: number;
  mutationRate: number;
  mutationSize: "small" | "medium" | "large";
  seed: number;
}

export type Op = "random" | "design" | "retouch" | "clone" | "crossover" | "mutation";

export interface Individual {
  id: string;
  genome: Genome;
  parents: string[];
  op: Op;
  generation: number;
  hue: number;
}

export interface GenerationStats {
  generation: number;
  best: number;
  topQuarterMean: number;
  mean: number;
  bestId: string;
}

export interface EvolutionState {
  v: 1;
  params: GaParams;
  trackId: TrackId;
  generation: number;
  population: Individual[];
  rng: number[];
  history: GenerationStats[];
  favorites: string[];
  stagnantFor: number;
  effectiveMutationRate: number;
}
