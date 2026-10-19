import { RaceEngine } from "./engine";
import type { FromWorker, SimRunner, ToWorker } from "./protocol";

// Trozos de 8 ms cada 16 ms: el hilo principal conserva la mitad del tiempo para pintar.
const TICK_MS = 16;
const BUDGET_MS = 8;

/** Alternativa sin Worker: el mismo RaceEngine, en el hilo principal. */
export function createInlineRunner(): SimRunner {
  const listeners = new Set<(m: FromWorker) => void>();
  const engine = new RaceEngine((m) => listeners.forEach((l) => l(m)));
  let timer: ReturnType<typeof setInterval> | null = null;

  const sync = () => {
    if (engine.active() && timer === null) {
      timer = setInterval(() => {
        engine.tick(BUDGET_MS);
        if (!engine.active()) sync();
      }, TICK_MS);
    } else if (!engine.active() && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    kind: "en-linea",
    post(msg: ToWorker) {
      engine.handle(msg);
      sync();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };
}
