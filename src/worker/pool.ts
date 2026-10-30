import type { CarPose, CarResult } from "../sim/constants";
import type { FromWorker, SimRunner, ToWorker } from "./protocol";

const MAX_POOL = 4;
const MIN_COCHES_POOL = 8;

/**
 * Subrunners para una carrera turbo. Con pocos coches repartir cuesta más (arrancar Workers,
 * copiar genomas) que lo que ahorra, y sin `hardwareConcurrency` no se sabe si hay núcleos de sobra.
 * `forzado` es solo para pruebas (?workers=N) y manda sobre el resto.
 */
export function tamPool(hc: number | undefined, n: number, forzado?: number): number {
  if (forzado !== undefined && Number.isFinite(forzado)) return Math.min(MAX_POOL, Math.max(1, Math.floor(forzado)));
  if (hc === undefined || !Number.isFinite(hc) || n < MIN_COCHES_POOL) return 1;
  return Math.min(MAX_POOL, Math.max(1, Math.floor(hc) - 1));
}

interface Carrera {
  raceId: string;
  total: number;
  /** Trozos contiguos de la entrada: reensamblados en orden dan el mismo `results` que un solo runner. */
  resultados: (CarResult[] | null)[];
  progreso: (Extract<FromWorker, { type: "progress" }> | null)[];
  poses: (Extract<FromWorker, { type: "poses" }> | null)[];
  emitidos: Set<string>;
  fallida: boolean;
}

/**
 * Un `SimRunner` que reparte `startRace` entre `n` subrunners y presenta sus mensajes como los de uno solo.
 * El resultado de cada coche solo depende de sus pasos de DT (ver `createRace`), así que repartir no lo cambia.
 */
export function crearPoolRunner(crear: () => SimRunner, n: number): SimRunner {
  const tam = Math.max(1, Math.floor(n));
  const subs = Array.from({ length: tam }, crear);
  const oyentes = new Set<(m: FromWorker) => void>();
  let carrera: Carrera | null = null;
  const emitir = (m: FromWorker) => oyentes.forEach((l) => l(m));

  const alRecibir = (i: number, m: FromWorker) => {
    const c = carrera;
    if (!c || c.fallida || m.raceId !== c.raceId) return;
    switch (m.type) {
      case "carFinished":
        // El motor puede repetir un resultado al terminar coches fuera de orden; aquí se emite una vez.
        if (c.emitidos.has(m.result.carId)) return;
        c.emitidos.add(m.result.carId);
        emitir(m);
        return;
      case "progress": {
        c.progreso[i] = m;
        const ps = c.progreso.filter((p) => p !== null);
        emitir({
          type: "progress",
          raceId: c.raceId,
          finished: ps.reduce((a, p) => a + p.finished, 0),
          total: c.total,
          leaderX: Math.max(0, ...ps.map((p) => p.leaderX ?? 0)),
          simTime: Math.max(0, ...ps.map((p) => p.simTime ?? 0)),
          ritmoReal: ps.every((p) => p.ritmoReal !== undefined) ? Math.min(...ps.map((p) => p.ritmoReal!)) : undefined,
        });
        return;
      }
      case "poses": {
        c.poses[i] = m;
        const ps = c.poses.filter((p) => p !== null);
        if (ps.length < c.poses.length) return;
        const poses: CarPose[] = ps.flatMap((p) => p.poses);
        emitir({ type: "poses", raceId: c.raceId, simTime: Math.max(...ps.map((p) => p.simTime)), poses, fantasma: ps[0].fantasma });
        return;
      }
      case "raceDone": {
        c.resultados[i] = m.results;
        if (c.resultados.some((r) => r === null)) return;
        const results = c.resultados.flatMap((r) => r!);
        // RaceEngine puede saltarse el carFinished de un coche que termina antes que uno anterior de su lista; raceDone los trae todos.
        for (const result of results) {
          if (c.emitidos.has(result.carId)) continue;
          c.emitidos.add(result.carId);
          emitir({ type: "carFinished", raceId: c.raceId, result });
        }
        emitir({ type: "raceDone", raceId: c.raceId, results });
        return;
      }
      case "fantasmaFin":
        emitir(m);
        return;
      case "error":
        // Un único error: los demás subrunners ya no aportan nada a una carrera rota.
        c.fallida = true;
        subs.forEach((s) => s.post({ type: "stop", raceId: c.raceId }));
        emitir(m);
        return;
    }
  };
  subs.forEach((s, i) => s.subscribe((m) => alRecibir(i, m)));

  return {
    kind: subs[0].kind,
    post(msg: ToWorker) {
      if (msg.type !== "startRace") {
        subs.forEach((s) => s.post(msg));
        return;
      }
      const usados = Math.max(1, Math.min(tam, msg.cars.length));
      const trozo = Math.ceil(msg.cars.length / usados);
      carrera = {
        raceId: msg.raceId,
        total: msg.cars.length,
        resultados: Array.from({ length: usados }, () => null),
        progreso: Array.from({ length: usados }, () => null),
        poses: Array.from({ length: usados }, () => null),
        emitidos: new Set(),
        fallida: false,
      };
      // Los subrunners sobrantes paran la carrera anterior, si la había, para no seguir gastando CPU.
      subs.forEach((s, i) => {
        if (i < usados) s.post({ ...msg, cars: msg.cars.slice(i * trozo, (i + 1) * trozo), fantasma: i === 0 ? msg.fantasma : undefined });
        else s.post({ type: "stop", raceId: msg.raceId });
      });
    },
    subscribe(listener) {
      oyentes.add(listener);
      return () => oyentes.delete(listener);
    },
    terminate() {
      subs.forEach((s) => s.terminate());
      oyentes.clear();
    },
  };
}
