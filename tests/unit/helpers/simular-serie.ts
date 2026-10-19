// Proceso hijo de nf-2: imprime el resultado del coche de serie en cada pista.
import { STOCK_CAR } from "../../../src/sim/genome";
import { simulateCar } from "../../../src/sim/race";
import { TRACKS } from "../../../src/sim/tracks";

const out: Record<string, { distance: number; steps: number; trackId: string }> = {};
for (const t of TRACKS) {
  const r = simulateCar(STOCK_CAR, t.id);
  out[t.id] = { distance: r.distance, steps: r.steps, trackId: r.trackId };
}
console.log(JSON.stringify(out));
