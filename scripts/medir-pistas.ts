// nf-9: cada pista premia coches distintos (Spearman entre pistas y mejor coche no único).
import { randomGenome, genomeHash } from "../src/sim/genome";
import { simulateCar } from "../src/sim/race";
import { TRACKS } from "../src/sim/tracks";
import { seededRand } from "../tests/unit/helpers/rng";

const N = Number(process.env.MEDIR_N ?? 200);
const rand = seededRand(909);
const genomas = Array.from({ length: N }, () => randomGenome(rand));
const dist: number[][] = TRACKS.map((t) => genomas.map((g) => simulateCar(g, t.id).distance));

function rangos(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const medio = (i + j) / 2 + 1; // empates: rango medio
    for (let k = i; k <= j; k++) r[idx[k][1]] = medio;
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

const rk = dist.map(rangos);
const matriz = TRACKS.map((_, i) => TRACKS.map((_, j) => pearson(rk[i], rk[j])));
console.log(`medir-pistas: Spearman entre pistas con ${N} genomas aleatorios`);
console.table(
  Object.fromEntries(TRACKS.map((t, i) => [t.id, Object.fromEntries(TRACKS.map((u, j) => [u.id, Number(matriz[i][j].toFixed(3))]))])),
);

let pares = 0;
let total = 0;
for (let i = 0; i < TRACKS.length; i++)
  for (let j = i + 1; j < TRACKS.length; j++) {
    total++;
    if (matriz[i][j] < 0.9) pares++;
  }

const mejores = dist.map((d) => d.indexOf(Math.max(...d)));
console.log("\nMejor coche de cada pista y sus distancias (m) en las otras:");
console.table(
  TRACKS.map((t, i) => ({
    pista: t.id,
    coche: genomeHash(genomas[mejores[i]]).slice(0, 8),
    ...Object.fromEntries(TRACKS.map((u, j) => [u.id, Number(dist[j][mejores[i]].toFixed(1))])),
  })),
);

const distintos = new Set(mejores).size > 1;
console.log(`Pares con Spearman < 0,9: ${pares} de ${total} (se piden ≥ 4). Mejores coches distintos: ${new Set(mejores).size} de 4.`);
if (pares < 4 || !distintos) {
  console.error("medir-pistas: FALLA");
  process.exit(1);
}
console.log("medir-pistas: OK");
