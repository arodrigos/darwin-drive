// nf-9: cada pista premia coches distintos (Spearman entre pistas y mejor coche no único).
// dif-2 (--umbral): las cuatro clásicas se complican sin muro frente a su versión anterior.
import { randomGenome, genomeHash } from "../src/sim/genome";
import { createRace, simulateCar } from "../src/sim/race";
import { TRACKS, type TrackId } from "../src/sim/tracks";
import { seededRand } from "../tests/unit/helpers/rng";
import { PISTAS_V_ANTERIOR, ES_CLASICA } from "../tests/fixtures/pistas-v-anterior";

const N = Number(process.env.MEDIR_N ?? 200);
const rand = seededRand(909);
const genomas = Array.from({ length: N }, () => randomGenome(rand));
const MIN_LLEGAN = 10;
const MAX_TASA_TRAMO = Number(process.env.MEDIR_TASA_MAX ?? 0.8);

if (process.argv.includes("--umbral")) {
  umbral();
  process.exit(process.exitCode ?? 0);
}

function correr(g: (typeof genomas)[number], id: TrackId, heightFn?: (x: number) => number): { distance: number; reason: string } {
  const race = createRace([{ carId: genomeHash(g), genome: g }], id, heightFn ? { heightFn } : undefined);
  while (!race.done()) race.step(60);
  const r = race.results()[0];
  race.dispose();
  return { distance: r.distance, reason: r.reason };
}

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// Viable: el coche recorre al menos 20 m en la pista anterior. Los que no avanzan ahí
// no dicen nada de cuánto se complica la pista.
function umbral(): void {
  const MURO = process.env.MEDIR_MURO === "1"; // prueba negativa: un muro de 3 m a 60 m, donde llegan todos los viables
  let fallos = 0;
  const filas: Record<string, unknown>[] = [];
  for (const t of TRACKS) {
    if (!ES_CLASICA(t.id) || (process.env.MEDIR_PISTA && process.env.MEDIR_PISTA !== t.id)) continue;
    const vieja = PISTAS_V_ANTERIOR[t.id];
    const nueva = MURO ? (x: number) => t.heightAt(x) + (x >= 60 ? 3 : 0) : undefined;
    const viables = genomas.filter((g) => correr(g, t.id, vieja).distance >= 20);
    const antes = viables.map((g) => correr(g, t.id, vieja).distance);
    const ahora = viables.map((g) => correr(g, t.id, nueva));
    const medAntes = mediana(antes);
    const medAhora = mediana(ahora.map((r) => r.distance));
    const paradas = ahora.filter((r) => r.reason === "stall");
    const porTramo = new Map<number, number>();
    for (const r of paradas) porTramo.set(Math.floor(r.distance / 25), (porTramo.get(Math.floor(r.distance / 25)) ?? 0) + 1);
    const tramoMax = paradas.length ? Math.max(...porTramo.values()) / paradas.length : 0;
    // Tasa de paradas del tramo: de los coches que llegan a él, cuántos se paran dentro.
    // Un muro tiene tasa ~100 %; una subida gradual deja a cada tramo con una parte.
    let muro = 0;
    for (let tramo = 0; tramo < 200; tramo++) {
      const llegan = ahora.filter((r) => r.distance >= tramo * 25).length;
      if (llegan < MIN_LLEGAN) break;
      const paran = paradas.filter((r) => Math.floor(r.distance / 25) === tramo).length;
      muro = Math.max(muro, paran / llegan);
    }
    const ok = medAhora <= 0.7 * medAntes && muro <= MAX_TASA_TRAMO;
    if (!ok) fallos++;
    filas.push({
      pista: t.id,
      viables: viables.length,
      medianaAnterior: Number(medAntes.toFixed(1)),
      medianaNueva: Number(medAhora.toFixed(1)),
      razon: Number((medAhora / medAntes).toFixed(3)),
      tasaMaxTramo: Number((muro * 100).toFixed(1)) + " %",
      tramoMaxParadas: Number((tramoMax * 100).toFixed(1)) + " %",
      ok,
    });
  }
  // pn-3: cada pista nueva (no clásica) se ordena distinto de todas las demás.
  const MAX_SPEARMAN = 0.85;
  // La Recta es llana y de roca por diseño (bx-3): se ordena como las clásicas y lo que la distingue es el tiempo,
  // así que no se le exige distinto orden de distancia.
  // mos-4: El Mosaico mezcla los suelos de las demás, así que se le pide algo menos (< 0,9).
  const maxSpearman = (a: string, b: string) => (a === "mosaico" || b === "mosaico" ? 0.9 : MAX_SPEARMAN);
  const nuevas = TRACKS.filter((t) => !ES_CLASICA(t.id) && t.id !== "recta" && (!process.env.MEDIR_PISTA || process.env.MEDIR_PISTA === t.id));
  if (nuevas.length > 0) {
    const rangosDe = new Map(TRACKS.map((t) => [t.id, rangos(genomas.map((g) => simulateCar(g, t.id).distance))] as const));
    for (const t of nuevas) {
      for (const u of TRACKS) {
        if (u.id === t.id) continue;
        const r = pearson(rangosDe.get(t.id)!, rangosDe.get(u.id)!);
        const tope = maxSpearman(t.id, u.id);
        if (!(r < tope)) {
          fallos++;
          console.error(`medir-pistas --umbral: ${t.id} y ${u.id} se ordenan igual (Spearman ${r.toFixed(3)} ≥ ${tope})`);
        }
      }
    }
  }
  // bx-2 y bx-3: El Acantilado premia la robustez y La Recta es una contrarreloj que casi todos terminan.
  const quiereBx = !process.env.MEDIR_PISTA || ["acantilado", "recta"].includes(process.env.MEDIR_PISTA);
  if (quiereBx) {
    const tasaRotura = (id: TrackId) => genomas.filter((g) => simulateCar(g, id).piezasPerdidas > 0).length / N;
    const clasicas = TRACKS.filter((t) => ES_CLASICA(t.id)).map((t) => tasaRotura(t.id));
    const media = clasicas.reduce((x, y) => x + y, 0) / clasicas.length;
    const acantilado = tasaRotura("acantilado");
    const recta = genomas.map((g) => simulateCar(g, "recta"));
    const viablesRecta = recta.filter((r) => r.distance >= 20);
    const llegan = viablesRecta.filter((r) => r.reason === "meta").length / Math.max(1, viablesRecta.length);
    console.log(
      `bx-2: rotura en El Acantilado ${(acantilado * 100).toFixed(1)} % frente a ${(media * 100).toFixed(1)} % de media en las clásicas (se pide ≥ 2×)`,
    );
    console.log(`bx-3: en La Recta llega a meta el ${(llegan * 100).toFixed(1)} % de los viables (se pide ≥ 50 %)`);
    if (!(acantilado >= 2 * media)) {
      fallos++;
      console.error("medir-pistas --umbral: El Acantilado no rompe el doble que la media de las clásicas");
    }
    if (!(llegan >= 0.5)) {
      fallos++;
      console.error("medir-pistas --umbral: menos de la mitad de los viables llega a la meta en La Recta");
    }
  }
  console.log(`medir-pistas --umbral: ${N} genomas, física actual${MURO ? ", con muro forzado" : ""}`);
  console.table(filas);
  if (fallos > 0) {
    console.error("medir-pistas --umbral: FALLA (mediana > 0,7 × la anterior, un tramo de 25 m donde se para más del 80 % de los que llegan o una pista nueva con Spearman ≥ 0,85 con otra)");
    process.exitCode = 1;
  } else console.log("medir-pistas --umbral: OK");
}

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
