import type { EvolutionState, GaParams, GenerationStats, Individual, Op } from "@/evolution/ga";
import { MAX_LINEAGE_NODES, type LineageNode } from "@/evolution/lineage";
import { CELL_COUNT, cellIndex, type SpeciesArchive, type SpeciesCell } from "@/evolution/species";
import { PHYSICS_VERSION } from "@/sim/constants";
import { genomeHash, normalizeGenome, type Genome } from "@/sim/genome";
import { getTrack, TRACKS, type TrackId } from "@/sim/tracks";
import { nombrePropuesto } from "@/app/nombres";
import { limpiarNombre, normalizarNombre } from "./nombres";

export const RANKING_SIZE = 10;
export const GARAGE_SIZE = 60;
const MAX_HISTORY = 500;

export type Origin = "diseño" | "evolución" | "mixto";

export interface RankingEntry {
  carId: string;
  genome: Genome;
  genomeHash: string;
  distance: number;
  origin: Origin;
  date: string;
  trackId: TrackId;
  trackVersion: number;
  physicsVersion: number;
  lineageId?: string;
  name?: string;
}

export interface SavedCar {
  id: string;
  name: string;
  genome: Genome;
  marks: Partial<Record<TrackId, number>>;
  origin: Origin;
  savedAt: string;
  lineageId?: string;
}

export type Rankings = Record<TrackId, RankingEntry[]>;
export type Warn = (message: string) => void;

export const KEY_RANKINGS = "dd:v1:rankings";
export const KEY_GARAGE = "dd:v1:garage";
export const KEY_EVOLUTION = "dd:v1:evolution";
export const KEY_LINEAGE = "dd:v1:lineage";
export const KEY_SPECIES = "dd:v1:species";

const ORIGINS: readonly Origin[] = ["diseño", "evolución", "mixto"];
const OPS: readonly Op[] = ["random", "design", "retouch", "clone", "crossover", "mutation"];

export function emptyRankings(): Rankings {
  return { cordillera: [], rampa: [], dunas: [], pedregal: [] };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isOrigin = (v: unknown): v is Origin => ORIGINS.includes(v as Origin);
const isOp = (v: unknown): v is Op => OPS.includes(v as Op);
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

/** Un genoma guardado tiene que ser un objeto: lo demás lo corrige normalizeGenome. */
function genomeOf(raw: unknown): Genome | null {
  return isObj(raw) ? normalizeGenome(raw) : null;
}

function rankingEntry(raw: unknown, trackId: TrackId): RankingEntry | null {
  if (!isObj(raw)) return null;
  const genome = genomeOf(raw.genome);
  const track = getTrack(raw.trackId);
  if (!genome || !track || track.id !== trackId) return null;
  if (!isStr(raw.carId) || !isNum(raw.distance) || raw.distance < 0 || !isOrigin(raw.origin) || !isDate(raw.date)) return null;
  if (!isInt(raw.trackVersion) || !isInt(raw.physicsVersion)) return null;
  const entry: RankingEntry = {
    carId: raw.carId,
    genome,
    genomeHash: genomeHash(genome),
    distance: raw.distance,
    origin: raw.origin,
    date: raw.date,
    trackId,
    trackVersion: raw.trackVersion,
    physicsVersion: raw.physicsVersion,
  };
  if (isStr(raw.lineageId)) entry.lineageId = raw.lineageId;
  if (isStr(raw.name)) {
    const nombre = limpiarNombre(raw.name);
    if (nombre) entry.name = nombre;
  }
  return entry;
}

/** Orden estable por distancia no creciente: a igual distancia, va delante la que ya estaba. */
export function normalizeRanking(entries: RankingEntry[]): RankingEntry[] {
  const seen = new Set<string>();
  const unique = entries.filter((e) => !seen.has(e.genomeHash) && !!seen.add(e.genomeHash));
  return unique.sort((a, b) => b.distance - a.distance).slice(0, RANKING_SIZE);
}

export function validateRankings(raw: unknown, warn: Warn = () => {}): Rankings | null {
  if (!isObj(raw)) return null;
  const out = emptyRankings();
  for (const key of Object.keys(raw)) {
    const track = getTrack(key);
    if (!track) {
      warn(`Se descartó el ranking de una pista que no existe («${key.slice(0, 30)}»).`);
      continue;
    }
    const list = raw[key];
    if (!Array.isArray(list)) {
      warn(`El ranking de ${track.name} no era válido y se ha descartado.`);
      continue;
    }
    const good: RankingEntry[] = [];
    let bad = 0;
    for (const item of list) {
      const e = rankingEntry(item, track.id);
      if (e) good.push(e);
      else bad++;
    }
    if (bad > 0) warn(`Se descartaron ${bad} entradas no válidas del ranking de ${track.name}.`);
    out[track.id] = normalizeRanking(good);
  }
  return out;
}

function savedCar(raw: unknown): SavedCar | null {
  if (!isObj(raw)) return null;
  const genome = genomeOf(raw.genome);
  if (!genome || !isStr(raw.id) || !isStr(raw.name) || !isOrigin(raw.origin) || !isDate(raw.savedAt) || !isObj(raw.marks)) return null;
  const marks: Partial<Record<TrackId, number>> = {};
  for (const t of TRACKS) {
    const m = raw.marks[t.id];
    if (m === undefined) continue;
    if (!isNum(m) || m < 0) return null;
    marks[t.id] = m;
  }
  const car: SavedCar = { id: raw.id, name: normalizarNombre(raw.name, nombrePropuesto(raw.id)), genome, marks, origin: raw.origin, savedAt: raw.savedAt };
  if (isStr(raw.lineageId)) car.lineageId = raw.lineageId;
  return car;
}

export function validateGarage(raw: unknown, warn: Warn = () => {}): SavedCar[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SavedCar[] = [];
  const ids = new Set<string>();
  let bad = 0;
  for (const item of raw) {
    const c = savedCar(item);
    if (c && !ids.has(c.id)) {
      ids.add(c.id);
      out.push(c);
    } else bad++;
  }
  if (bad > 0) warn(`Se descartaron ${bad} coches no válidos del garaje.`);
  return out.slice(0, GARAGE_SIZE);
}

function gaParams(raw: unknown): GaParams | null {
  if (!isObj(raw)) return null;
  if (!isInt(raw.populationSize) || raw.populationSize < 8 || raw.populationSize > 32) return null;
  if (!isInt(raw.eliteCount) || raw.eliteCount < 0 || raw.eliteCount > 4) return null;
  if (!isNum(raw.mutationRate) || raw.mutationRate < 0.01 || raw.mutationRate > 0.3) return null;
  if (raw.mutationSize !== "small" && raw.mutationSize !== "medium" && raw.mutationSize !== "large") return null;
  if (!isNum(raw.seed)) return null;
  return { populationSize: raw.populationSize, eliteCount: raw.eliteCount, mutationRate: raw.mutationRate, mutationSize: raw.mutationSize, seed: raw.seed };
}

function individual(raw: unknown): Individual | null {
  if (!isObj(raw)) return null;
  const genome = genomeOf(raw.genome);
  if (!genome || !isStr(raw.id) || !isStrArray(raw.parents) || !isOp(raw.op) || !isInt(raw.generation) || !isNum(raw.hue)) return null;
  return { id: raw.id, genome, parents: raw.parents, op: raw.op, generation: raw.generation, hue: raw.hue };
}

function stats(raw: unknown): GenerationStats | null {
  if (!isObj(raw)) return null;
  if (!isInt(raw.generation) || !isNum(raw.best) || !isNum(raw.topQuarterMean) || !isNum(raw.mean) || !isStr(raw.bestId)) return null;
  return { generation: raw.generation, best: raw.best, topQuarterMean: raw.topQuarterMean, mean: raw.mean, bestId: raw.bestId };
}

/** Todo o nada: una población a medias no se puede continuar. */
export function validateEvolution(raw: unknown): EvolutionState | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const params = gaParams(raw.params);
  const track = getTrack(raw.trackId);
  if (!params || !track || !isInt(raw.generation) || !Array.isArray(raw.population) || !Array.isArray(raw.history)) return null;
  if (!Array.isArray(raw.rng) || !raw.rng.every(isNum) || !isStrArray(raw.favorites)) return null;
  if (!isInt(raw.stagnantFor) || !isNum(raw.effectiveMutationRate)) return null;
  const population = raw.population.map(individual);
  const history = raw.history.map(stats);
  if (population.length === 0 || population.some((p) => p === null) || history.some((h) => h === null)) return null;
  return {
    v: 1,
    params,
    trackId: track.id,
    generation: raw.generation,
    population: population as Individual[],
    rng: raw.rng,
    history: (history as GenerationStats[]).slice(-MAX_HISTORY),
    favorites: raw.favorites,
    stagnantFor: raw.stagnantFor,
    effectiveMutationRate: raw.effectiveMutationRate,
  };
}

function lineageNode(raw: unknown): LineageNode | null {
  if (!isObj(raw)) return null;
  const genome = genomeOf(raw.genome);
  let trackId: TrackId | null = null;
  if (raw.trackId !== null) {
    const t = getTrack(raw.trackId);
    if (!t) return null;
    trackId = t.id;
  }
  if (raw.distance !== null && (!isNum(raw.distance) || raw.distance < 0)) return null;
  if (!genome || !isStr(raw.id) || !isStrArray(raw.parents) || !isOp(raw.op) || !isInt(raw.generation) || !isNum(raw.hue)) return null;
  if (typeof raw.humanTouched !== "boolean" || typeof raw.prunedParents !== "boolean") return null;
  return {
    id: raw.id,
    parents: raw.parents,
    op: raw.op,
    generation: raw.generation,
    distance: raw.distance as number | null,
    trackId,
    genome,
    hue: raw.hue,
    humanTouched: raw.humanTouched,
    prunedParents: raw.prunedParents,
  };
}

export function validateLineage(raw: unknown, warn: Warn = () => {}): LineageNode[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LineageNode[] = [];
  const ids = new Set<string>();
  let bad = 0;
  for (const item of raw) {
    const n = lineageNode(item);
    if (n && !ids.has(n.id)) {
      ids.add(n.id);
      out.push(n);
    } else bad++;
  }
  if (bad > 0) warn(`Se descartaron ${bad} nodos no válidos del linaje.`);
  return out.slice(-MAX_LINEAGE_NODES);
}

export type SpeciesArchives = Partial<Record<TrackId, SpeciesArchive>>;

function speciesCell(raw: unknown, index: number): SpeciesCell | null {
  if (!isObj(raw)) return null;
  const genome = genomeOf(raw.genome);
  if (!genome || !isStr(raw.carId) || !isNum(raw.distance) || raw.distance < 0 || !isInt(raw.batch)) return null;
  // Una celda solo vale si el coche es de esa especie: lo contrario rompería la invariante del archivo.
  if (cellIndex(genome) !== index) return null;
  return { carId: raw.carId, genome, distance: raw.distance, batch: raw.batch };
}

function speciesArchive(raw: unknown, trackId: TrackId): SpeciesArchive | null {
  if (!isObj(raw) || raw.v !== 1 || getTrack(raw.trackId)?.id !== trackId) return null;
  if (!isInt(raw.batch) || raw.batch < 0 || !Array.isArray(raw.rng) || raw.rng.length === 0 || !raw.rng.every(isNum)) return null;
  if (!isInt(raw.trackVersion) || !isInt(raw.physicsVersion) || !Array.isArray(raw.cells) || raw.cells.length !== CELL_COUNT) return null;
  const cells: (SpeciesCell | null)[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (raw.cells[i] === null) {
      cells.push(null);
      continue;
    }
    const cell = speciesCell(raw.cells[i], i);
    if (!cell) return null;
    cells.push(cell);
  }
  return { v: 1, trackId, trackVersion: raw.trackVersion, physicsVersion: raw.physicsVersion, batch: raw.batch, rng: raw.rng, cells };
}

/**
 * Un archivo por pista; uno inválido o de una pista desconocida se descarta solo, con aviso. Los de otra versión de
 * pista o de física también: sus marcas ya no son comparables y se vuelven a descubrir explorando.
 */
export function validateSpecies(raw: unknown, warn: Warn = () => {}): SpeciesArchives | null {
  if (!isObj(raw)) return null;
  const out: SpeciesArchives = {};
  for (const key of Object.keys(raw)) {
    const track = getTrack(key);
    if (!track) {
      warn(`Se descartó el archivo de especies de una pista que no existe («${key.slice(0, 30)}»).`);
      continue;
    }
    const archive = speciesArchive(raw[key], track.id);
    if (!archive) {
      warn(`El archivo de especies de ${track.name} no era válido y se ha descartado.`);
    } else if (archive.trackVersion !== track.version || archive.physicsVersion !== PHYSICS_VERSION) {
      warn(`El archivo de especies de ${track.name} era de una versión anterior del juego y se ha descartado.`);
    } else out[track.id] = archive;
  }
  return out;
}
