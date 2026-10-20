import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  BATCH_SIZE,
  CELL_COUNT,
  LENGTH_EDGES,
  activeWheels,
  bodyLength,
  cellIndex,
  discovered,
  emptyArchive,
  integrateBatch,
  planBatch,
  type BatchCar,
  type SpeciesArchive,
} from "../../src/evolution/species";
import { PHYSICS_VERSION, type CarResult } from "../../src/sim/constants";
import { STOCK_CAR, normalizeGenome, type Genome } from "../../src/sim/genome";
import { createRace } from "../../src/sim/race";
import { TRACKS, getTrack, type TrackId } from "../../src/sim/tracks";
import { validateSpecies } from "../../src/storage/schema";
import { seededGenomes } from "./helpers/rng";

function fake(archive: SpeciesArchive, cars: BatchCar[], distances: number[]): CarResult[] {
  return cars.map((c, i) => ({
    carId: c.carId,
    distance: distances[i % distances.length],
    reason: "stall",
    steps: 100,
    physicsVersion: archive.physicsVersion,
    trackId: archive.trackId,
    trackVersion: archive.trackVersion,
  }));
}

/** Física real: los coches del lote, cada uno en su mundo, hasta que acaban todos. */
function raceBatch(archive: SpeciesArchive, cars: BatchCar[]): CarResult[] {
  const race = createRace(cars, archive.trackId);
  while (!race.done()) race.step(120);
  const results = race.results();
  race.dispose();
  return results;
}

const trackArb = fc.constantFrom<TrackId>(...TRACKS.map((t) => t.id));
const distancesArb = fc.array(fc.double({ min: 0, max: 3000, noNaN: true }), { minLength: 1, maxLength: BATCH_SIZE });

function playBatches(archive: SpeciesArchive, batches: number[][]): SpeciesArchive[] {
  const history = [archive];
  for (const distances of batches) {
    const last = history[history.length - 1];
    const plan = planBatch(last);
    history.push(integrateBatch(plan.archive, plan.cars, fake(plan.archive, plan.cars, distances)));
  }
  return history;
}

test("cellIndex: la fila son las ruedas activas y la columna la franja de largo", () => {
  assert.equal(activeWheels(STOCK_CAR), 2);
  const largo = bodyLength(STOCK_CAR);
  const columna = LENGTH_EDGES.filter((e) => largo >= e).length;
  assert.equal(cellIndex(STOCK_CAR), 1 * 4 + columna);
  const sinRuedas = normalizeGenome({ ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w) => ({ ...w, vertex: -1 })) });
  assert.equal(cellIndex(sinRuedas), null);
});

test("cellIndex: cae siempre dentro de la rejilla (property)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1e6 }), (seed) => {
      for (const g of seededGenomes(seed, 20)) {
        const i = cellIndex(g);
        if (i === null) assert.equal(activeWheels(g), 0);
        else assert.ok(Number.isInteger(i) && i >= 0 && i < CELL_COUNT);
      }
    }),
    { numRuns: 50 },
  );
});

test("invariante 1: cada celda tiene como mucho un coche y es de esa especie (property)", () => {
  fc.assert(
    fc.property(trackArb, fc.integer({ min: 1, max: 1e6 }), fc.array(distancesArb, { minLength: 1, maxLength: 6 }), (track, seed, batches) => {
      const final = playBatches(emptyArchive(track, seed), batches).at(-1)!;
      assert.equal(final.cells.length, CELL_COUNT);
      final.cells.forEach((cell, i) => {
        if (cell) assert.equal(cellIndex(cell.genome), i);
      });
    }),
    { numRuns: 40 },
  );
});

test("invariante 2: la distancia de una celda nunca decrece de un lote a otro (property)", () => {
  fc.assert(
    fc.property(trackArb, fc.integer({ min: 1, max: 1e6 }), fc.array(distancesArb, { minLength: 2, maxLength: 8 }), (track, seed, batches) => {
      const history = playBatches(emptyArchive(track, seed), batches);
      for (let b = 1; b < history.length; b++) {
        history[b - 1].cells.forEach((before, i) => {
          if (!before) return;
          const after = history[b].cells[i];
          assert.ok(after !== null && after.distance >= before.distance);
        });
      }
    }),
    { numRuns: 40 },
  );
});

test("invariante 3: un resultado de otra pista o de otra versión no entra en el archivo (property)", () => {
  fc.assert(
    fc.property(trackArb, trackArb, fc.integer({ min: 1, max: 1e6 }), (a, b, seed) => {
      const archive = emptyArchive(a, seed);
      const plan = planBatch(archive);
      const ajena = fake(plan.archive, plan.cars, [50]).map((r) => ({ ...r, trackId: b }));
      if (a === b) assert.doesNotThrow(() => integrateBatch(plan.archive, plan.cars, ajena));
      else assert.throws(() => integrateBatch(plan.archive, plan.cars, ajena), /pista/);
      const vieja = fake(plan.archive, plan.cars, [50]).map((r) => ({ ...r, physicsVersion: PHYSICS_VERSION + 1 }));
      assert.throws(() => integrateBatch(plan.archive, plan.cars, vieja), /versión/);
    }),
    { numRuns: 30 },
  );
});

test("invariante 4: mismo archivo y mismos resultados dan el mismo lote siguiente (property)", () => {
  fc.assert(
    fc.property(trackArb, fc.integer({ min: 1, max: 1e6 }), fc.array(distancesArb, { minLength: 1, maxLength: 4 }), (track, seed, batches) => {
      const uno = playBatches(emptyArchive(track, seed), batches).at(-1)!;
      // Un archivo que pasó por el guardado (JSON) sigue dando lo mismo que el que nunca salió de memoria.
      const dos = JSON.parse(JSON.stringify(playBatches(emptyArchive(track, seed), batches).at(-1)!)) as SpeciesArchive;
      assert.deepEqual(planBatch(uno), planBatch(dos));
    }),
    { numRuns: 30 },
  );
});

test("un lote no repite genoma ni se pasa del tamaño", () => {
  const archive = emptyArchive("dunas", 5);
  const { cars } = planBatch(archive);
  assert.ok(cars.length > 0 && cars.length <= BATCH_SIZE);
  assert.equal(new Set(cars.map((c) => c.carId)).size, cars.length);
});

test("integrar rechaza un coche que no estaba en el lote", () => {
  const archive = emptyArchive("rampa", 3);
  const plan = planBatch(archive);
  const extra = { ...fake(plan.archive, plan.cars, [10])[0], carId: "otro" };
  assert.throws(() => integrateBatch(plan.archive, plan.cars, [extra]), /lote/);
});

test("es-1: 20 lotes de 8 en La Cordillera ocupan al menos 8 de las 16 celdas y ninguna empeora", () => {
  let archive = emptyArchive("cordillera", 1810);
  for (let b = 0; b < 20; b++) {
    const plan = planBatch(archive);
    const next = integrateBatch(plan.archive, plan.cars, raceBatch(plan.archive, plan.cars));
    archive.cells.forEach((before, i) => {
      if (before) assert.ok(next.cells[i]!.distance >= before.distance);
    });
    archive = next;
  }
  const filas = [0, 1, 2, 3].map((r) =>
    archive.cells
      .slice(r * 4, r * 4 + 4)
      .map((c) => (c ? c.distance.toFixed(0).padStart(5) : "    ?"))
      .join(" "),
  );
  console.log(`Rejilla de La Cordillera tras 20 lotes (${discovered(archive)}/16):\n${filas.join("\n")}`);
  assert.ok(discovered(archive) >= 8, `solo ${discovered(archive)} celdas`);
});

test("el guardado de especies: ida y vuelta, y se descarta lo inválido por archivo", () => {
  const plan = planBatch(emptyArchive("rampa", 9));
  const bueno = integrateBatch(plan.archive, plan.cars, fake(plan.archive, plan.cars, [40, 80, 20]));
  const avisos: string[] = [];
  const leido = validateSpecies(JSON.parse(JSON.stringify({ rampa: bueno })), (m) => avisos.push(m));
  assert.deepEqual(leido, { rampa: bueno });
  assert.deepEqual(avisos, []);

  const celdaMal = bueno.cells.map((c) => c);
  const primera = celdaMal.findIndex((c) => c !== null);
  celdaMal[(primera + 1) % CELL_COUNT] = celdaMal[primera]; // un coche en una celda que no es la suya
  const cambiaVersion = { ...bueno, trackVersion: bueno.trackVersion + 1 };
  const out = validateSpecies(
    { rampa: { ...bueno, cells: celdaMal }, dunas: cambiaVersion, noExiste: bueno, pedregal: "basura" },
    (m) => avisos.push(m),
  );
  assert.deepEqual(out, {});
  assert.equal(avisos.length, 4);
  assert.equal(validateSpecies([]), null);
  assert.equal(getTrack("rampa")?.version, bueno.trackVersion);
});
