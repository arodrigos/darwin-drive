// nf-6: la física no premia los fallos. MEDIR_N cambia el número de genomas por pista (2000 por defecto).
import { randomGenome } from "../src/sim/genome";
import { simulateCar, type CarResult } from "../src/sim/race";
import { TRACKS } from "../src/sim/tracks";
import { seededRand } from "../tests/unit/helpers/rng";

const N = Number(process.env.MEDIR_N ?? 2000);
const MAX_ANOMALIAS = 0.01;

const rand = seededRand(606);
const genomas = Array.from({ length: N }, () => randomGenome(rand));

let fallo = false;
console.log(`medir-anomalias: ${N} genomas aleatorios por pista`);
for (const track of TRACKS) {
  const resultados: CarResult[] = genomas.map((g, i) => ({ ...simulateCar(g, track.id), carId: String(i) }));
  const anomalias = resultados.filter((r) => r.reason === "anomaly");
  const ordenados = [...resultados].sort((a, b) => b.distance - a.distance);
  const dist = ordenados.map((r) => r.distance);
  const q = (p: number) => dist[Math.min(dist.length - 1, Math.floor((1 - p) * dist.length))];
  const top = ordenados.slice(0, 10);
  const proporcion = anomalias.length / N;
  const topAnomalo = top.some((r) => r.reason === "anomaly");
  const ok = proporcion <= MAX_ANOMALIAS && !topAnomalo;
  if (!ok) fallo = true;
  console.log(
    `\n${track.id}: anomalías ${anomalias.length}/${N} (${(proporcion * 100).toFixed(2)} %), ` +
      `distancias p50 ${q(0.5).toFixed(1)} m, p90 ${q(0.9).toFixed(1)} m, p99 ${q(0.99).toFixed(1)} m, máx ${dist[0].toFixed(1)} m  ${ok ? "OK" : "FALLA"}`,
  );
  console.table(top.map((r, i) => ({ puesto: i + 1, distancia: Number(r.distance.toFixed(1)), motivo: r.reason, pasos: r.steps })));
}
if (fallo) process.exit(1);
console.log("\nmedir-anomalias: OK");
