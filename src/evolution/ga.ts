import "../sim/detmath";
import { xoroshiro128plus, xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import { GENE_RANGES, VERTEX_COUNT, WHEEL_SLOTS, genomeHash, normalizeGenome, randomGenome, type Genome } from "../sim/genome";
import type { CarResult } from "../sim/constants";
import type { TrackId } from "../sim/tracks";
import { isHumanOp, type LineageNode } from "./lineage";

// Las formas del contrato las valida el guardado (src/storage/schema.ts): no se tocan aquí.
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

export const DEFAULT_PARAMS: GaParams = { populationSize: 16, eliteCount: 2, mutationRate: 0.05, mutationSize: "medium", seed: 1 };

export const MAX_HISTORY = 500;
const STAGNATION_WINDOW = 5;
const STAGNATION_GAIN = 0.01;
const MAX_EFFECTIVE_RATE = 0.3;
const CROSSOVER_PROBABILITY = 0.8;
const RESET_PROBABILITY = 0.1;
const FAVORITE_CHILDREN = 2;
const SIGMA: Record<GaParams["mutationSize"], number> = { small: 0.05, medium: 0.1, large: 0.25 };

// --- PRNG serializable -------------------------------------------------------

export interface Rng {
  float(): number;
  int(n: number): number;
  gauss(): number;
  state(): number[];
}

/** El estado vive en `state.rng` (JSON): retomar da lo mismo que no haber parado. */
export function makeRng(source: number | number[]): Rng {
  const gen = typeof source === "number" ? xoroshiro128plus(source) : xoroshiro128plusFromState(source);
  const float = () => uniformInt(gen, 0, 0xffffff) / 0x1000000;
  return {
    float,
    int: (n) => uniformInt(gen, 0, n - 1),
    gauss: () => Math.sqrt(-2 * Math.log(1 - float())) * Math.cos(2 * Math.PI * float()),
    state: () => Array.from(gen.getState()),
  };
}

// --- Parámetros --------------------------------------------------------------

function clampInt(value: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

export function normalizeParams(p: GaParams): GaParams {
  const size = p.mutationSize === "small" || p.mutationSize === "large" ? p.mutationSize : "medium";
  const rate = Number.isFinite(p.mutationRate) ? Math.min(0.3, Math.max(0.01, p.mutationRate)) : DEFAULT_PARAMS.mutationRate;
  return {
    populationSize: clampInt(p.populationSize, 8, 32, DEFAULT_PARAMS.populationSize),
    eliteCount: clampInt(p.eliteCount, 0, 4, DEFAULT_PARAMS.eliteCount),
    mutationRate: rate,
    mutationSize: size,
    seed: Number.isFinite(p.seed) ? Math.trunc(p.seed) : DEFAULT_PARAMS.seed,
  };
}

// --- Genes -------------------------------------------------------------------

type Range = readonly [number, number];

/** Un gen = una función que lo reescribe en una copia mutable del genoma. */
interface Gene {
  range: Range;
  circular: boolean;
  get(g: Genome): number;
  set(g: Genome, v: number): void;
}

const GENES: Gene[] = [
  ...Array.from({ length: VERTEX_COUNT }, (_, i): Gene[] => [
    { range: GENE_RANGES.angle(i), circular: false, get: (g) => g.body[i].angle, set: (g, v) => void (g.body[i].angle = v) },
    { range: GENE_RANGES.length, circular: false, get: (g) => g.body[i].length, set: (g, v) => void (g.body[i].length = v) },
  ]).flat(),
  { range: GENE_RANGES.bodyDensity, circular: false, get: (g) => g.bodyDensity, set: (g, v) => void (g.bodyDensity = v) },
  ...Array.from({ length: WHEEL_SLOTS }, (_, w): Gene[] => [
    { range: GENE_RANGES.radius, circular: false, get: (g) => g.wheels[w].radius, set: (g, v) => void (g.wheels[w].radius = v) },
    { range: GENE_RANGES.wheelDensity, circular: false, get: (g) => g.wheels[w].density, set: (g, v) => void (g.wheels[w].density = v) },
    { range: GENE_RANGES.axisAngle, circular: true, get: (g) => g.wheels[w].axisAngle, set: (g, v) => void (g.wheels[w].axisAngle = v) },
  ]).flat(),
];
// El vértice de cada rueda es discreto: no tiene gaussiana, se vuelve a sortear.
const WHEEL_VERTEX_GENES = WHEEL_SLOTS;

function cloneGenome(g: Genome): Genome {
  return { v: 1, body: g.body.map((b) => ({ ...b })), bodyDensity: g.bodyDensity, wheels: g.wheels.map((w) => ({ ...w })) };
}

function mutateGene(g: Genome, index: number, sigma: number, reset: boolean, rng: Rng): void {
  if (index >= GENES.length) {
    const w = g.wheels[index - GENES.length];
    w.vertex = rng.float() < 0.2 ? -1 : rng.int(VERTEX_COUNT);
    return;
  }
  const gene = GENES[index];
  const [lo, hi] = gene.range;
  if (reset) {
    gene.set(g, lo + (hi - lo) * rng.float());
    return;
  }
  const moved = gene.get(g) + rng.gauss() * sigma * (hi - lo);
  gene.set(g, gene.circular ? ((moved % (hi - lo)) + (hi - lo)) % (hi - lo) : moved);
}

const MUTABLE_GENES = GENES.length + WHEEL_VERTEX_GENES;

/** Cada gen muta con probabilidad `rate`; `force` garantiza al menos un gen distinto. */
export function mutate(parent: Genome, rate: number, sizeKey: GaParams["mutationSize"], rng: Rng, force: boolean): Genome {
  const sigma = SIGMA[sizeKey];
  const base = genomeHash(parent);
  const attempt = (genes: number[]): Genome => {
    const g = cloneGenome(parent);
    for (const i of genes) mutateGene(g, i, sigma, rng.float() < RESET_PROBABILITY, rng);
    return normalizeGenome(g);
  };
  const pick = () => Array.from({ length: MUTABLE_GENES }, (_, i) => i).filter(() => rng.float() < rate);
  let child = attempt(pick());
  if (!force) return child;
  for (let tries = 0; tries < 20 && genomeHash(child) === base; tries++) child = attempt([rng.int(MUTABLE_GENES)]);
  // Último recurso: reinicio de un gen seguro hasta que cambie (el rango siempre deja margen).
  for (let tries = 0; tries < 20 && genomeHash(child) === base; tries++) {
    const g = cloneGenome(parent);
    mutateGene(g, rng.int(GENES.length), sigma, true, rng);
    child = normalizeGenome(g);
  }
  return child;
}

/** Cruce de dos puntos sobre unidades con sentido propio: cada vértice, la densidad del cuerpo y cada rueda. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const units = VERTEX_COUNT + 1 + WHEEL_SLOTS;
  const p = rng.int(units + 1);
  const q = rng.int(units + 1);
  const [from, to] = p <= q ? [p, q] : [q, p];
  const fromB = (u: number) => u >= from && u < to;
  const g = cloneGenome(a);
  for (let i = 0; i < VERTEX_COUNT; i++) if (fromB(i)) g.body[i] = { ...b.body[i] };
  if (fromB(VERTEX_COUNT)) g.bodyDensity = b.bodyDensity;
  for (let w = 0; w < WHEEL_SLOTS; w++) if (fromB(VERTEX_COUNT + 1 + w)) g.wheels[w] = { ...b.wheels[w] };
  return normalizeGenome(g);
}

// --- Tono --------------------------------------------------------------------

const wrapHue = (h: number) => ((h % 360) + 360) % 360;

/** Media circular: 350° y 10° dan 0°, no 180°. */
function meanHue(a: number, b: number): number {
  const ra = (a * Math.PI) / 180;
  const rb = (b * Math.PI) / 180;
  return wrapHue((Math.atan2(Math.sin(ra) + Math.sin(rb), Math.cos(ra) + Math.cos(rb)) * 180) / Math.PI);
}

const HUE_DRIFT = 12;

// --- Individuos y linaje ------------------------------------------------------

function freshId(generation: number, rng: Rng, taken: Set<string>): string {
  let id: string;
  do id = `${generation}-${(rng.int(0x10000) * 0x10000 + rng.int(0x10000)).toString(16).padStart(8, "0")}`;
  while (taken.has(id));
  taken.add(id);
  return id;
}

function nodeOf(ind: Individual): LineageNode {
  return {
    id: ind.id,
    parents: ind.parents.slice(),
    op: ind.op,
    generation: ind.generation,
    distance: null,
    trackId: null,
    genome: ind.genome,
    hue: ind.hue,
    humanTouched: isHumanOp(ind.op),
    prunedParents: false,
  };
}

function freshState(params: GaParams, trackId: TrackId, population: Individual[], rng: Rng): EvolutionState {
  return {
    v: 1,
    params,
    trackId,
    generation: 1,
    population,
    rng: rng.state(),
    history: [],
    favorites: [],
    stagnantFor: 0,
    effectiveMutationRate: params.mutationRate,
  };
}

/**
 * Generación 1. Los diseños del jugador cuentan como generación 0 (los hizo una
 * persona antes de que corra nada) y sus mutantes como 1: así todo padre tiene
 * una generación estrictamente menor que la de su hijo, también en la siembra.
 */
export function seedPopulation(
  rawParams: GaParams,
  trackId: TrackId,
  from: { kind: "random" } | { kind: "genomes"; items: { genome: Genome; sourceId?: string; op: "design" | "retouch" | "clone" }[] },
): { state: EvolutionState; lineageAdded: LineageNode[] } {
  const params = normalizeParams(rawParams);
  const rng = makeRng(params.seed);
  const taken = new Set<string>();
  const population: Individual[] = [];
  const hueOf = () => rng.float() * 360;

  if (from.kind === "random" || from.items.length === 0) {
    for (let i = 0; i < params.populationSize; i++) {
      const genome = randomGenome(rng.float);
      population.push({ id: freshId(1, rng, taken), genome, parents: [], op: "random", generation: 1, hue: hueOf() });
    }
  } else {
    const items = from.items.slice(0, params.populationSize);
    for (const it of items) {
      population.push({
        id: freshId(0, rng, taken),
        genome: normalizeGenome(it.genome),
        parents: it.sourceId ? [it.sourceId] : [],
        op: it.op,
        generation: 0,
        hue: hueOf(),
      });
    }
    const roots = population.slice();
    for (let i = 0; population.length < params.populationSize; i++) {
      const root = roots[i % roots.length];
      const genome = mutate(root.genome, params.mutationRate, params.mutationSize, rng, true);
      population.push({
        id: freshId(1, rng, taken),
        genome,
        parents: [root.id],
        op: "mutation",
        generation: 1,
        hue: wrapHue(root.hue + rng.gauss() * HUE_DRIFT),
      });
    }
  }
  return { state: freshState(params, trackId, population, rng), lineageAdded: population.map(nodeOf) };
}

// --- Generación siguiente -----------------------------------------------------

/** Distancia que cuenta para ordenar: un coche descalificado queda por debajo de cualquiera. */
function fitnessOf(r: CarResult): number {
  return r.reason === "anomaly" ? -1 : r.distance;
}

export function nextGeneration(
  state: EvolutionState,
  results: CarResult[],
): { state: EvolutionState; lineageAdded: LineageNode[] } {
  const byCar = new Map<string, CarResult>();
  for (const r of results) {
    if (r.trackId !== state.trackId) throw new Error(`Resultado de la pista ${r.trackId} en una evolución de ${state.trackId}`);
    byCar.set(r.carId, r);
  }
  const pop = state.population;
  const evaluated = pop.map((ind) => {
    const r = byCar.get(ind.id);
    if (!r) throw new Error(`Falta el resultado del coche ${ind.id}`);
    return r;
  });
  const fitness = evaluated.map(fitnessOf);
  const { params } = state;
  const rng = makeRng(state.rng);

  // Orden estable: a igual distancia gana el que va antes en la población.
  const order = pop.map((_, i) => i).sort((a, b) => fitness[b] - fitness[a] || a - b);
  const qualified = order.filter((i) => fitness[i] >= 0);
  const clampedDistance = (i: number) => Math.max(0, fitness[i]);
  const top = Math.max(1, Math.ceil(pop.length / 4));
  const stats: GenerationStats = {
    generation: state.generation,
    best: qualified.length > 0 ? fitness[qualified[0]] : 0,
    topQuarterMean: order.slice(0, top).reduce((s, i) => s + clampedDistance(i), 0) / top,
    mean: order.reduce((s, i) => s + clampedDistance(i), 0) / pop.length,
    bestId: pop[(qualified.length > 0 ? qualified : order)[0]].id,
  };

  // La referencia es la generación de la última mejora de al menos el 1 %.
  const refIndex = Math.max(0, state.history.length - 1 - state.stagnantFor);
  const ref = state.history.length > 0 ? state.history[refIndex].best : null;
  const improved = ref === null || stats.best > ref * (1 + STAGNATION_GAIN);
  const stagnantFor = improved ? 0 : state.stagnantFor + 1;
  const effectiveMutationRate =
    stagnantFor >= STAGNATION_WINDOW ? Math.min(MAX_EFFECTIVE_RATE, params.mutationRate * 2) : params.mutationRate;
  const history = [...state.history, stats].slice(-MAX_HISTORY);

  const generation = state.generation + 1;
  // Solo la mitad mejor es elegible como padre: con k = 2 sobre toda la población la presión
  // selectiva es tan baja que 15 generaciones no bastan para aprovechar a los buenos.
  const pool = (qualified.length > 0 ? qualified : order).slice(0, Math.max(2, Math.ceil(pop.length / 2)));
  const taken = new Set(pop.map((p) => p.id));
  const children: Individual[] = [];

  const tournament = (exclude?: number): number => {
    let winner = pool[rng.int(pool.length)];
    for (let tries = 0; tries < 4; tries++) {
      const rival = pool[rng.int(pool.length)];
      if (fitness[rival] > fitness[winner]) winner = rival;
      if (exclude === undefined || winner !== exclude) break;
    }
    return winner;
  };
  const breed = (firstParent: number, partner: number | null): Individual => {
    const a = pop[firstParent];
    if (partner !== null && partner !== firstParent) {
      const b = pop[partner];
      const genome = mutate(crossover(a.genome, b.genome, rng), effectiveMutationRate, params.mutationSize, rng, false);
      const mixed = meanHue(a.hue, b.hue);
      const changed = genomeHash(genome) !== genomeHash(a.genome) && genomeHash(genome) !== genomeHash(b.genome);
      const hue = changed ? wrapHue(mixed + rng.gauss() * HUE_DRIFT) : mixed;
      return { id: freshId(generation, rng, taken), genome, parents: [a.id, b.id], op: "crossover", generation, hue };
    }
    const genome = mutate(a.genome, effectiveMutationRate, params.mutationSize, rng, true);
    const same = genomeHash(genome) === genomeHash(a.genome);
    const hue = same ? a.hue : wrapHue(a.hue + rng.gauss() * HUE_DRIFT);
    return { id: freshId(generation, rng, taken), genome, parents: [a.id], op: same ? "clone" : "mutation", generation, hue };
  };

  for (const i of qualified.slice(0, params.eliteCount)) {
    const e = pop[i];
    children.push({ id: freshId(generation, rng, taken), genome: e.genome, parents: [e.id], op: "clone", generation, hue: e.hue });
  }
  // Descendencia segura de los favoritos, mientras quepa tras la élite.
  for (const favId of state.favorites) {
    const fi = pop.findIndex((p) => p.id === favId);
    if (fi < 0) continue;
    for (let k = 0; k < FAVORITE_CHILDREN && children.length < pop.length; k++) {
      children.push(breed(fi, k === 0 ? null : tournament(fi)));
    }
  }
  while (children.length < pop.length) {
    const a = tournament();
    children.push(breed(a, rng.float() < CROSSOVER_PROBABILITY ? tournament(a) : null));
  }

  const evaluatedNodes = pop.map((ind, i) => ({ ...nodeOf(ind), distance: evaluated[i].distance, trackId: evaluated[i].trackId }));
  return {
    state: {
      v: 1,
      params,
      trackId: state.trackId,
      generation,
      population: children,
      rng: rng.state(),
      history,
      favorites: [],
      stagnantFor,
      effectiveMutationRate,
    },
    // Primero la distancia ya conocida de la generación evaluada, luego los hijos.
    lineageAdded: [...evaluatedNodes, ...children.map(nodeOf)],
  };
}

/** Marca o desmarca un favorito de la población actual; un id desconocido no cambia nada. */
export function setFavorite(state: EvolutionState, id: string, on: boolean): EvolutionState {
  if (!state.population.some((p) => p.id === id)) return state;
  const rest = state.favorites.filter((f) => f !== id);
  return { ...state, favorites: on ? [...rest, id] : rest };
}
