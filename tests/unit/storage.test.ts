import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PHYSICS_VERSION, type CarResult } from "../../src/sim/constants";
import { genomeHash, normalizeGenome, STOCK_CAR, type Genome } from "../../src/sim/genome";
import { getTrack, TRACKS, type TrackId } from "../../src/sim/tracks";
import { DEFAULT_META } from "../../src/storage/meta";
import {
  KEY_EVOLUTION,
  KEY_GARAGE,
  KEY_LINEAGE,
  KEY_RANKINGS,
  RANKING_SIZE,
  emptyRankings,
  normalizeRanking,
  type RankingEntry,
  type SavedCar,
} from "../../src/storage/schema";
import {
  loadAll,
  recordMark,
  remeasureRankings,
  removeFromGarage,
  resetStoreConnection,
  save,
  saveToGarage,
  updateRanking,
} from "../../src/storage/store";
import { META_KEY } from "../../src/storage/meta";
import { seededGenomes } from "./helpers/rng";

const GENOMES = seededGenomes(11, 80);
const ids = (n: number) => GENOMES[n];

function nuevaBase(): void {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
}
beforeEach(nuevaBase);

const trackVersion = (t: TrackId) => getTrack(t)!.version;

function result(carId: string, trackId: TrackId, distance: number, over: Partial<CarResult> = {}): CarResult {
  return { carId, distance, reason: "stall", steps: 100, bestStep: Math.ceil(distance * 1.2) + 1, piezasPerdidas: 0, metroRotura: null, causaParada: null, pendienteParada: null, physicsVersion: PHYSICS_VERSION, trackId, trackVersion: trackVersion(trackId), ...over };
}

function entry(n: number, trackId: TrackId, distance: number, over: Partial<RankingEntry> = {}): RankingEntry {
  const genome = ids(n);
  return {
    carId: `c${n}`,
    genome,
    genomeHash: genomeHash(genome),
    distance,
    origin: "evolución",
    date: "2026-10-01T10:00:00.000Z",
    trackId,
    trackVersion: trackVersion(trackId),
    bestStep: Math.ceil(distance * 1.2) + 1,
    physicsVersion: PHYSICS_VERSION,
    ...over,
  };
}

function car(n: number, marks: SavedCar["marks"] = {}): SavedCar {
  return { id: `g${n}`, name: `Coche ${n}`, genome: ids(n), marks, origin: "diseño", savedAt: "2026-10-02T09:00:00.000Z" };
}

function candidate(n: number, trackId: TrackId, distance: number, over: Partial<CarResult> = {}) {
  return { result: result(`c${n}`, trackId, distance, over), genome: ids(n), origin: "evolución" as const };
}

test("gd-1-ida-vuelta: cada clave sobrevive a recrear el almacén", async () => {
  const rankings = emptyRankings();
  rankings.cordillera = [entry(1, "cordillera", 90), entry(2, "cordillera", 70), entry(3, "cordillera", 50)];
  rankings.rampa = [entry(4, "rampa", 30)];
  const garage = [car(1, { cordillera: 90, rampa: 12.5 }), car(2, { dunas: 40 }), car(3)];
  const evolution = {
    v: 1 as const,
    params: { populationSize: 16, eliteCount: 2, mutationRate: 0.05, mutationSize: "medium" as const, seed: 7 },
    trackId: "dunas" as const,
    generation: 4,
    population: Array.from({ length: 16 }, (_, i) => ({ id: `i${i}`, genome: ids(i), parents: i ? [`i${i - 1}`] : [], op: "mutation" as const, generation: 4, hue: i * 20 })),
    rng: [1, 2, 3, 4],
    history: [{ generation: 3, best: 80, topQuarterMean: 60, mean: 30, bestId: "i1" }],
    favorites: ["i2"],
    stagnantFor: 1,
    effectiveMutationRate: 0.05,
  };
  const lineage = [
    { id: "n1", parents: [], op: "random" as const, generation: 0, distance: null, trackId: null, genome: ids(1), hue: 10, humanTouched: false, prunedParents: false },
    { id: "n2", parents: ["n1"], op: "mutation" as const, generation: 1, distance: 33.3, trackId: "dunas" as const, genome: ids(2), hue: 20, humanTouched: true, prunedParents: false },
  ];
  const meta = { seenHelp: ["taller"], persistRequested: true, lastTrack: "pedregal" as const, ritmo: "x1" as const };
  await save(KEY_RANKINGS, rankings);
  await save(KEY_GARAGE, garage);
  await save(KEY_EVOLUTION, evolution);
  await save(KEY_LINEAGE, lineage);
  await save(META_KEY, meta);
  resetStoreConnection();
  const r = await loadAll();
  assert.deepStrictEqual(r.data[KEY_RANKINGS], rankings);
  assert.deepStrictEqual(r.data[KEY_GARAGE], garage);
  assert.deepStrictEqual(r.data[KEY_EVOLUTION], evolution);
  assert.deepStrictEqual(r.data[KEY_LINEAGE], lineage);
  assert.deepStrictEqual(r.data[META_KEY], meta);
  assert.deepStrictEqual(r.warnings, []);
  assert.equal(r.available, true);
  assert.deepStrictEqual(r.needsRemeasure, []);
});

test("sin nada guardado, loadAll devuelve los valores por defecto sin avisos", async () => {
  const r = await loadAll();
  assert.deepStrictEqual(r.data[KEY_RANKINGS], emptyRankings());
  assert.deepStrictEqual(r.data[KEY_GARAGE], []);
  assert.equal(r.data[KEY_EVOLUTION], null);
  assert.deepStrictEqual(r.data[KEY_LINEAGE], []);
  assert.deepStrictEqual(r.data[META_KEY], DEFAULT_META);
  assert.deepStrictEqual(r.warnings, []);
});

test("guardar null borra la clave (evolución abandonada)", async () => {
  await save(KEY_EVOLUTION, { v: 99 });
  await save(KEY_EVOLUTION, null);
  const r = await loadAll();
  assert.equal(r.data[KEY_EVOLUTION], null);
  assert.deepStrictEqual(r.warnings, []);
});

test("gd-2-corrupto: se descarta lo malo, se conserva lo bueno y se avisa", async () => {
  const buena = entry(1, "cordillera", 50);
  await save(KEY_GARAGE, "xyz");
  await save(KEY_RANKINGS, {
    cordillera: [buena, { ...entry(2, "cordillera", 10), distance: "mucho" }],
    volcan: [entry(3, "cordillera", 20)],
  });
  const nodos = Array.from({ length: 5 }, (_, i) => ({
    id: `n${i}`, parents: i ? [`n${i - 1}`] : [], op: "mutation", generation: i, distance: null, trackId: null, genome: ids(i), hue: 0, humanTouched: false, prunedParents: false,
  }));
  await save(KEY_LINEAGE, nodos);
  await save(KEY_EVOLUTION, { v: 99, population: [] });
  const r = await loadAll();
  assert.deepStrictEqual(r.data[KEY_GARAGE], []);
  const rk = r.data[KEY_RANKINGS] as Record<string, RankingEntry[]>;
  assert.deepStrictEqual(rk.cordillera, [buena]);
  assert.equal("volcan" in rk, false);
  for (const t of ["rampa", "dunas", "pedregal"]) assert.deepStrictEqual(rk[t], []);
  assert.equal((r.data[KEY_LINEAGE] as unknown[]).length, 5);
  assert.equal(r.data[KEY_EVOLUTION], null);
  const avisos = r.warnings.join("\n").toLowerCase();
  assert.match(avisos, /garaje/);
  assert.match(avisos, /ranking/);
  assert.match(avisos, /evoluci/);
  assert.equal(r.available, true);
});

test("gd-2: loadAll no lanza con cualquier contenido en cualquier clave (property)", async () => {
  await fc.assert(
    fc.asyncProperty(fc.anything(), fc.anything(), fc.anything(), async (a, b, c) => {
      nuevaBase();
      await save(KEY_RANKINGS, a);
      await save(KEY_GARAGE, b);
      await save(KEY_LINEAGE, c);
      await save(KEY_EVOLUTION, c);
      await save(META_KEY, a);
      const r = await loadAll();
      for (const t of TRACKS) assert.ok(Array.isArray((r.data[KEY_RANKINGS] as Record<string, unknown[]>)[t.id]));
      assert.ok(Array.isArray(r.data[KEY_GARAGE]));
    }),
    { numRuns: 120 },
  );
});

test("gd-3-reglas: updateRanking aplica las reglas del ranking", async () => {
  const rampa: RankingEntry[] = [100, 95, 90, 85, 80].map((d, i) => entry(i, "rampa", d));
  rampa.push(entry(20, "rampa", 80, { bestStep: 5000 })); // G: ya está, empatado con el 5.º, en el 6.º puesto
  rampa.push(...[70, 65, 60, 55].map((d, i) => entry(30 + i, "rampa", d)));
  assert.equal(rampa.length, RANKING_SIZE);
  const rk = emptyRankings();
  rk.rampa = rampa;
  await save(KEY_RANKINGS, rk);

  const o1 = await updateRanking(candidate(50, "rampa", 54.9));
  assert.deepStrictEqual(o1, { entered: false, position: null, alreadyAt: null, isRecord: false, cutoff: 55 });
  const o2 = await updateRanking(candidate(51, "rampa", 80, { reason: "anomaly" }));
  assert.equal(o2.entered, false);
  const o3 = await updateRanking(candidate(20, "rampa", 80));
  assert.deepStrictEqual(o3, { entered: false, position: null, alreadyAt: 6, isRecord: false, cutoff: null });
  const o4 = await updateRanking(candidate(52, "rampa", 90, { trackVersion: 0 }));
  assert.equal(o4.entered, false);
  const o4b = await updateRanking(candidate(53, "rampa", 90, { physicsVersion: PHYSICS_VERSION + 1 }));
  assert.equal(o4b.entered, false);
  const o5 = await updateRanking(candidate(54, "rampa", 97));
  assert.deepStrictEqual(o5, { entered: true, position: 2, alreadyAt: null, isRecord: false, cutoff: null });
  const o6 = await updateRanking(candidate(55, "dunas", 12));
  assert.deepStrictEqual(o6, { entered: true, position: 1, alreadyAt: null, isRecord: true, cutoff: null });

  const r = (await loadAll()).data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>;
  assert.equal(r.rampa.length, 10);
  assert.equal(r.rampa[1].distance, 97);
  assert.equal(r.rampa.some((e) => e.distance === 55), false);
  assert.equal(r.dunas.length, 1);
});

test("gd-3-reglas: un empate con el 10.º en ranking lleno no entra", async () => {
  const rk = emptyRankings();
  rk.rampa = [100, 95, 90, 85, 80, 75, 70, 65, 60, 55].map((d, i) => entry(i, "rampa", d));
  await save(KEY_RANKINGS, rk);
  const o = await updateRanking(candidate(60, "rampa", 55));
  assert.deepStrictEqual(o, { entered: false, position: null, alreadyAt: null, isRecord: false, cutoff: 55 });
});

test("gd-3: dos updateRanking simultáneos no se pisan", async () => {
  const rk = emptyRankings();
  rk.cordillera = Array.from({ length: 9 }, (_, i) => entry(i, "cordillera", 100 - i));
  await save(KEY_RANKINGS, rk);
  const [a, b] = await Promise.all([updateRanking(candidate(70, "cordillera", 60)), updateRanking(candidate(71, "cordillera", 70))]);
  assert.equal(a.entered || b.entered, true);
  const lista = ((await loadAll()).data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>).cordillera;
  assert.equal(lista.length, 10);
  assert.equal(lista[9].distance, 70);
  assert.equal(lista[9].carId, "c71");
});

test("invariante: tras cualquier secuencia de candidatos, cada pista guarda el top 10 de genomas distintos", async () => {
  const trackArb = fc.constantFrom(...TRACKS.map((t) => t.id));
  const cand = fc.record({
    g: fc.integer({ min: 0, max: 29 }),
    track: trackArb,
    anomaly: fc.boolean(),
    badVersion: fc.constantFrom("ok", "ok", "ok", "physics", "track"),
  });
  await fc.assert(
    fc.asyncProperty(fc.array(cand, { minLength: 1, maxLength: 60 }), async (seq) => {
      nuevaBase();
      const modelo = new Map<TrackId, { hash: string; d: number; n: number }[]>(TRACKS.map((t) => [t.id, []]));
      let n = 0;
      for (const c of seq) {
        // La distancia de un genoma en una pista es una función de ambos, como en el juego.
        const dist = (c.g % 13) + c.g + (c.track.length % 5);
        const otras = JSON.stringify((await loadAll()).data[KEY_RANKINGS]);
        await updateRanking(
          candidate(c.g, c.track, dist, {
            reason: c.anomaly ? "anomaly" : "stall",
            physicsVersion: c.badVersion === "physics" ? 99 : PHYSICS_VERSION,
            trackVersion: c.badVersion === "track" ? 0 : trackVersion(c.track),
          }),
        );
        const tras = (await loadAll()).data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>;
        const prev = JSON.parse(otras) as Record<TrackId, unknown>;
        for (const t of TRACKS) if (t.id !== c.track) assert.deepStrictEqual(JSON.parse(JSON.stringify(tras[t.id])), prev[t.id]);
        if (!c.anomaly && c.badVersion === "ok") {
          const lista = modelo.get(c.track)!;
          const h = genomeHash(ids(c.g));
          if (!lista.some((e) => e.hash === h)) {
            lista.push({ hash: h, d: dist, n: n++ });
            lista.sort((a, b) => b.d - a.d || a.n - b.n);
            if (lista.length > RANKING_SIZE) lista.length = RANKING_SIZE;
          }
        }
      }
      const final = (await loadAll()).data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>;
      for (const t of TRACKS) {
        const lista = final[t.id];
        assert.ok(lista.length <= RANKING_SIZE);
        assert.deepStrictEqual(lista.map((e) => e.genomeHash), modelo.get(t.id)!.map((e) => e.hash));
        assert.equal(new Set(lista.map((e) => e.genomeHash)).size, lista.length);
        for (let i = 1; i < lista.length; i++) assert.ok(lista[i - 1].distance >= lista[i].distance);
        assert.ok(lista.every((e) => e.trackId === t.id));
      }
    }),
    { numRuns: 60 },
  );
});

test("gd-4: sin IndexedDB el juego sigue en memoria y lo indica", async () => {
  globalThis.indexedDB = {
    open() {
      throw new Error("modo privado");
    },
  } as unknown as IDBFactory;
  resetStoreConnection();
  const r = await loadAll();
  assert.equal(r.available, false);
  assert.deepStrictEqual(r.data[KEY_GARAGE], []);
  assert.match(r.warnings.join(" "), /no deja guardar/);
  await assert.doesNotReject(save(KEY_GARAGE, [car(1)]));
  const o = await updateRanking(candidate(1, "rampa", 20));
  assert.equal(o.entered, true);
  const de = await loadAll();
  assert.equal((de.data[KEY_GARAGE] as SavedCar[]).length, 1);
  assert.equal((de.data[KEY_RANKINGS] as Record<TrackId, unknown[]>).rampa.length, 1);
  assert.equal(de.available, false);
});

test("gd-5: con 60 coches el 61 devuelve garage-full y no se pierde ninguno", async () => {
  for (let i = 0; i < 60; i++) assert.deepStrictEqual(await saveToGarage(car(i)), { ok: true });
  assert.deepStrictEqual(await saveToGarage(car(61)), { ok: false, reason: "garage-full" });
  const g = (await loadAll()).data[KEY_GARAGE] as SavedCar[];
  assert.equal(g.length, 60);
  assert.equal(g.some((c) => c.id === "g61"), false);
  // Con el garaje lleno, volver a guardar un coche que ya está lo sustituye.
  assert.deepStrictEqual(await saveToGarage({ ...car(3), name: "Renombrado" }), { ok: true });
  assert.equal(((await loadAll()).data[KEY_GARAGE] as SavedCar[]).find((c) => c.id === "g3")?.name, "Renombrado");
});

test("garaje: borrar libera sitio y las marcas solo mejoran", async () => {
  await saveToGarage(car(1));
  await recordMark("g1", "rampa", 40);
  await recordMark("g1", "rampa", 30);
  await recordMark("g1", "dunas", 5);
  let g = (await loadAll()).data[KEY_GARAGE] as SavedCar[];
  assert.deepStrictEqual(g[0].marks, { rampa: 40, dunas: 5 });
  await removeFromGarage("g1");
  g = (await loadAll()).data[KEY_GARAGE] as SavedCar[];
  assert.equal(g.length, 0);
});

test("invariante: el garaje nunca supera 60 coches con cualquier secuencia de altas y bajas", async () => {
  const op = fc.record({ add: fc.boolean(), n: fc.integer({ min: 0, max: 79 }) });
  await fc.assert(
    fc.asyncProperty(fc.array(op, { maxLength: 150 }), async (ops) => {
      nuevaBase();
      for (const o of ops) {
        if (o.add) await saveToGarage(car(o.n));
        else await removeFromGarage(`g${o.n}`);
        const g = (await loadAll()).data[KEY_GARAGE] as SavedCar[];
        assert.ok(g.length <= 60);
      }
    }),
    { numRuns: 15 },
  );
});

test("gd-6: entradas con otra versión se marcan y se vuelven a medir", async () => {
  const rk = emptyRankings();
  rk.cordillera = [entry(1, "cordillera", 50, { physicsVersion: 0 }), entry(2, "cordillera", 40)];
  rk.pedregal = [entry(3, "pedregal", 30, { trackVersion: 0 })];
  await save(KEY_RANKINGS, rk);
  const r = await loadAll();
  assert.deepStrictEqual(r.needsRemeasure.map((e) => e.carId).sort(), ["c1", "c3"]);
  const nuevas: Record<string, number> = { c1: 20, c3: 77 };
  const cambios = await remeasureRankings((g, t) => {
    const e = [...rk.cordillera, ...rk.pedregal].find((x) => x.genomeHash === genomeHash(g))!;
    return result(e.carId, t, nuevas[e.carId]);
  });
  assert.deepStrictEqual(cambios.map((c) => ({ carId: c.carId, before: c.before, after: c.after })).sort((a, b) => a.carId.localeCompare(b.carId)), [
    { carId: "c1", before: 50, after: 20 },
    { carId: "c3", before: 30, after: 77 },
  ]);
  const de = await loadAll();
  const cord = (de.data[KEY_RANKINGS] as Record<TrackId, RankingEntry[]>).cordillera;
  assert.deepStrictEqual(cord.map((e) => [e.carId, e.distance]), [["c2", 40], ["c1", 20]]);
  assert.equal(cord[1].physicsVersion, PHYSICS_VERSION);
  assert.deepStrictEqual(de.needsRemeasure, []);
});

test("gd-6: una anomalía al volver a medir expulsa la entrada", async () => {
  const rk = emptyRankings();
  rk.rampa = [entry(1, "rampa", 50, { physicsVersion: 0 })];
  await save(KEY_RANKINGS, rk);
  const cambios = await remeasureRankings((_g, t) => result("c1", t, 999, { reason: "anomaly" }));
  assert.deepStrictEqual(cambios.map((c) => c.after), [0]);
  assert.equal(((await loadAll()).data[KEY_RANKINGS] as Record<TrackId, unknown[]>).rampa.length, 0);
});

test("genoma guardado: STOCK_CAR y el normalizado coinciden tras la ida y vuelta", async () => {
  const g: Genome = normalizeGenome(STOCK_CAR);
  await saveToGarage({ ...car(1), genome: g });
  const c = ((await loadAll()).data[KEY_GARAGE] as SavedCar[])[0];
  assert.deepStrictEqual(c.genome, g);
});

test("invariante: save + loadAll devuelve un valor igual para rankings y garaje arbitrarios válidos", async () => {
  const entryArb = fc.record({ g: fc.integer({ min: 0, max: 79 }), d: fc.integer({ min: 0, max: 5000 }), t: fc.constantFrom(...TRACKS.map((t) => t.id)) });
  await fc.assert(
    fc.asyncProperty(fc.array(entryArb, { maxLength: 30 }), fc.array(fc.integer({ min: 0, max: 79 }), { maxLength: 60 }), async (es, cs) => {
      nuevaBase();
      const rk = emptyRankings();
      for (const e of es) rk[e.t].push(entry(e.g, e.t, e.d / 10));
      for (const t of TRACKS) {
        rk[t.id] = normalizeRanking(rk[t.id]);
      }
      const garage = [...new Set(cs)].map((n) => car(n, { rampa: n / 2 }));
      await save(KEY_RANKINGS, rk);
      await save(KEY_GARAGE, garage);
      const r = await loadAll();
      assert.deepStrictEqual(r.data[KEY_RANKINGS], rk);
      assert.deepStrictEqual(r.data[KEY_GARAGE], garage);
      assert.deepStrictEqual(r.warnings, []);
    }),
    { numRuns: 40 },
  );
});

test("diag-5: causa y pendiente de parada se validan por valor en RankingEntry y markDetails", async () => {
  const { validateRankings, validateGarage, emptyRankings } = await import("../../src/storage/schema");
  const base = (extra: Record<string, unknown>) => ({
    carId: "a",
    genome: STOCK_CAR,
    distance: 100,
    origin: "diseño",
    date: "2026-10-01T00:00:00.000Z",
    trackId: "rampa",
    trackVersion: getTrack("rampa")!.version,
    physicsVersion: PHYSICS_VERSION,
    ...extra,
  });
  const lee = (extra: Record<string, unknown>) => validateRankings({ ...emptyRankings(), rampa: [base(extra)] })!.rampa[0];
  const ok = lee({ causaParada: "motor", pendienteParada: 41.5 });
  assert.equal(ok.causaParada, "motor");
  assert.equal(ok.pendienteParada, 41.5);
  // Un valor inválido se descarta solo y la marca sigue en el ranking.
  const mala = lee({ causaParada: "magia", pendienteParada: 400 });
  assert.equal(mala.distance, 100);
  assert.equal(mala.causaParada, undefined);
  assert.equal(mala.pendienteParada, undefined);
  assert.equal(lee({}).causaParada, undefined);

  const coche = (id: string, detalle: Record<string, unknown>) => ({
    id,
    name: "x",
    genome: STOCK_CAR,
    marks: { rampa: 80 },
    markDetails: { rampa: { bestStep: 100, piezasPerdidas: 0, ...detalle } },
    origin: "diseño",
    savedAt: "2026-10-01T00:00:00.000Z",
  });
  const g = validateGarage([coche("a", { causaParada: "agarre", pendienteParada: 20 }), coche("b", { causaParada: 7, pendienteParada: "x" })])!;
  assert.equal(g[0].markDetails?.rampa?.causaParada, "agarre");
  assert.equal(g[0].markDetails?.rampa?.pendienteParada, 20);
  assert.equal(g[1].markDetails?.rampa?.bestStep, 100);
  assert.equal(g[1].markDetails?.rampa?.causaParada, undefined);
  assert.equal(g[1].markDetails?.rampa?.pendienteParada, undefined);
});
