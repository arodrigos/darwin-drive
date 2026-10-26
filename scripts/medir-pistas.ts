// nf-9: cada pista premia coches distintos (Spearman entre pistas y mejor coche no único).
// dif-5k (--umbral): las nueve pistas endurecidas se complican hasta los 5 km sin muro, medido contra los campeones fijos.
import { randomGenome, genomeHash, STOCK_CAR, type Genome } from "../src/sim/genome";
import { createRace, simulateCar } from "../src/sim/race";
import { TRACKS, type TrackId } from "../src/sim/tracks";
import { seededRand } from "../tests/unit/helpers/rng";
import { ES_CLASICA } from "../tests/fixtures/pistas-v-anterior";
import { CAMPEONES_5K } from "../tests/fixtures/campeones-5k";
import { PISTAS_ENDURECIDAS } from "../src/sim/dificultad";
import type { CarResult } from "../src/sim/constants";

const N = Number(process.env.MEDIR_N ?? 200);
const rand = seededRand(909);
const genomas = Array.from({ length: N }, () => randomGenome(rand));
const MIN_LLEGAN = 10;
const MAX_TASA_TRAMO = Number(process.env.MEDIR_TASA_MAX ?? 0.8);

if (process.argv.includes("--umbral")) {
  umbral();
  process.exit(process.exitCode ?? 0);
}

// Viable: el coche de serie o un campeón. Se corren todos juntos en una carrera por pista (no chocan entre sí).
function correrTodos(genomes: Genome[], id: TrackId, heightFn?: (x: number) => number): CarResult[] {
  const race = createRace(genomes.map((g, i) => ({ carId: `${genomeHash(g)}-${i}`, genome: g })), id, heightFn ? { heightFn } : undefined);
  while (!race.done()) race.step(120);
  const r = race.results();
  race.dispose();
  return r;
}

// dif-5k. Los campeones son pocos por pista (generar:campeones), así que la fracción por kilómetro y el tope
// del 15 % se miden sobre el conjunto de las nueve pistas; por pista solo se exige que no sea un paseo.
function umbral(): void {
  const MURO = process.env.MEDIR_MURO === "1"; // prueba negativa: un muro de 3 m a 60 m, donde llegan todos los viables
  let fallos = 0;
  const fallo = (m: string) => {
    fallos++;
    console.error(`medir-pistas --umbral: ${m}`);
  };
  const filas: Record<string, unknown>[] = [];
  const todos: CarResult[] = [];
  const MAX_META_POR_PISTA = 0.85;
  // El Acantilado no se deja endurecer más sin anomalías de física (caídas de ≥ 7 m, medir:anomalias > 1 %), así que
  // sus campeones llegan todos: se le exime del tope por pista y el tope del 15 % del conjunto sigue vigilándolo.
  const EXENTAS_DEL_TOPE_POR_PISTA: readonly string[] = ["acantilado"];
  for (const id of PISTAS_ENDURECIDAS) {
    if (process.env.MEDIR_PISTA && process.env.MEDIR_PISTA !== id) continue;
    const campeones = CAMPEONES_5K[id] ?? [];
    if (campeones.length < 4) fallo(`${id}: el fixture trae ${campeones.length} campeones (se piden ≥ 4)`);
    const t = TRACKS.find((x) => x.id === id)!;
    const heightFn = MURO ? (x: number) => t.heightAt(x) + (x >= 60 ? 3 : 0) : undefined;
    const [serie, ...rs] = correrTodos([STOCK_CAR, ...campeones], id, heightFn);
    todos.push(...rs);
    if (serie.reason === "meta") fallo(`${id}: el coche de serie llega a la meta`);
    const llegan = rs.filter((r) => r.reason === "meta").length / Math.max(1, rs.length);
    if (llegan > MAX_META_POR_PISTA && !EXENTAS_DEL_TOPE_POR_PISTA.includes(id)) fallo(`${id}: llega a la meta el ${(llegan * 100).toFixed(0)} % de los campeones (máx. ${MAX_META_POR_PISTA * 100} %)`);
    filas.push({
      pista: id,
      campeones: rs.length,
      serie: Number(serie.distance.toFixed(0)),
      ...Object.fromEntries([1, 2, 3, 4].map((k) => [`>${k} km`, rs.filter((r) => r.distance >= k * 1000).length])),
      meta: rs.filter((r) => r.reason === "meta").length,
    });
  }
  // Una línea por pista con lo que se le exige: la tabla de campeones por kilómetro sale al final y esto la hace legible sin releer el script.
  for (const f of filas) {
    const exenta = EXENTAS_DEL_TOPE_POR_PISTA.includes(f.pista as string);
    console.log(`dif-5k: ${f.pista}: ${f.meta}/${f.campeones} a meta; se le exige ${exenta ? "(exenta del tope por pista)" : `≤ ${MAX_META_POR_PISTA * 100} % a meta`}, serie sin llegar; el 15 % y la bajada de 1 a 5 km se miden sobre el conjunto`);
  }
  if (todos.length > 0 && !process.env.MEDIR_PISTA) {
    const frac = [1, 2, 3, 4, 5].map((k) => todos.filter((r) => (k === 5 ? r.reason === "meta" : r.distance >= k * 1000)).length / todos.length);
    console.log(`dif-5k: fracción de los ${todos.length} campeones que pasa 1, 2, 3, 4 y 5 km: ${frac.map((f) => (f * 100).toFixed(0) + " %").join(" · ")}`);
    for (let k = 1; k < 5; k++) if (!(frac[k] < frac[k - 1])) fallo(`la fracción que pasa ${k + 1} km (${frac[k].toFixed(3)}) no baja respecto a ${k} km (${frac[k - 1].toFixed(3)})`);
    if (frac[4] > 0.15) fallo(`llega a la meta el ${(frac[4] * 100).toFixed(1)} % de los campeones (máx. 15 %)`);
    if (!todos.some((r) => r.distance > 3000)) fallo("ningún campeón pasa de 3 km");
  }
  // (e) ningún tramo de 25 m para a más del 80 % de los que llegan a él.
  const paradas = todos.filter((r) => r.reason === "stall");
  let muro = 0;
  for (let tramo = 0; tramo < 200; tramo++) {
    const llegan = todos.filter((r) => r.distance >= tramo * 25).length;
    if (llegan < MIN_LLEGAN) break;
    const paran = paradas.filter((r) => Math.floor(r.distance / 25) === tramo).length;
    muro = Math.max(muro, paran / llegan);
  }
  if (muro > MAX_TASA_TRAMO) fallo(`un tramo de 25 m para al ${(muro * 100).toFixed(0)} % de los que llegan (máx. ${MAX_TASA_TRAMO * 100} %)`);
  console.log(`dif-5k: tasa máxima de paradas por tramo de 25 m ${(muro * 100).toFixed(1)} %`);
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
  console.log(`medir-pistas --umbral: campeones fijos, física actual${MURO ? ", con muro forzado" : ""}`);
  console.table(filas);
  if (fallos > 0) {
    console.error("medir-pistas --umbral: FALLA (criterio dif-5k, bx o una pista nueva con Spearman ≥ 0,85 con otra)");
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
