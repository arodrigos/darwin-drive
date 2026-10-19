// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { World, Vec2 } from "planck";
import { GENE_RANGES, STOCK_CAR, VERTEX_COUNT, WHEEL_SLOTS, genomeHash, normalizeGenome, type Genome } from "../../src/sim/genome";
import { buildCar } from "../../src/sim/physics/car";
import { createRace, liveBodyCount } from "../../src/sim/race";

const NUM_RUNS = 10_000;

// Entradas hostiles: números raros, no-objetos, arrays de longitud errónea.
const weirdNumber = fc.oneof(
  fc.double({ noNaN: false }),
  fc.constantFrom(NaN, Infinity, -Infinity, 1e9, -1e9, 0, -0, Number.MAX_VALUE, Number.MIN_VALUE),
);
const weirdValue = fc.oneof(weirdNumber, fc.string(), fc.constant(null), fc.constant(undefined), fc.boolean());
const weirdVertex = fc.oneof(fc.record({ angle: weirdValue, length: weirdValue }, { requiredKeys: [] }), weirdValue);
const weirdWheel = fc.oneof(
  fc.record({ vertex: weirdValue, radius: weirdValue, density: weirdValue, axisAngle: weirdValue }, { requiredKeys: [] }),
  weirdValue,
);
const weirdGenome = fc.oneof(
  fc.anything(),
  fc.record(
    {
      v: fc.anything(),
      body: fc.oneof(fc.array(weirdVertex, { maxLength: 12 }), weirdValue),
      bodyDensity: weirdValue,
      wheels: fc.oneof(fc.array(weirdWheel, { maxLength: 7 }), weirdValue),
    },
    { requiredKeys: [] },
  ),
);

function assertInRange(g: Genome): void {
  assert.equal(g.v, 1);
  assert.equal(g.body.length, VERTEX_COUNT);
  assert.equal(g.wheels.length, WHEEL_SLOTS);
  g.body.forEach((b, i) => {
    const [lo, hi] = GENE_RANGES.angle(i);
    assert.ok(b.angle >= lo && b.angle <= hi, `angle ${i}`);
    assert.ok(b.length >= GENE_RANGES.length[0] && b.length <= GENE_RANGES.length[1], `length ${i}`);
  });
  assert.ok(g.bodyDensity >= GENE_RANGES.bodyDensity[0] && g.bodyDensity <= GENE_RANGES.bodyDensity[1]);
  for (const w of g.wheels) {
    assert.ok(Number.isInteger(w.vertex) && w.vertex >= -1 && w.vertex < VERTEX_COUNT);
    assert.ok(w.radius >= GENE_RANGES.radius[0] && w.radius <= GENE_RANGES.radius[1]);
    assert.ok(w.density >= GENE_RANGES.wheelDensity[0] && w.density <= GENE_RANGES.wheelDensity[1]);
    assert.ok(w.axisAngle >= 0 && w.axisAngle < 2 * Math.PI);
  }
}

test("invariante: normalizeGenome nunca lanza y deja todos los genes en rango (nf-1)", () => {
  fc.assert(
    fc.property(weirdGenome, (input) => {
      assertInRange(normalizeGenome(input));
    }),
    { numRuns: NUM_RUNS },
  );
});

test("invariante: normalizeGenome es idempotente (nf-1)", () => {
  fc.assert(
    fc.property(weirdGenome, (input) => {
      const once = normalizeGenome(input);
      assert.deepEqual(normalizeGenome(once), once);
    }),
    { numRuns: NUM_RUNS },
  );
});

test("invariante: sin ruedas en el mismo vértice y ángulos estrictamente crecientes (nf-1)", () => {
  fc.assert(
    fc.property(weirdGenome, (input) => {
      const g = normalizeGenome(input);
      const active = g.wheels.filter((w) => w.vertex >= 0).map((w) => w.vertex);
      assert.equal(new Set(active).size, active.length);
      for (let i = 1; i < g.body.length; i++) assert.ok(g.body[i].angle > g.body[i - 1].angle);
    }),
    { numRuns: NUM_RUNS },
  );
});

test("invariante: todo genoma normalizado se construye con masa > 0 y avanza sin excepción (nf-1)", () => {
  fc.assert(
    fc.property(weirdGenome, (input) => {
      const g = normalizeGenome(input);
      const world = new World({ gravity: Vec2(0, -9.81) });
      const car = buildCar(world, g, 0, 0);
      assert.ok(car.mass > 0);
      world.destroyBody(car.chassis);
    }),
    { numRuns: NUM_RUNS },
  );
  // La construcción sola no prueba que el mundo aguante: se avanza 60 pasos en una carrera real.
  fc.assert(
    fc.property(weirdGenome, (input) => {
      const race = createRace([{ carId: "x", genome: normalizeGenome(input) }], "cordillera");
      race.step(60);
      race.dispose();
    }),
    { numRuns: 300 },
  );
});

test("nf-1-basura: cinco entradas hostiles dan genomas válidos que corren 60 pasos", () => {
  const allNaN = {
    body: Array.from({ length: 8 }, () => ({ angle: NaN, length: NaN })),
    bodyDensity: NaN,
    wheels: Array.from({ length: 4 }, () => ({ vertex: 0, radius: NaN, density: NaN, axisAngle: NaN })),
  };
  const bigRadius = { ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w, i) => (i === 0 ? { ...w, radius: 1e9 } : w)) };
  const inputs = [null, {}, { body: "x" }, allNaN, bigRadius];
  const genomes = inputs.map(normalizeGenome);
  genomes.forEach(assertInRange);
  assert.equal(genomes[4].wheels[0].radius, 1.2);
  for (const g of genomes) assert.ok(!JSON.stringify(g).includes("null"), "ningún NaN serializado como null");
  for (const g of genomes) {
    const race = createRace([{ carId: "x", genome: g }], "cordillera");
    race.step(60);
    race.dispose();
  }
});

test("nf-1-rueda-repetida: la rueda de índice mayor se apaga", () => {
  const g = normalizeGenome({
    ...STOCK_CAR,
    wheels: [
      { vertex: 5, radius: 0.5, density: 50, axisAngle: 1 },
      { vertex: -1, radius: 0.5, density: 50, axisAngle: 1 },
      { vertex: 5, radius: 0.5, density: 50, axisAngle: 1 },
      { vertex: -1, radius: 0.5, density: 50, axisAngle: 1 },
    ],
  });
  assert.equal(g.wheels[0].vertex, 5);
  assert.equal(g.wheels[2].vertex, -1);
});

test("genomeHash es estable, distingue genomas y STOCK_CAR tiene ruedas en 5 y 7", () => {
  assert.equal(genomeHash(STOCK_CAR), genomeHash(normalizeGenome(JSON.parse(JSON.stringify(STOCK_CAR)))));
  assert.notEqual(genomeHash(STOCK_CAR), genomeHash(normalizeGenome(null)));
  assert.deepEqual(
    STOCK_CAR.wheels.filter((w) => w.vertex >= 0).map((w) => w.vertex),
    [5, 7],
  );
  assert.equal(liveBodyCount(), 0);
});
