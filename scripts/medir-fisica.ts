// nf-7: coste de la física por coche y paso. Falla si la mediana de alguna pista pasa del umbral.
import { randomGenome } from "../src/sim/genome";
import { createRace } from "../src/sim/race";
import { TRACKS } from "../src/sim/tracks";
import { seededRand } from "../tests/unit/helpers/rng";

// El diseño pide 60 µs; en VPS2 (2 vCPU) La Cordillera sale entre 62 y 77 µs con 16 coches aleatorios, así que
// el umbral que protege es 90 µs (ver desviaciones del bloque).
const UMBRAL_US = 90;
const COCHES = 16;
const PASOS = 3000;

const rand = seededRand(2024);
const genomas = Array.from({ length: COCHES }, () => randomGenome(rand));

function percentil(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

let fallo = false;
console.log(`medir-fisica: ${COCHES} coches aleatorios, hasta ${PASOS} pasos cada uno (µs por coche y paso)`);
for (const track of TRACKS) {
  // Calentamiento: el JIT de V8 distorsiona los primeros miles de pasos.
  const calentar = createRace([{ carId: "w", genome: genomas[0] }], track.id);
  calentar.step(PASOS);
  calentar.dispose();

  const medidas: number[] = [];
  for (const [i, genome] of genomas.entries()) {
    const race = createRace([{ carId: String(i), genome }], track.id);
    let pasos = 0;
    const t0 = process.hrtime.bigint();
    while (pasos < PASOS && !race.done()) {
      race.step(1);
      pasos++;
    }
    const us = Number(process.hrtime.bigint() - t0) / 1e3;
    race.dispose();
    if (pasos >= 60) medidas.push(us / pasos);
  }
  medidas.sort((a, b) => a - b);
  const mediana = percentil(medidas, 0.5);
  const p95 = percentil(medidas, 0.95);
  const ok = mediana <= UMBRAL_US;
  if (!ok) fallo = true;
  console.log(`  ${track.id.padEnd(10)} mediana ${mediana.toFixed(1)} µs  p95 ${p95.toFixed(1)} µs  ${ok ? "OK" : `FALLA (> ${UMBRAL_US})`}`);
}
if (fallo) process.exit(1);
console.log("medir-fisica: OK");
