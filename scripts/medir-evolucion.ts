// ga-2: la evolución mejora de verdad y el mejor nunca empeora. Física real, sin atajos.
import { DEFAULT_PARAMS } from "../src/evolution/ga";
import { getTrack, type TrackId } from "../src/sim/tracks";
import { evolve } from "../tests/unit/helpers/evolucionar";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const generaciones = Number(arg("generaciones", "15"));
const semillas = arg("semillas", "1,2,3").split(",").map(Number);
const pistas = arg("pistas", "cordillera,rampa").split(",");
const FACTOR_MINIMO = 1.5;

let fallo = false;
for (const pista of pistas) {
  if (!getTrack(pista)) throw new Error(`Pista desconocida: ${pista}`);
  for (const seed of semillas) {
    const t0 = Date.now();
    const ev = evolve({ ...DEFAULT_PARAMS, seed }, pista as TrackId, generaciones);
    const best = ev.results.map((rs) => Math.max(0, ...rs.filter((r) => r.reason !== "anomaly").map((r) => r.distance)));
    const mean = ev.results.map((rs) => rs.reduce((s, r) => s + r.distance, 0) / rs.length);
    const factor = best[best.length - 1] / Math.max(1, best[0]);
    const decrece = best.some((b, i) => i > 0 && b < best[i - 1]);
    const ok = factor >= FACTOR_MINIMO && !decrece;
    if (!ok) fallo = true;
    console.log(`\n${pista} semilla ${seed}: ×${factor.toFixed(2)} ${decrece ? "EL MEJOR DECRECE " : ""}${ok ? "OK" : "FALLA"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    console.log(best.map((b, i) => `g${i + 1} ${b.toFixed(1)}/${mean[i].toFixed(1)}`).join("  "));
  }
}
if (fallo) process.exit(1);
console.log("\nmedir-evolucion: OK");
