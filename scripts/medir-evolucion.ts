// ga-2 y ga-8: la evolución mejora la población entera y La Cordillera no tiene un muro. Física real, sin atajos.
import { DEFAULT_PARAMS } from "../src/evolution/ga";
import { getTrack, type TrackId } from "../src/sim/tracks";
import type { CarResult } from "../src/sim/constants";
import { evolve } from "../tests/unit/helpers/evolucionar";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const generaciones = Number(arg("generaciones", "15"));
const semillas = arg("semillas", "1,2,3").split(",").map(Number);
const pistas = arg("pistas", "cordillera,rampa").split(",");
const FACTOR_MEDIANA = 1.5;
const FACTOR_MEJOR = 1.25;
const BASE_MINIMA_MEDIANA = 10;
const BASE_MINIMA_MEJOR = 1;
const VENTANA_MURO = 20;

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** El mejor no descalificado: una anomalía no cuenta como marca. */
function campeon(rs: CarResult[]): CarResult | undefined {
  return rs.filter((r) => r.reason !== "anomaly").sort((a, b) => b.distance - a.distance)[0];
}

interface Fila {
  pista: string;
  seed: number;
  med1: number;
  med15: number;
  cocMed: number;
  mej1: number;
  mej15: number;
  cocMej: number;
  reason: string;
  x: number;
  decrece: boolean;
  ok: boolean;
}

const filas: Fila[] = [];
for (const pista of pistas) {
  if (!getTrack(pista)) throw new Error(`Pista desconocida: ${pista}`);
  for (const seed of semillas) {
    const t0 = Date.now();
    const ev = evolve({ ...DEFAULT_PARAMS, seed }, pista as TrackId, generaciones);
    const best = ev.results.map((rs) => campeon(rs)?.distance ?? 0);
    const med = ev.results.map((rs) => mediana(rs.map((r) => r.distance)));
    const mean = ev.results.map((rs) => rs.reduce((s, r) => s + r.distance, 0) / rs.length);
    const ultimo = campeon(ev.results[ev.results.length - 1]);
    const n = best.length - 1;
    const cocMed = med[n] / Math.max(BASE_MINIMA_MEDIANA, med[0]);
    const cocMej = best[n] / Math.max(BASE_MINIMA_MEJOR, best[0]);
    const decrece = best.some((b, i) => i > 0 && b < best[i - 1]);
    const ok = cocMed >= FACTOR_MEDIANA && cocMej >= FACTOR_MEJOR && !decrece;
    filas.push({
      pista, seed, med1: med[0], med15: med[n], cocMed, mej1: best[0], mej15: best[n], cocMej,
      reason: ultimo?.reason ?? "-", x: ultimo?.distance ?? 0, decrece, ok,
    });
    console.log(`\n${pista} semilla ${seed} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    console.log(best.map((b, i) => `g${i + 1} mejor ${b.toFixed(1)} mediana ${med[i].toFixed(1)} media ${mean[i].toFixed(1)}`).join("\n"));
  }
}

console.log("\npista     semilla  med(1)  med(15)  ×med  mejor(1)  mejor(15)  ×mejor  motivo   x final  estado");
for (const f of filas) {
  console.log(
    `${f.pista.padEnd(9)} ${String(f.seed).padEnd(7)} ${f.med1.toFixed(1).padStart(7)} ${f.med15.toFixed(1).padStart(8)} ${f.cocMed.toFixed(2).padStart(5)} ` +
      `${f.mej1.toFixed(1).padStart(8)} ${f.mej15.toFixed(1).padStart(10)} ${f.cocMej.toFixed(2).padStart(7)}  ${f.reason.padEnd(8)} ${f.x.toFixed(1).padStart(7)}  ` +
      `${f.decrece ? "EL MEJOR DECRECE " : ""}${f.ok ? "OK" : "FALLA"}`,
  );
}

let fallo = filas.some((f) => !f.ok);

// ga-8: muro de La Cordillera. Tres atascos en una ventana de 20 m = el ranking acabaría en empate al pie del muro.
const cord = filas.filter((f) => f.pista === "cordillera");
if (cord.length >= 3) {
  const xs = cord.map((f) => f.x);
  const ventana = Math.max(...xs) - Math.min(...xs);
  const todosStall = cord.every((f) => f.reason === "stall");
  const todosTimeout = cord.every((f) => f.reason === "timeout");
  console.log(`\nga-8 La Cordillera: motivos ${cord.map((f) => f.reason).join("/")}, ventana de x finales ${ventana.toFixed(1)} m`);
  if (todosStall && ventana <= VENTANA_MURO) {
    console.log("ga-8 FALLA: los tres mejores se atascan en la misma ventana (muro)");
    fallo = true;
  } else if (todosTimeout) {
    console.log("ga-8: techo por tiempo (anotado para Adrián)");
  } else {
    console.log("ga-8 OK");
  }
}

if (fallo) process.exit(1);
console.log("\nmedir-evolucion: OK");
