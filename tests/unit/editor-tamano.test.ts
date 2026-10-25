import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  MAX_WHEELS,
  ajustarAngulo,
  ajustarLongitud,
  dimensiones,
  escalarCoche,
  factorPermitido,
  piezaLimitante,
  ponerRueda,
  quitarRueda,
  wheelCount,
} from "../../src/game/editor";
import { GENE_RANGES, STOCK_CAR, VERTEX_COUNT, normalizeGenome, type Genome } from "../../src/sim/genome";

// Genoma arbitrario: datos crudos (incluso fuera de rango) que normalizeGenome deja válidos.
const genoma: fc.Arbitrary<Genome> = fc
  .record({
    body: fc.array(fc.record({ angle: fc.double({ min: 0, max: 7 }), length: fc.double({ min: 0, max: 3, noNaN: true }) }), { minLength: 8, maxLength: 8 }),
    bodyDensity: fc.double({ min: 0, max: 250, noNaN: true }),
    wheels: fc.array(
      fc.record({
        vertex: fc.integer({ min: -1, max: 7 }),
        radius: fc.double({ min: 0, max: 1.5, noNaN: true }),
        density: fc.double({ min: 0, max: 150, noNaN: true }),
        axisAngle: fc.double({ min: 0, max: 6.2, noNaN: true }),
      }),
      { minLength: 4, maxLength: 4 },
    ),
  })
  .map((r) => normalizeGenome({ v: 1, ...r }));

const activas = (g: Genome) => g.wheels.filter((w) => w.vertex >= 0);

test("ed-2 invariante: escalar dentro de factorPermitido conserva ángulos y multiplica longitudes y radios", () => {
  fc.assert(
    fc.property(genoma, fc.double({ min: 0, max: 1, noNaN: true }), (g, t) => {
      const [fmin, fmax] = factorPermitido(g);
      const f = fmin + (fmax - fmin) * t;
      const e = escalarCoche(g, f);
      g.body.forEach((v, i) => {
        assert.equal(e.body[i].angle, v.angle);
        assert.ok(Math.abs(e.body[i].length - v.length * f) < 1e-9, `longitud ${i}`);
      });
      g.wheels.forEach((w, i) => {
        if (w.vertex >= 0) assert.ok(Math.abs(e.wheels[i].radius - w.radius * f) < 1e-9, `radio ${i}`);
        assert.equal(e.wheels[i].vertex, w.vertex);
      });
    }),
    { numRuns: 300 },
  );
});

test("ed-2 invariante: fmin ≤ 1 ≤ fmax y un factor fuera de rango devuelve el genoma sin cambios", () => {
  fc.assert(
    fc.property(genoma, (g) => {
      const [fmin, fmax] = factorPermitido(g);
      assert.ok(fmin <= 1 && 1 <= fmax);
      assert.deepEqual(escalarCoche(g, fmax * 1.01 + 1e-6), g);
      assert.deepEqual(escalarCoche(g, fmin * 0.99 - 1e-6), g);
      assert.deepEqual(escalarCoche(g, Number.NaN), g);
    }),
    { numRuns: 300 },
  );
});

test("ed-1 invariante: ajustarAngulo y ajustarLongitud dejan el punto en rango y el resto intacto", () => {
  fc.assert(
    fc.property(genoma, fc.integer({ min: 0, max: 7 }), fc.integer({ min: -400, max: 400 }), (g, i, pasos) => {
      const a = ajustarAngulo(g, i, (pasos * Math.PI) / 180);
      const l = ajustarLongitud(g, i, pasos * 0.1);
      for (const r of [a, l]) {
        assert.deepEqual(normalizeGenome(r), r);
        const [lo, hi] = GENE_RANGES.angle(i);
        assert.ok(r.body[i].angle >= lo - 1e-9 && r.body[i].angle <= hi + 1e-9);
        assert.ok(r.body[i].length >= GENE_RANGES.length[0] - 1e-9 && r.body[i].length <= GENE_RANGES.length[1] + 1e-9);
        r.body.forEach((v, j) => j !== i && assert.deepEqual(v, g.body[j]));
        assert.deepEqual(r.wheels, g.wheels);
      }
      assert.equal(a.body[i].length, g.body[i].length);
      assert.equal(l.body[i].angle, g.body[i].angle);
    }),
    { numRuns: 300 },
  );
});

test("ed-1 invariante: ponerRueda y quitarRueda en el mismo vértice vuelven al número original y nunca pasan de 4", () => {
  fc.assert(
    fc.property(genoma, fc.integer({ min: 0, max: 7 }), (g, v) => {
      const sinRueda = quitarRueda(g, v);
      const puesta = ponerRueda(sinRueda, v);
      assert.ok(wheelCount(puesta) <= MAX_WHEELS);
      // Con las cuatro ocupadas en otros vértices no hay hueco: queda como estaba.
      if (wheelCount(sinRueda) < MAX_WHEELS) {
        assert.equal(wheelCount(puesta), wheelCount(sinRueda) + 1);
        assert.equal(wheelCount(quitarRueda(puesta, v)), wheelCount(sinRueda));
      } else {
        assert.equal(wheelCount(puesta), MAX_WHEELS);
      }
    }),
    { numRuns: 300 },
  );
});

test("ed-2 el coche de serie crece un 21 % en largo con dos pasos del 10 %", () => {
  const antes = dimensiones(STOCK_CAR);
  const despues = dimensiones(escalarCoche(escalarCoche(STOCK_CAR, 1.1), 1.1));
  assert.ok(Math.abs(despues.largo / antes.largo - 1.21) < 1e-9);
  assert.ok(Math.abs(despues.alto / antes.alto - 1.21) < 1e-9);
});

test("ed-2 un punto a 2,4 m impide crecer un 10 % y la pieza limitante lo señala", () => {
  const g = normalizeGenome({ ...STOCK_CAR, body: STOCK_CAR.body.map((v, i) => (i === 2 ? { ...v, length: 2.4 } : v)) });
  assert.ok(factorPermitido(g)[1] < 1.1);
  const p = piezaLimitante(g, 1, 0.1);
  assert.deepEqual(p, { tipo: "punto", indice: 2, medida: 2.4 });
  assert.equal(piezaLimitante(STOCK_CAR, 1, 0.1), null);
});

test("ed-2 una rueda de 0,2 m impide encoger y la pieza limitante es la rueda", () => {
  const g = normalizeGenome({ ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w, i) => (i === 0 ? { ...w, radius: 0.2 } : w)) });
  const slot = g.wheels.findIndex((w) => w.vertex >= 0 && w.radius <= 0.2 + 1e-9);
  assert.ok(slot >= 0);
  const p = piezaLimitante(g, -1, 0.1);
  assert.equal(p?.tipo, "rueda");
  assert.equal(p?.indice, slot);
});

test("ed-1 ponerRueda no sustituye una rueda existente ni pasa del vértice válido", () => {
  const v = STOCK_CAR.wheels.find((w) => w.vertex >= 0)!.vertex;
  assert.deepEqual(ponerRueda(STOCK_CAR, v), normalizeGenome(STOCK_CAR));
  assert.deepEqual(ponerRueda(STOCK_CAR, VERTEX_COUNT), normalizeGenome(STOCK_CAR));
  assert.deepEqual(quitarRueda(STOCK_CAR, -1), normalizeGenome(STOCK_CAR));
  assert.ok(activas(STOCK_CAR).length >= 1);
});
