import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PHYSICS_VERSION, type CarResult } from "../../src/sim/constants";
import { cellIndex, emptyArchive, CELL_COUNT, type SpeciesArchive } from "../../src/evolution/species";
import { genomeHash } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack, type TrackId } from "../../src/sim/tracks";
import { KEY_GARAGE, KEY_RANKINGS, KEY_SPECIES, emptyRankings, type RankingEntry, type SavedCar } from "../../src/storage/schema";
import { loadAll, nuevaEpoca, resetStoreConnection, save } from "../../src/storage/store";
import {
  MAX_INTENTOS,
  claveTrabajo,
  leerMigrables,
  migrar,
  trabajoPendiente,
  type EntornoMigracion,
  type Medir,
} from "../../src/storage/migracion";
import { seededGenomes } from "./helpers/rng";

const GENOMES = seededGenomes(23, 80);
const trackVersion = (t: TrackId) => getTrack(t)!.version;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
});

function entrada(n: number, trackId: TrackId, distance: number, over: Partial<RankingEntry> = {}): RankingEntry {
  const genome = GENOMES[n];
  return {
    carId: `c${n}`,
    genome,
    genomeHash: genomeHash(genome),
    distance,
    bestStep: Math.ceil(distance * 1.2) + 1,
    origin: "evolución",
    date: `2026-10-0${(n % 8) + 1}T10:00:00.000Z`,
    trackId,
    trackVersion: 0,
    physicsVersion: 0,
    name: `Coche ${n}`,
    ...over,
  };
}

/** Medida falsa pero determinista: depende solo del genoma y la pista, como la real. */
const medirFalso: Medir = async (genome, trackId) => resultadoFalso(genome, trackId);
function resultadoFalso(genome: Parameters<Medir>[0], trackId: TrackId, over: Partial<CarResult> = {}): CarResult {
  const h = genomeHash(genome);
  let suma = 0;
  for (const ch of h) suma += ch.charCodeAt(0);
  return { carId: h, distance: (suma % 900) / 10 + 1, reason: "stall", steps: 100, bestStep: 2000, piezasPerdidas: 0, metroRotura: null, causaParada: null, pendienteParada: null, physicsVersion: PHYSICS_VERSION, trackId, trackVersion: trackVersion(trackId), ...over };
}

/** Navegador falso: el reloj y la visibilidad los mueve el test. */
function entornoFalso() {
  let t = 0;
  let visible = true;
  const vis = new Set<() => void>();
  const relojes = new Set<{ ms: number; cb: () => void; proximo: number }>();
  const entorno: EntornoMigracion = {
    ahora: () => t,
    visible: () => visible,
    alCambiarVisibilidad(cb) {
      vis.add(cb);
      return () => vis.delete(cb);
    },
    cada(ms, cb) {
      const r = { ms, cb, proximo: t + ms };
      relojes.add(r);
      return () => relojes.delete(r);
    },
  };
  return {
    entorno,
    async avanzar(ms: number) {
      for (let hecho = 0; hecho < ms; hecho += 1000) {
        t += 1000;
        for (const r of [...relojes]) if (t >= r.proximo) { r.proximo += r.ms; r.cb(); }
        await new Promise((r) => setImmediate(r));
      }
    },
    cambiar(v: boolean) {
      visible = v;
      vis.forEach((cb) => cb());
    },
  };
}

const rankingsGuardados = async () => (await loadAll()).data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>;

test("mig-1-a: cada entrada antigua se vuelve a medir con su fecha, nombre y origen, y una segunda pasada no mide nada", async () => {
  const rk = emptyRankings();
  rk.cordillera = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => entrada(n, "cordillera", 100 - n));
  rk.rampa = [entrada(11, "rampa", 50), entrada(12, "rampa", 40), entrada(13, "rampa", 30)];
  await save(KEY_RANKINGS, rk);
  assert.equal(trabajoPendiente(await leerMigrables()).length, 13);
  let llamadas = 0;
  const medir: Medir = async (g, t) => {
    llamadas++;
    // Una de rampa es anomalía.
    return resultadoFalso(g, t, genomeHash(g) === genomeHash(GENOMES[12]) ? { reason: "anomaly" } : {});
  };
  const r = await migrar({ medir });
  assert.equal(r.estado, "completa");
  assert.equal(llamadas, 13);
  const despues = await rankingsGuardados();
  assert.equal(despues.cordillera.length, 10);
  assert.equal(despues.rampa.length, 2);
  for (const e of [...despues.cordillera, ...despues.rampa]) {
    const antes = [...rk.cordillera, ...rk.rampa].find((x) => x.carId === e.carId)!;
    assert.equal(e.date, antes.date);
    assert.equal(e.name, antes.name);
    assert.equal(e.origin, antes.origin);
    assert.equal(e.physicsVersion, PHYSICS_VERSION);
    assert.equal(e.trackVersion, trackVersion(e.trackId));
    assert.equal(e.distance, resultadoFalso(e.genome, e.trackId).distance);
  }
  const distancias = despues.cordillera.map((e) => e.distance);
  assert.deepStrictEqual(distancias, [...distancias].sort((a, b) => b - a));
  llamadas = 0;
  assert.equal((await migrar({ medir })).estado, "sin-trabajo");
  assert.equal(llamadas, 0);
});

test("mig-1: con simulateCar real la marca migrada es la de simulateCar", async () => {
  const rk = emptyRankings();
  rk.rampa = [entrada(1, "rampa", 5, { physicsVersion: PHYSICS_VERSION - 1 })];
  await save(KEY_RANKINGS, rk);
  await migrar({ medir: async (g, t) => simulateCar(g, t) });
  const e = (await rankingsGuardados()).rampa[0];
  assert.equal(e.distance, simulateCar(GENOMES[1], "rampa").distance);
});

test("mig-2-a: el garaje sin versiones se mide y las especies antiguas se conservan y se migran", async () => {
  const coche = (n: number, marks: SavedCar["marks"]): SavedCar => ({ id: `g${n}`, name: `G${n}`, genome: GENOMES[n], marks, origin: "diseño", savedAt: "2026-10-02T09:00:00.000Z" });
  await save(KEY_GARAGE, [coche(1, { dunas: 10, rampa: 5 }), coche(2, { dunas: 20 })]);
  // Un archivo de dunas con 5 celdas de una versión anterior.
  const archivo: SpeciesArchive = { ...emptyArchive("dunas", 3), trackVersion: 0, physicsVersion: 0 };
  let puestas = 0;
  for (let n = 3; n < 80 && puestas < 5; n++) {
    const i = cellIndex(GENOMES[n]);
    if (i === null || archivo.cells[i]) continue;
    archivo.cells[i] = { carId: genomeHash(GENOMES[n]), genome: GENOMES[n], distance: 9, batch: 1 };
    puestas++;
  }
  await save(KEY_SPECIES, { dunas: archivo });
  const cargado = await loadAll();
  assert.deepStrictEqual(cargado.warnings, []);
  assert.equal(trabajoPendiente(await leerMigrables()).length, 3 + 5);
  await migrar({ medir: medirFalso });
  const despues = await loadAll();
  const garaje = despues.data[KEY_GARAGE] as SavedCar[];
  assert.equal(garaje[0].marks.dunas, resultadoFalso(GENOMES[1], "dunas").distance);
  assert.equal(garaje[0].markVersions?.rampa?.physicsVersion, PHYSICS_VERSION);
  const especies = (despues.data[KEY_SPECIES] as Record<string, SpeciesArchive>).dunas;
  assert.equal(especies.trackVersion, trackVersion("dunas"));
  assert.equal(especies.physicsVersion, PHYSICS_VERSION);
  assert.equal(especies.cells.filter((c) => c).length, 5);
  especies.cells.forEach((c, i) => c && assert.equal(cellIndex(c.genome), i));
  assert.equal(especies.cells.length, CELL_COUNT);
  assert.equal(trabajoPendiente(await leerMigrables()).length, 0);
});

test("mig-5: interrumpir tras k medidas y relanzar mide exactamente N − k, con el mismo resultado final", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 6 }), async (n, k) => {
      globalThis.indexedDB = new IDBFactory();
      resetStoreConnection();
      const rk = emptyRankings();
      rk.cordillera = Array.from({ length: n }, (_, i) => entrada(i + 1, "cordillera", 50 - i));
      await save(KEY_RANKINGS, rk);
      const corte = Math.min(k, n);
      const control = new AbortController();
      let hechas = 0;
      const medir: Medir = async (g, t) => {
        hechas++;
        if (hechas === corte + 1) control.abort();
        return resultadoFalso(g, t);
      };
      if (corte === 0) control.abort();
      await migrar({ medir, senal: control.signal });
      const trasCorte = (await rankingsGuardados()).cordillera.filter((e) => e.physicsVersion === PHYSICS_VERSION).length;
      let segunda = 0;
      await migrar({ medir: async (g, t) => (segunda++, resultadoFalso(g, t)) });
      assert.equal(trasCorte + segunda, n);
      assert.ok((await rankingsGuardados()).cordillera.every((e) => e.physicsVersion === PHYSICS_VERSION));
    }),
    { numRuns: 25 },
  );
});

test("mig-8: una escritura no se aplica si el elemento cambió de versión por debajo (importación a mitad)", async () => {
  const rk = emptyRankings();
  rk.cordillera = [entrada(1, "cordillera", 50), entrada(2, "cordillera", 40)];
  await save(KEY_RANKINGS, rk);
  let primera = true;
  const medir: Medir = async (g, t) => {
    if (primera) {
      primera = false;
      // Mientras mide, se importa una copia: otra época con el ranking sustituido.
      nuevaEpoca();
      await save(KEY_RANKINGS, { ...emptyRankings(), cordillera: [entrada(3, "cordillera", 70)] });
    }
    return resultadoFalso(g, t);
  };
  await migrar({ medir });
  const lista = (await rankingsGuardados()).cordillera;
  assert.deepStrictEqual(lista.map((e) => e.carId), ["c3"]);
  assert.equal(lista[0].physicsVersion, PHYSICS_VERSION);
});

test("mig-10: 65 s ocultos no suman intento; 65 s visibles sí; tras 3 fallos el elemento queda intacto", async () => {
  const rk = emptyRankings();
  rk.cordillera = [entrada(1, "cordillera", 50)];
  await save(KEY_RANKINGS, rk);
  const env = entornoFalso();
  let cuelga = true;
  let avisarLlamada: () => void = () => {};
  let llamadas = 0;
  const medir: Medir = (g, t, senal) => {
    llamadas++;
    avisarLlamada();
    return cuelga ? new Promise<CarResult>((_, rechazar) => senal.addEventListener("abort", () => rechazar(new Error("cancelada")))) : Promise.resolve(resultadoFalso(g, t));
  };
  const intentos: Record<string, number> = {};
  const clave = claveTrabajo("ranking", "cordillera", "c1");
  const primeraLlamada = new Promise<void>((r) => (avisarLlamada = r));
  const vuelo = migrar({ medir, entorno: env.entorno, intentos });
  await primeraLlamada;
  env.cambiar(false);
  await env.avanzar(65_000);
  assert.equal(intentos[clave] ?? 0, 0);
  cuelga = false;
  env.cambiar(true);
  const r = await vuelo;
  assert.equal(r.estado, "completa");
  assert.equal(intentos[clave] ?? 0, 0);
  assert.equal((await rankingsGuardados()).cordillera[0].physicsVersion, PHYSICS_VERSION);

  // Visibles: cada medida colgada gasta un intento y, al tercero, se conserva sin tocar.
  await save(KEY_RANKINGS, rk);
  cuelga = true;
  const env2 = entornoFalso();
  const intentos2: Record<string, number> = {};
  const vuelo2 = migrar({ medir, entorno: env2.entorno, intentos: intentos2 });
  llamadas = 0;
  for (let i = 0; i < MAX_INTENTOS; i++) {
    // Cada intento es una medida nueva: se espera a que arranque antes de dejar pasar su minuto.
    while (llamadas <= i) await new Promise((r) => setImmediate(r));
    await env2.avanzar(60_000);
  }
  const r2 = await vuelo2;
  assert.deepStrictEqual(r2.conservados, [clave]);
  assert.equal(intentos2[clave], MAX_INTENTOS);
  assert.deepStrictEqual((await rankingsGuardados()).cordillera[0], rk.cordillera[0]);
});

test("una medida que lanza gasta intento y a la tercera el elemento sale del trabajo pendiente", async () => {
  const rk = emptyRankings();
  rk.rampa = [entrada(1, "rampa", 50), entrada(2, "rampa", 40)];
  await save(KEY_RANKINGS, rk);
  const medir: Medir = async (g, t) => {
    if (genomeHash(g) === genomeHash(GENOMES[1])) throw new Error("falla");
    return resultadoFalso(g, t);
  };
  const r = await migrar({ medir });
  assert.equal(r.estado, "completa");
  assert.deepStrictEqual(r.conservados, [claveTrabajo("ranking", "rampa", "c1")]);
  const lista = (await rankingsGuardados()).rampa;
  assert.equal(lista.find((e) => e.carId === "c1")?.physicsVersion, 0);
  assert.equal(lista.find((e) => e.carId === "c2")?.physicsVersion, PHYSICS_VERSION);
});

test("con pestañas antiguas abiertas no se empieza", async () => {
  const rk = emptyRankings();
  rk.rampa = [entrada(1, "rampa", 50)];
  await save(KEY_RANKINGS, rk);
  let llamadas = 0;
  const r = await migrar({ medir: async (g, t) => (llamadas++, resultadoFalso(g, t)), pestanasAntiguas: async () => 1 });
  assert.equal(r.estado, "esperando-pestanas");
  assert.equal(llamadas, 0);
});

test("invariante: tras migrar, mismos genomeHash (menos anomalías), ordenados y con la misma fecha", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 10 }), fc.array(fc.boolean(), { maxLength: 10 }), async (ns, anom) => {
      globalThis.indexedDB = new IDBFactory();
      resetStoreConnection();
      const rk = emptyRankings();
      rk.dunas = ns.map((n, i) => entrada(n, "dunas", 90 - i));
      await save(KEY_RANKINGS, rk);
      const esAnomalia = (g: Parameters<Medir>[0]) => anom[ns.findIndex((n) => genomeHash(GENOMES[n]) === genomeHash(g))] === true;
      await migrar({ medir: async (g, t) => resultadoFalso(g, t, esAnomalia(g) ? { reason: "anomaly" } : {}) });
      const despues = (await rankingsGuardados()).dunas;
      const esperados = rk.dunas.filter((e) => !esAnomalia(e.genome)).map((e) => e.genomeHash).sort();
      assert.deepStrictEqual(despues.map((e) => e.genomeHash).sort(), esperados);
      for (const e of despues) assert.equal(e.date, rk.dunas.find((x) => x.genomeHash === e.genomeHash)!.date);
      assert.deepStrictEqual(despues.map((e) => e.distance), despues.map((e) => e.distance).sort((a, b) => b - a));
    }),
    { numRuns: 25 },
  );
});
