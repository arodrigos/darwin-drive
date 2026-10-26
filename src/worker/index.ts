import type { TrackId } from "../sim/tracks";
import { createInlineRunner } from "./inline";
import type { FromWorker, SimRunner, ToWorker } from "./protocol";

export interface RunnerOptions {
  /** false fuerza la alternativa en línea (?worker=0 con ?pruebas=1). */
  worker?: boolean;
  /** Solo pruebas: la primera carrera lanzada falla dentro del ejecutor, por su camino real de error. */
  failFirstStart?: boolean;
}

function createWorkerRunner(onSilentFailure: () => void): SimRunner | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  const listeners = new Set<(m: FromWorker) => void>();
  let heard = false;
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    heard = true;
    listeners.forEach((l) => l(e.data));
  };
  // Un fallo de carga del script (sin ningún mensaje) no es un error de la carrera: se pasa a la alternativa.
  worker.onerror = () => {
    if (!heard) onSilentFailure();
  };
  return {
    kind: "worker",
    post: (msg) => worker.postMessage(msg),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      worker.terminate();
      listeners.clear();
    },
  };
}

/** Worker real si el navegador lo permite; si no, el mismo motor en línea. Misma interfaz y mismo resultado. */
export function createSimRunner(opts: RunnerOptions = {}): SimRunner {
  const listeners = new Set<(m: FromWorker) => void>();
  let lastStart: ToWorker | null = null;
  let lastFuerzas: ToWorker | null = null;
  let failPending = Boolean(opts.failFirstStart);
  let inner: SimRunner;
  let unsubscribe: () => void = () => {};

  const attach = (r: SimRunner) => {
    unsubscribe();
    inner = r;
    unsubscribe = r.subscribe((m) => listeners.forEach((l) => l(m)));
  };
  const fallBack = () => {
    inner.terminate();
    attach(createInlineRunner());
    if (lastFuerzas) inner.post(lastFuerzas);
    if (lastStart) inner.post(lastStart);
  };

  const worker = opts.worker === false || typeof Worker === "undefined" ? null : createWorkerRunner(() => fallBack());
  attach(worker ?? createInlineRunner());

  return {
    get kind() {
      return inner.kind;
    },
    post(msg) {
      if (msg.type === "startRace") {
        if (failPending) {
          failPending = false;
          msg = { ...msg, trackId: "__fallo__" as TrackId };
        }
        lastStart = msg;
      }
      if (msg.type === "setFuerzas") lastFuerzas = msg;
      inner.post(msg);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      unsubscribe();
      inner.terminate();
      listeners.clear();
    },
  };
}
