import "../sim/detmath";
import { crossover, makeRng, mutate, type Rng } from "./ga";
import { PHYSICS_VERSION, type CarResult } from "../sim/constants";
import { VERTEX_COUNT, genomeHash, randomGenome, type Genome } from "../sim/genome";
import { getTrack, type TrackId } from "../sim/tracks";

export const GRID_COLUMNS = 4;
export const GRID_ROWS = 4;
export const CELL_COUNT = GRID_COLUMNS * GRID_ROWS;
export const BATCH_SIZE = 8;
/** Largo horizontal de la carrocería, en m: los cortes entre las 4 franjas. */
export const LENGTH_EDGES = [1.5, 2.5, 3.5] as const;
const CROSSOVER_PROBABILITY = 0.3;
const MUTATION_RATE = 0.1;
// Un genoma repetido en el lote no aporta nada: se reintenta unas pocas veces y, si no, el lote sale más corto.
const RETRIES_PER_CAR = 6;

export interface SpeciesCell {
  carId: string;
  genome: Genome;
  distance: number;
  /** Lote en que entró en la celda. */
  batch: number;
  /** Versiones con que se midió la celda; solo las rellena la migración mientras el archivo aún lleva las antiguas. */
  trackVersion?: number;
  physicsVersion?: number;
}

/** Un archivo MAP-Elites de una sola pista: la mejor marca de cada especie, y solo medida en esa pista. */
export interface SpeciesArchive {
  v: 1;
  trackId: TrackId;
  trackVersion: number;
  physicsVersion: number;
  batch: number;
  rng: number[];
  cells: (SpeciesCell | null)[];
}

export interface BatchCar {
  carId: string;
  genome: Genome;
}

/** Largo horizontal de la carrocería: de su vértice más atrasado al más adelantado. */
export function bodyLength(genome: Genome): number {
  const xs = genome.body.map((v) => Math.cos(v.angle) * v.length);
  return Math.max(...xs) - Math.min(...xs);
}

export function activeWheels(genome: Genome): number {
  return genome.wheels.filter((w) => w.vertex >= 0 && w.vertex < VERTEX_COUNT).length;
}

/** Celda (fila = ruedas activas − 1, columna = franja de largo) o null si el coche no tiene ninguna rueda. */
export function cellIndex(genome: Genome): number | null {
  const wheels = activeWheels(genome);
  if (wheels < 1) return null;
  const length = bodyLength(genome);
  const column = LENGTH_EDGES.filter((edge) => length >= edge).length;
  return (wheels - 1) * GRID_COLUMNS + column;
}

export function emptyArchive(trackId: TrackId, seed: number): SpeciesArchive {
  const track = getTrack(trackId);
  if (!track) throw new Error(`Pista desconocida: ${String(trackId)}`);
  return {
    v: 1,
    trackId: track.id,
    trackVersion: track.version,
    physicsVersion: PHYSICS_VERSION,
    batch: 0,
    rng: makeRng(Math.trunc(seed)).state(),
    cells: Array.from({ length: CELL_COUNT }, () => null),
  };
}

export function discovered(archive: SpeciesArchive): number {
  return archive.cells.filter((c) => c !== null).length;
}

/**
 * Siguiente lote: con el archivo vacío, coches aleatorios; después, élites elegidas al azar y mutadas,
 * con un 30 % de cruce con otro élite. Solo depende del archivo (que lleva su PRNG), así que el mismo
 * archivo da siempre el mismo lote.
 */
export function planBatch(archive: SpeciesArchive, size: number = BATCH_SIZE): { archive: SpeciesArchive; cars: BatchCar[] } {
  const rng: Rng = makeRng(archive.rng);
  const elites = archive.cells.filter((c): c is SpeciesCell => c !== null);
  const seen = new Set<string>();
  const cars: BatchCar[] = [];
  const draw = (): Genome => {
    if (elites.length === 0) return randomGenome(rng.float);
    const parent = elites[rng.int(elites.length)];
    if (elites.length > 1 && rng.float() < CROSSOVER_PROBABILITY) {
      const other = elites[rng.int(elites.length)];
      return mutate(crossover(parent.genome, other.genome, rng), MUTATION_RATE, "medium", rng, false);
    }
    return mutate(parent.genome, MUTATION_RATE, "medium", rng, true);
  };
  for (let attempt = 0; cars.length < size && attempt < size * RETRIES_PER_CAR; attempt++) {
    const genome = draw();
    const carId = genomeHash(genome);
    if (seen.has(carId)) continue;
    seen.add(carId);
    cars.push({ carId, genome });
  }
  return { archive: { ...archive, rng: rng.state() }, cars };
}

/**
 * Coloca cada coche del lote en su celda si mejora la marca que había. Un resultado de otra pista, de otra
 * versión de física o de pista, o un coche que no estaba en el lote es un error de quien llama: lanza.
 */
export function integrateBatch(archive: SpeciesArchive, cars: BatchCar[], results: CarResult[]): SpeciesArchive {
  const genomes = new Map(cars.map((c) => [c.carId, c.genome]));
  const cells = archive.cells.slice();
  const batch = archive.batch + 1;
  for (const r of results) {
    if (r.trackId !== archive.trackId) throw new Error(`Resultado de la pista ${r.trackId} en el archivo de ${archive.trackId}`);
    if (r.trackVersion !== archive.trackVersion || r.physicsVersion !== archive.physicsVersion) {
      throw new Error("Resultado medido con otra versión de pista o de física");
    }
    const genome = genomes.get(r.carId);
    if (!genome) throw new Error(`El coche ${r.carId} no estaba en el lote`);
    if (r.reason === "anomaly") continue;
    const index = cellIndex(genome);
    if (index === null) continue;
    const current = cells[index];
    if (current === null || r.distance > current.distance) cells[index] = { carId: r.carId, genome, distance: r.distance, batch };
  }
  return { ...archive, batch, cells };
}
