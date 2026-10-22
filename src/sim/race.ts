import "./detmath";
import { CarSim } from "./physics/car-sim";
import { genomeHash, type Genome } from "./genome";
import { resolverPista, type TrackId } from "./tracks";
import { PHYSICS_VERSION, type CarPose, type CarResult } from "./constants";

export * from "./constants";

export interface Race {
  step(n?: number): void;
  poses(): CarPose[];
  /** Solo los coches que ya han terminado. */
  results(): CarResult[];
  done(): boolean;
  simTime(): number;
  dispose(): void;
}

const liveSims = new Set<CarSim>();

/** Cuerpos de Planck vivos en todo el proceso: la prueba de que cada mundo se libera. */
export function liveBodyCount(): number {
  let n = 0;
  for (const s of liveSims) n += s.bodyCount;
  return n;
}

/**
 * Un mundo de Planck por coche: cada coche avanza sus propios pasos de DT, así
 * su resultado no depende de con quién corre ni de cómo se troceen los pasos.
 * `heightFn` y `maxSteps` solo son para tests: sustituyen el perfil de la pista
 * y acortan la carrera para que una evolución entera quepa en un test; `sinDiagnostico`, `friccionSuelo` y `caida` (metros extra de altura al salir, para medir la rotura) también.
 */
export function createRace(
  cars: { carId: string; genome: Genome }[],
  trackId: TrackId,
  opts?: { heightFn?: (x: number) => number; maxSteps?: number; sinDiagnostico?: boolean; friccionSuelo?: number; caida?: number },
): Race {
  const track = resolverPista(trackId);
  if (!track) throw new Error(`Pista desconocida: ${String(trackId)}`);
  const heightAt = opts?.heightFn ?? track.heightAt;
  const sims = cars.map((c) => new CarSim(c.carId, c.genome, track, heightAt, opts?.maxSteps, opts));
  for (const s of sims) liveSims.add(s);
  let steps = 0;

  const isDone = () => sims.every((s) => s.isDone());
  const release = (s: CarSim) => {
    s.dispose();
    liveSims.delete(s);
  };

  return {
    step(n = 1) {
      for (let i = 0; i < n && !isDone(); i++) {
        for (const s of sims) {
          if (s.isDone()) continue;
          s.step();
          if (s.isDone()) liveSims.delete(s);
        }
        steps++;
      }
    },
    poses: () => sims.map((s) => s.pose()),
    results: () => sims.flatMap((s) => s.result() ?? []),
    done: isDone,
    simTime: () => steps / 60,
    dispose() {
      for (const s of sims) release(s);
    },
  };
}

/** Resultado de un coche corriendo solo hasta el final. */
export function simulateCar(genome: Genome, trackId: TrackId): CarResult {
  const race = createRace([{ carId: genomeHash(genome), genome }], trackId);
  while (!race.done()) race.step(60);
  const result = race.results()[0];
  race.dispose();
  return result;
}

const MAX_CACHE = 400;

/** Resultados ya simulados: la misma entrada (genoma, pista, versiones) da siempre lo mismo, así que no se repite. */
export class CacheResultados {
  private readonly mapa = new Map<string, CarResult>();
  simulaciones = 0;

  private clave(genome: Genome, trackId: TrackId): string {
    const t = resolverPista(trackId);
    return `${genomeHash(genome)}/${trackId}/${t?.version ?? 0}/${PHYSICS_VERSION}`;
  }

  simular(genome: Genome, trackId: TrackId): CarResult {
    const k = this.clave(genome, trackId);
    let r = this.mapa.get(k);
    if (!r) {
      r = simulateCar(genome, trackId);
      this.simulaciones++;
      if (this.mapa.size >= MAX_CACHE) this.mapa.delete(this.mapa.keys().next().value as string);
      this.mapa.set(k, r);
    }
    return { ...r };
  }
}

export const cacheGlobal = new CacheResultados();
