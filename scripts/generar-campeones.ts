// Genera una sola vez tests/fixtures/campeones-5k.ts: coches evolucionados con semilla fija sobre las pistas
// de la versión anterior (el código de antes de endurecerlas). Sirven de referencia a medir:pistas --umbral:
// si cambia la física o se vuelve a tocar una pista, se regenera ejecutando esto sobre el código de antes.
//   npm run generar:campeones -- --pistas cordillera,rampa --salida .tmp/campeones   (por tandas)
//   npm run generar:campeones -- --ensamblar .tmp/campeones                          (escribe el fixture)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS } from "../src/evolution/ga";
import { genomeHash, type Genome } from "../src/sim/genome";
import { getTrack, type TrackId } from "../src/sim/tracks";
import { evolve } from "../tests/unit/helpers/evolucionar";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}

const PISTAS = "cordillera,rampa,dunas,pedregal,glaciar,trampolines,escalera,acantilado,mosaico";
const SEMILLAS = [11, 12];
const POR_SEMILLA = 3;
// Tope de pasos al evolucionar: sin él, un coche que llega lejos hace cada generación eterna y el script no acaba en una tarde.
const MAX_PASOS = 6000;
const FIXTURE = "tests/fixtures/campeones-5k.ts";

if (process.argv.includes("--ensamblar")) {
  const dir = arg("ensamblar", ".tmp/campeones");
  const todo: Record<string, Genome[]> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    todo[f.replace(".json", "")] = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Genome[];
  }
  const cuerpo = Object.entries(todo)
    .map(([id, gs]) => `  ${id}: ${JSON.stringify(gs)},`)
    .join("\n");
  writeFileSync(
    FIXTURE,
    `// Generado por scripts/generar-campeones.ts (semillas fijas, pistas de la versión anterior). No editar a mano.\n` +
      `import type { Genome } from "../../src/sim/genome";\nimport type { TrackId } from "../../src/sim/tracks";\n\n` +
      `export const CAMPEONES_5K: Partial<Record<TrackId, Genome[]>> = {\n${cuerpo}\n};\n`,
  );
  console.log(`${FIXTURE}: ${Object.values(todo).reduce((s, g) => s + g.length, 0)} campeones en ${Object.keys(todo).length} pistas`);
  process.exit(0);
}

const generaciones = Number(arg("generaciones", "12"));
const salida = arg("salida", ".tmp/campeones");
mkdirSync(salida, { recursive: true });
for (const pista of arg("pistas", PISTAS).split(",")) {
  if (!getTrack(pista)) throw new Error(`Pista desconocida: ${pista}`);
  const campeones = new Map<string, Genome>();
  for (const seed of SEMILLAS) {
    const ev = evolve({ ...DEFAULT_PARAMS, seed }, pista as TrackId, generaciones, { maxSteps: MAX_PASOS });
    const pob = ev.states[ev.states.length - 1].population;
    const res = ev.results[ev.results.length - 1];
    const ordenados = pob
      .map((p, i) => ({ g: p.genome, d: res[i].distance, anomalia: res[i].reason === "anomaly" }))
      .filter((x) => !x.anomalia)
      .sort((a, b) => b.d - a.d);
    let tomados = 0;
    for (const x of ordenados) {
      const h = genomeHash(x.g);
      if (campeones.has(h) || tomados >= POR_SEMILLA) continue;
      campeones.set(h, x.g);
      tomados++;
      console.log(`${pista} semilla ${seed}: ${x.d.toFixed(0)} m`);
    }
  }
  writeFileSync(`${salida}/${pista}.json`, JSON.stringify([...campeones.values()]));
}
