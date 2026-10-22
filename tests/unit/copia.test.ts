import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash } from "../../src/sim/genome";
import { getTrack, TRACKS, type TrackId } from "../../src/sim/tracks";
import { META_KEY } from "../../src/storage/meta";
import {
  COPIA_FORMAT,
  COPIA_INVALIDA,
  COPIA_MAX_BYTES,
  crearCopia,
  nombreFicheroCopia,
  resumenCopia,
  validarCopia,
} from "../../src/storage/copia";
import { emptyRankings, KEY_EVOLUTION, KEY_GARAGE, KEY_LINEAGE, KEY_RANKINGS, KEY_SPECIES, type RankingEntry, type SavedCar } from "../../src/storage/schema";
import { leerGuardado, loadAll, reemplazarTodo, resetStoreConnection, save } from "../../src/storage/store";
import { seededGenomes } from "./helpers/rng";

const GENOMAS = seededGenomes(31, 40);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
});

function entrada(n: number, trackId: TrackId, distance: number): RankingEntry {
  const genome = GENOMAS[n];
  return {
    carId: `c${n}`,
    genome,
    genomeHash: genomeHash(genome),
    distance,
    bestStep: Math.ceil(distance * 1.2) + 1,
    origin: "evolución",
    date: "2026-10-01T10:00:00.000Z",
    trackId,
    trackVersion: getTrack(trackId)!.version,
    physicsVersion: PHYSICS_VERSION,
  };
}

function coche(n: number): SavedCar {
  return { id: `g${n}`, name: `Coche ${n}`, genome: GENOMAS[n], marks: { rampa: 12.5 }, origin: "diseño", savedAt: "2026-10-02T09:00:00.000Z" };
}

function evolucion(generacion: number) {
  return {
    v: 1 as const,
    params: { populationSize: 16, eliteCount: 2, mutationRate: 0.05, mutationSize: "medium" as const, seed: 7 },
    trackId: "dunas" as const,
    generation: generacion,
    population: Array.from({ length: 16 }, (_, i) => ({ id: `i${i}`, genome: GENOMAS[i], parents: i ? [`i${i - 1}`] : [], op: "mutation" as const, generation: generacion, hue: i * 20 })),
    rng: [1, 2, 3, 4],
    history: [{ generation: generacion - 1, best: 80, topQuarterMean: 60, mean: 30, bestId: "i1" }],
    favorites: ["i2"],
    stagnantFor: 1,
    effectiveMutationRate: 0.05,
  };
}

async function guardarEstado(rankings: Record<TrackId, RankingEntry[]>, garaje: SavedCar[], gen: number | null): Promise<void> {
  await save(KEY_RANKINGS, rankings);
  await save(KEY_GARAGE, garaje);
  await save(KEY_EVOLUTION, gen === null ? null : evolucion(gen));
  await save(KEY_LINEAGE, [
    { id: "n1", parents: [], op: "random", generation: 0, distance: null, trackId: null, genome: GENOMAS[1], hue: 10, humanTouched: false, prunedParents: false },
  ]);
  await save(KEY_SPECIES, {});
  await save(META_KEY, { seenHelp: ["taller"], persistRequested: true, lastTrack: "pedregal" });
}

const AHORA = new Date(2026, 9, 20, 12, 0, 0);

test("pw-1: exportar, vaciar e importar devuelve el mismo estado", async () => {
  const rankings = emptyRankings();
  rankings.cordillera = [entrada(1, "cordillera", 64.2), entrada(2, "cordillera", 40)];
  rankings.rampa = [entrada(3, "rampa", 30), entrada(4, "rampa", 20), entrada(5, "rampa", 10)];
  rankings.pedregal = [entrada(6, "pedregal", 8)];
  await guardarEstado(rankings, [coche(1), coche(2), coche(3)], 4);
  const antes = (await loadAll()).data;
  const guardado = await leerGuardado();
  const texto = JSON.stringify(crearCopia(guardado, AHORA));

  await reemplazarTodo({});
  assert.notDeepEqual((await loadAll()).data, antes);

  const r = validarCopia(texto);
  assert.ok(r.ok);
  assert.equal(r.resumen, "3 rankings con 6 marcas, 3 coches, evolución en la gen 4");
  await reemplazarTodo(r.data);
  resetStoreConnection();
  assert.deepEqual((await loadAll()).data, antes);
  assert.deepEqual(await leerGuardado(), guardado);
});

test("pw-1: el fichero se llama darwin-drive-copia-AAAA-MM-DD.json y declara su formato", () => {
  assert.equal(nombreFicheroCopia(new Date(2026, 0, 5)), "darwin-drive-copia-2026-01-05.json");
  const copia = crearCopia({ [KEY_GARAGE]: [], "dd:v9:ajena": 1 }, AHORA);
  assert.equal(copia.format, COPIA_FORMAT);
  assert.deepEqual(Object.keys(copia.data), [KEY_GARAGE]);
});

test("pw-2: un fichero que no es una copia válida se rechaza con el mensaje del diseño", async () => {
  await guardarEstado(emptyRankings(), [coche(1)], null);
  const base = JSON.parse(JSON.stringify(crearCopia(await leerGuardado(), AHORA))) as { data: Record<string, unknown> } & Record<string, unknown>;
  const rankingsMalos = (mutar: (r: Record<string, unknown>) => void) => {
    const c = JSON.parse(JSON.stringify(base));
    mutar(c.data[KEY_RANKINGS]);
    return JSON.stringify(c);
  };
  const casos: Record<string, string> = {
    "formato distinto": JSON.stringify({ ...base, format: "otra-cosa" }),
    "versión futura": JSON.stringify({ ...base, v: 2 }),
    "no es JSON": "{ esto no",
    "un array": "[]",
    "6 MB": " ".repeat(6 * 1024 * 1024),
    "clave desconocida": JSON.stringify({ ...base, data: { ...base.data, "dd:v2:nuevo": 1 } }),
    "genoma corrupto": (() => {
      const c = JSON.parse(JSON.stringify(base));
      c.data[KEY_GARAGE][0].genome.bodyDensity = 99999;
      return JSON.stringify(c);
    })(),
    "pista inexistente": rankingsMalos((r) => {
      r.marte = [entrada(1, "rampa", 5)];
    }),
    "entrada de ranking inválida": rankingsMalos((r) => {
      r.rampa = [{ carId: 1 }];
    }),
  };
  const antes = (await loadAll()).data;
  for (const [nombre, texto] of Object.entries(casos)) {
    const r = validarCopia(texto);
    assert.equal(r.ok, false, nombre);
    if (!r.ok) assert.equal(r.motivo, COPIA_INVALIDA, nombre);
  }
  assert.deepEqual((await loadAll()).data, antes);
  assert.ok(COPIA_MAX_BYTES === 5 * 1024 * 1024);
  assert.equal(
    COPIA_INVALIDA,
    "Este fichero no es una copia de Darwin Drive o es de una versión que no entiendo. No se ha cambiado nada.",
  );
});

test("pw-1: el resumen cuenta en singular y sin evolución", () => {
  const rankings = emptyRankings();
  rankings.dunas = [entrada(1, "dunas", 3)];
  assert.equal(resumenCopia({ [KEY_RANKINGS]: rankings, [KEY_GARAGE]: [coche(1)], [KEY_EVOLUTION]: null }), "1 ranking con 1 marca, 1 coche, sin evolución");
});

// Invariante 1: para cualquier estado guardado válido, exportar e importar devuelve exactamente el mismo estado.
test("invariante: exportar e importar es la identidad para cualquier estado válido", async () => {
  const arbEstado = fc.record({
    rankings: fc.record({
      cordillera: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      rampa: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      dunas: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      pedregal: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      glaciar: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      trampolines: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      escalera: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
      mosaico: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 10 }),
    }),
    distancias: fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 10, maxLength: 10 }),
    coches: fc.uniqueArray(fc.integer({ min: 0, max: 39 }), { maxLength: 8 }),
    gen: fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
  });
  await fc.assert(
    fc.asyncProperty(arbEstado, async (e) => {
      globalThis.indexedDB = new IDBFactory();
      resetStoreConnection();
      const rankings = emptyRankings();
      for (const t of TRACKS) {
        const ids = e.rankings[t.id];
        // Distancia no creciente: así el ranking ya está en el orden que el validador exige.
        const distancias = ids.map((_, i) => e.distancias[i] / 10).sort((a, b) => b - a);
        rankings[t.id] = ids.map((n, i) => entrada(n, t.id, distancias[i]));
      }
      await guardarEstado(rankings, e.coches.map(coche), e.gen);
      const antes = await leerGuardado();
      const texto = JSON.stringify(crearCopia(antes, AHORA));
      await reemplazarTodo({});
      const r = validarCopia(texto);
      assert.ok(r.ok);
      await reemplazarTodo(r.data);
      resetStoreConnection();
      assert.deepEqual(await leerGuardado(), antes);
    }),
    { numRuns: 40 },
  );
});

// Invariante 2: un fichero inválido no modifica ninguna clave.
test("invariante: un fichero estropeado de cualquier forma no cambia el guardado", async () => {
  const rankings = emptyRankings();
  rankings.rampa = [entrada(3, "rampa", 30)];
  await guardarEstado(rankings, [coche(1)], 4);
  const antes = (await loadAll()).data;
  const valido = JSON.stringify(crearCopia(await leerGuardado(), AHORA));
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: valido.length - 1 }), fc.string({ minLength: 1, maxLength: 4 }), async (pos, basura) => {
      const roto = valido.slice(0, pos) + basura + valido.slice(pos + 1);
      const r = validarCopia(roto);
      // Si por casualidad el texto sigue siendo una copia válida, importarla es correcto; si no, no hay nada que aplicar.
      if (r.ok) return;
      assert.equal(r.motivo, COPIA_INVALIDA);
      assert.deepEqual((await loadAll()).data, antes);
    }),
    { numRuns: 150 },
  );
});
