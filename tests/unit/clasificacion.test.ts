import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { compararMarcas, claveTexto, formatTiempo, marcaCreible, decimas, type Marca } from "../../src/sim/clasificacion";
import { createRace } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { MAX_STEPS, META_DISTANCE } from "../../src/sim/constants";
import { validateRankings } from "../../src/storage/schema";

const marcaArb = fc.record(
  {
    distance: fc.double({ min: 0, max: 5000, noNaN: true }),
    bestStep: fc.integer({ min: 0, max: MAX_STEPS }),
    piezasPerdidas: fc.integer({ min: 0, max: 8 }),
    descalificado: fc.boolean(),
    date: fc.constantFrom("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
    genomeHash: fc.constantFrom("a", "b", "c"),
  },
  { requiredKeys: ["distance"] },
) as fc.Arbitrary<Marca>;

test("cla-1-a: caso concreto C, A, B, D, E con la clave que decide cada empate", () => {
  const A: Marca = { distance: 1234.52, bestStep: 6200, piezasPerdidas: 0, date: "2026-01-01T00:00:00.000Z", genomeHash: "a" };
  const B: Marca = { distance: 1234.5, bestStep: 6000, piezasPerdidas: 2, date: "2026-01-02T00:00:00.000Z", genomeHash: "b" };
  const C: Marca = { distance: 1234.5, bestStep: 6100, piezasPerdidas: 0, date: "2026-01-03T00:00:00.000Z", genomeHash: "c" };
  const D: Marca = { ...C, bestStep: 6300, genomeHash: "d" };
  const E: Marca = { ...D, date: "2026-01-04T00:00:00.000Z", genomeHash: "e" };
  const orden = [E, D, B, A, C].sort(compararMarcas);
  assert.deepEqual(orden.map((m) => m.genomeHash), ["c", "a", "d", "e", "b"]);
  assert.equal(claveTexto(C, B), "entera");
  assert.equal(claveTexto(A, D), "rapida");
  assert.equal(claveTexto(D, E), "llegada");
});

test("cla-1 invariante: orden total (antisimetría, transitividad, estable ante permutaciones)", () => {
  fc.assert(
    fc.property(fc.array(marcaArb, { minLength: 3, maxLength: 12 }), fc.integer(), (marcas, seed) => {
      for (const a of marcas) for (const b of marcas) assert.equal(compararMarcas(a, b), -compararMarcas(b, a) || 0);
      for (const a of marcas) for (const b of marcas) for (const c of marcas) {
        if (compararMarcas(a, b) <= 0 && compararMarcas(b, c) <= 0) assert.ok(compararMarcas(a, c) <= 0);
      }
      const barajada = [...marcas].sort((x, y) => ((x.distance * 7919 + seed) % 13) - ((y.distance * 7919 + seed) % 13));
      const a = [...marcas].sort(compararMarcas);
      const b = [...barajada].sort(compararMarcas);
      a.forEach((m, i) => assert.equal(compararMarcas(m, b[i]), 0));
    }),
    { numRuns: 60 },
  );
});

test("cla-1 invariante: un descalificado nunca precede a uno válido", () => {
  fc.assert(
    fc.property(marcaArb, marcaArb, (a, b) => {
      if (a.descalificado && !b.descalificado) assert.equal(compararMarcas(a, b), 1);
    }),
  );
});

test("cla-2-a: en llano la carrera acaba en meta, con bestStep igual a los pasos y entre 10 800 y 54 000", () => {
  const race = createRace([{ carId: "a", genome: STOCK_CAR }], "cordillera", { heightFn: () => 0 });
  while (!race.done()) race.step(500);
  const r = race.results()[0];
  assert.equal(r.reason, "meta");
  assert.equal(r.distance, META_DISTANCE);
  assert.ok(r.steps > 10800 && r.steps < MAX_STEPS);
  assert.equal(r.steps, r.bestStep);
  race.dispose();
});

test("cla-5: formatTiempo es exacto, trunca a la décima y es monótono", () => {
  assert.equal(formatTiempo(0), "0:00,0");
  assert.equal(formatTiempo(6138), "1:42,3");
  assert.equal(formatTiempo(MAX_STEPS), "15:00,0");
  fc.assert(
    fc.property(fc.integer({ min: 0, max: MAX_STEPS - 1 }), (s) => {
      assert.ok(formatTiempo(s) <= formatTiempo(s + 1) || formatTiempo(s).length < formatTiempo(s + 1).length);
    }),
  );
});

test("cla-10: JSON arbitrario por validateRankings no rompe y deja solo marcas dentro de la física", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (j) => {
      const out = validateRankings(j as unknown);
      if (!out) return;
      for (const lista of Object.values(out)) for (const e of lista as { distance: number }[]) assert.ok(e.distance <= META_DISTANCE);
    }),
    { numRuns: 80 },
  );
});

test("marcaCreible rechaza lo imposible y decimas redondea como la pantalla", () => {
  assert.equal(marcaCreible({ distance: 5000, bestStep: 1 }), false);
  assert.equal(marcaCreible({ distance: 100, bestStep: 54001 }), false);
  assert.equal(marcaCreible({ distance: 100, bestStep: 6000, piezasPerdidas: 9 }), false);
  assert.equal(marcaCreible({ distance: 100 }), false);
  assert.equal(marcaCreible({ distance: 100, bestStep: 6000, piezasPerdidas: 0 }), true);
  assert.equal(decimas(1234.55), 12346);
});
