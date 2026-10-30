import { createRace, DT } from "../sim/race";
import { genomeHash, type Genome } from "../sim/genome";
import type { CarPose, CarResult } from "../sim/constants";
import type { TrackId } from "../sim/tracks";
import { medallaDe, type Medalla } from "../app/medallas";

export const ANCHO = 640;
export const ALTO = 360;
export const FPS = 30;
export const MAX_DURACION_S = 20;
export const MOTIVO_NO_COINCIDE = "La repetición no coincide con la marca guardada";

export interface EntradaClip {
  genome: Genome;
  trackId: TrackId;
  trackVersion: number;
  nombre: string;
  /** #rrggbb del coche. */
  color: string;
  /** La marca guardada: lo que la repetición tiene que reproducir. */
  distancia: number;
}

export interface PlanClip {
  /** Pasos de DT de la carrera entera. */
  pasos: number;
  /** Segundos simulados que dura cada segundo de vídeo; entero. */
  factor: number;
  fotogramas: number;
  duracionS: number;
}

export interface Fotograma {
  indice: number;
  /** Marca de tiempo en segundos: estrictamente creciente, de 1/FPS en 1/FPS. */
  ts: number;
  pose: CarPose;
  distancia: number;
  medalla: Medalla | null;
  factor: number;
}

/** Un clip dura entre 1 s y 20 s: una carrera más larga se acelera por un factor entero. */
export function planClip(pasos: number): PlanClip {
  const simS = pasos * DT;
  const factor = Math.max(1, Math.ceil(simS / MAX_DURACION_S));
  const fotogramas = Math.min(MAX_DURACION_S * FPS, Math.max(FPS, Math.ceil((simS / factor) * FPS)));
  return { pasos, factor, fotogramas, duracionS: fotogramas / FPS };
}

export const tsFotograma = (i: number): number => i / FPS;

/** Carrera de un solo coche hasta el final: la distancia que tiene que dar es la de la marca guardada. */
export function resimular(entrada: EntradaClip): CarResult {
  const race = createRace([{ carId: genomeHash(entrada.genome), genome: entrada.genome }], entrada.trackId);
  try {
    while (!race.done()) race.step(600);
    return race.results()[0];
  } finally {
    race.dispose();
  }
}

/** Rechaza con el motivo del criterio clip-2 si la repetición no reproduce la marca. */
export function verificar(entrada: EntradaClip): { resultado: CarResult; plan: PlanClip } {
  const resultado = resimular(entrada);
  if (Math.abs(resultado.distance - entrada.distancia) > 1e-9) throw new Error(MOTIVO_NO_COINCIDE);
  return { resultado, plan: planClip(resultado.steps) };
}

/**
 * Los fotogramas se sacan de una segunda carrera, en orden: la primera solo dice cuánto dura. El último fotograma
 * cae siempre en el final real para que el rótulo termine en la distancia de la marca.
 */
export function* fotogramas(entrada: EntradaClip, plan: PlanClip, resultado: CarResult): Generator<Fotograma> {
  const race = createRace([{ carId: genomeHash(entrada.genome), genome: entrada.genome }], entrada.trackId);
  try {
    let paso = 0;
    let x0: number | null = null;
    let maxima = 0;
    for (let i = 0; i < plan.fotogramas; i++) {
      const ultimo = i === plan.fotogramas - 1;
      const objetivo = ultimo ? plan.pasos : Math.min(plan.pasos, i * 2 * plan.factor);
      race.step(objetivo - paso);
      paso = objetivo;
      const pose = race.poses()[0];
      x0 ??= pose.x;
      maxima = ultimo ? resultado.distance : Math.max(maxima, Math.min(resultado.distance, pose.x - x0));
      const medalla = medallaDe(entrada.trackId, entrada.trackVersion, {
        distance: maxima,
        bestStep: paso,
        reason: ultimo ? resultado.reason : "stall",
      });
      yield { indice: i, ts: tsFotograma(i), pose, distancia: maxima, medalla, factor: plan.factor };
    }
  } finally {
    race.dispose();
  }
}
