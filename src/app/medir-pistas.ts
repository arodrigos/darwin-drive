import type { CarResult } from "../sim/constants";
import type { Genome } from "../sim/genome";
import { DT } from "../sim/race";
import { TRACKS, type TrackId } from "../sim/tracks";
import type { FromWorker, SimRunner } from "../worker/protocol";

export interface MarcaPista<O> {
  trackId: TrackId;
  result: CarResult;
  /** Lo que devolvió `registrar` para esta marca; null si la carrera falló antes. */
  outcome: O;
}

export interface MedicionEnCurso<O> {
  /** Resuelve con una marca por pista del catálogo, en su orden. Rechaza si el ejecutor falla. */
  terminada: Promise<MarcaPista<O>[]>;
  /** Avanza sin reloj los segundos simulados indicados, pasando de una pista a la siguiente si hace falta. */
  avanzar(segundos: number): Promise<void>;
  cancelar(): void;
}

/**
 * Corre un coche, una pista tras otra, en turbo. Cada carrera es su propio mundo, así que
 * la marca de una pista es la de simulateCar(genoma, pista) y no depende de las demás.
 * `registrar` se llama una vez por marca, con el resultado de esa pista y solo ese.
 */
export function medirEnTodasLasPistas<O>(opts: {
  runner: SimRunner;
  carId: string;
  genome: Genome;
  onProgress: (n: number, total: number) => void;
  registrar: (result: CarResult) => Promise<O>;
}): MedicionEnCurso<O> {
  const { runner, carId, genome } = opts;
  const total = TRACKS.length;
  const marcas: MarcaPista<O>[] = [];
  let raceId = "";
  let enCarrera = false;
  let cancelada = false;
  let acabada = false;
  // Segundos simulados de las carreras ya terminadas más lo que lleva la actual.
  let simTerminadas = 0;
  let simActual = 0;
  const objetivos: { hasta: number; resolver: () => void }[] = [];
  let rechazar: (e: Error) => void = () => {};
  let unsubscribe: () => void = () => {};

  const simulado = () => simTerminadas + simActual;

  const atender = () => {
    for (let i = objetivos.length - 1; i >= 0; i--) {
      // Menos de un paso por dar: empujar otra vez no avanzaría nada y dejaría el bucle girando.
      if (acabada || objetivos[i].hasta - simulado() < DT) objetivos.splice(i, 1)[0].resolver();
    }
    // Un avanzar pendiente sigue empujando la carrera en curso hasta cumplirse.
    if (enCarrera && objetivos.length > 0) {
      const hasta = Math.max(...objetivos.map((o) => o.hasta));
      runner.post({ type: "advance", raceId, seconds: hasta - simulado() });
    }
  };

  const terminada = new Promise<MarcaPista<O>[]>((resolver, rechaz) => {
    rechazar = rechaz;
    let indice = 0;

    const siguiente = () => {
      if (cancelada) return;
      if (indice >= total) {
        acabada = true;
        atender();
        resolver(marcas);
        return;
      }
      const track = TRACKS[indice];
      opts.onProgress(indice + 1, total);
      raceId = `medir-${track.id}`;
      simActual = 0;
      enCarrera = true;
      runner.post({ type: "startRace", raceId, cars: [{ carId, genome }], trackId: track.id, pace: "turbo" });
      atender();
    };

    unsubscribe = runner.subscribe((m: FromWorker) => {
      if (m.raceId !== raceId || cancelada) return;
      if (m.type === "poses") {
        simActual = m.simTime;
        // Diferido: el motor emite las poses finales justo antes de raceDone, y empujarlo desde aquí lo reentraría.
        queueMicrotask(atender);
      } else if (m.type === "raceDone") {
        const result = m.results[0];
        enCarrera = false;
        simTerminadas += result.steps * DT;
        simActual = 0;
        indice++;
        opts
          .registrar(result)
          .then((outcome) => {
            marcas.push({ trackId: result.trackId, result, outcome });
            siguiente();
          })
          .catch((e: unknown) => rechaz(e instanceof Error ? e : new Error(String(e))));
      } else if (m.type === "error") {
        enCarrera = false;
        rechaz(new Error(m.message));
      }
    });
    siguiente();
  });
  // Sin esto, cancelar() dejaría un rechazo sin atender.
  terminada.catch(() => {});
  terminada.finally(() => unsubscribe()).catch(() => {});

  return {
    terminada,
    avanzar(segundos) {
      if (acabada || cancelada) return Promise.resolve();
      return new Promise<void>((resolver) => {
        objetivos.push({ hasta: simulado() + segundos, resolver });
        if (enCarrera) runner.post({ type: "advance", raceId, seconds: segundos });
      });
    },
    cancelar() {
      cancelada = true;
      enCarrera = false;
      runner.post({ type: "stop", raceId });
      unsubscribe();
      objetivos.splice(0).forEach((o) => o.resolver());
      rechazar(new Error("medición cancelada"));
    },
  };
}
