import { RaceEngine } from "./engine";
import type { FromWorker, ToWorker } from "./protocol";

const TICK_MS = 8;
const BUDGET_MS = 6;

const engine = new RaceEngine((m: FromWorker) => postMessage(m));
let timer: ReturnType<typeof setInterval> | null = null;

function sync(): void {
  if (engine.active() && timer === null) {
    timer = setInterval(() => {
      engine.tick(BUDGET_MS);
      if (!engine.active()) sync();
    }, TICK_MS);
  } else if (!engine.active() && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  engine.handle(e.data);
  sync();
};
