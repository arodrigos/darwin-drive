import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { DEFAULT_WHEEL_RADIUS, MAX_WHEELS, moveVertex, setBodyDensity, setWheelAxis, setWheelRadius, toggleWheel, wheelCount } from "../../src/game/editor";
import { GENE_RANGES, STOCK_CAR, VERTEX_COUNT, normalizeGenome, type Genome } from "../../src/sim/genome";
import { avisoRanking, textoRanking } from "../../src/app/ranking-text";

const dentroDeRango = (g: Genome) => {
  g.body.forEach((v, i) => {
    const [lo, hi] = GENE_RANGES.angle(i);
    assert.ok(v.angle >= lo - 1e-9 && v.angle <= hi + 1e-9, `ángulo ${i}`);
    assert.ok(v.length >= GENE_RANGES.length[0] - 1e-9 && v.length <= GENE_RANGES.length[1] + 1e-9, `largo ${i}`);
  });
  for (let i = 1; i < VERTEX_COUNT; i++) assert.ok(g.body[i].angle > g.body[i - 1].angle, "ángulos estrictamente crecientes");
  assert.ok(g.bodyDensity >= GENE_RANGES.bodyDensity[0] && g.bodyDensity <= GENE_RANGES.bodyDensity[1]);
  for (const w of g.wheels) {
    assert.ok(w.radius >= GENE_RANGES.radius[0] && w.radius <= GENE_RANGES.radius[1]);
    assert.ok(w.axisAngle >= 0 && w.axisAngle < 2 * Math.PI);
  }
  const usados = g.wheels.filter((w) => w.vertex >= 0).map((w) => w.vertex);
  assert.equal(new Set(usados).size, usados.length, "una rueda por vértice");
  assert.deepEqual(normalizeGenome(g), g, "el editor solo emite genomas normalizados");
};

const gesto = fc.oneof(
  fc.record({ k: fc.constant("mover" as const), i: fc.integer({ min: 0, max: 7 }), x: fc.double({ min: -50, max: 50, noNaN: false }), y: fc.double({ min: -50, max: 50, noNaN: false }) }),
  fc.record({ k: fc.constant("rueda" as const), v: fc.integer({ min: -1, max: 9 }) }),
  fc.record({ k: fc.constant("radio" as const), s: fc.integer({ min: -1, max: 5 }), r: fc.double({ min: -5, max: 5 }) }),
  fc.record({ k: fc.constant("eje" as const), s: fc.integer({ min: 0, max: 3 }), a: fc.double({ min: -20, max: 20 }) }),
  fc.record({ k: fc.constant("peso" as const), d: fc.double({ min: -500, max: 500 }) }),
);

test("tl-2 invariante: ninguna secuencia de gestos saca el genoma de GENE_RANGES", () => {
  fc.assert(
    fc.property(fc.array(gesto, { maxLength: 40 }), (gestos) => {
      let g = STOCK_CAR;
      for (const a of gestos) {
        if (a.k === "mover") g = moveVertex(g, a.i, a.x, a.y);
        else if (a.k === "rueda") g = toggleWheel(g, a.v).genome;
        else if (a.k === "radio") g = setWheelRadius(g, a.s, a.r);
        else if (a.k === "eje") g = setWheelAxis(g, a.s, a.a);
        else g = setBodyDensity(g, a.d);
        dentroDeRango(g);
        assert.ok(wheelCount(g) <= MAX_WHEELS);
      }
    }),
    { numRuns: 300 },
  );
});

test("tl-2 mover un vértice solo cambia ese vértice y el largo va a pasos de 0,1 m", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 7 }), fc.double({ min: -10, max: 10, noNaN: true }), fc.double({ min: -10, max: 10, noNaN: true }), (i, x, y) => {
      const g = moveVertex(STOCK_CAR, i, x, y);
      g.body.forEach((v, j) => {
        if (j !== i) assert.deepEqual(v, STOCK_CAR.body[j]);
      });
      const pasos = g.body[i].length * 10;
      assert.ok(Math.abs(pasos - Math.round(pasos)) < 1e-6);
    }),
  );
});

test("tl-2 un asa arrastrada fuera de su sector se queda en el borde y a 2,5 m como mucho", () => {
  // Vértice 0 llevado a la esquina opuesta (abajo a la izquierda).
  const g = moveVertex(STOCK_CAR, 0, -30, -30);
  const [lo, hi] = GENE_RANGES.angle(0);
  assert.ok(g.body[0].angle >= lo && g.body[0].angle <= hi);
  assert.equal(g.body[0].length, 2.5);
  const alBorde = moveVertex(STOCK_CAR, 0, 1, -0.2);
  assert.ok(Math.abs(alBorde.body[0].angle - lo) < 1e-9, "por debajo del sector, al borde inferior");
});

test("tl-1 poner y quitar ruedas: hasta 4, una por vértice, radio inicial 0,5 m", () => {
  let g = STOCK_CAR;
  assert.equal(wheelCount(g), 2);
  const r = toggleWheel(g, 3);
  g = r.genome;
  assert.equal(wheelCount(g), 3);
  assert.equal(g.wheels[r.slot!].vertex, 3);
  assert.equal(g.wheels[r.slot!].radius, DEFAULT_WHEEL_RADIUS);
  g = toggleWheel(g, 1).genome;
  assert.equal(wheelCount(g), 4);
  assert.deepEqual(toggleWheel(g, 0).genome, g);
  assert.equal(wheelCount(toggleWheel(g, 0).genome), 4, "la quinta rueda no entra");
  assert.equal(wheelCount(toggleWheel(g, 3).genome), 3, "tocar una rueda la quita");
  let sin = g;
  for (const v of [5, 7, 3, 1]) sin = toggleWheel(sin, v).genome;
  assert.equal(wheelCount(sin), 0);
});

test("tl-1 textos de la inscripción en el ranking", () => {
  const base = { entered: false, position: null, alreadyAt: null, isRecord: false, cutoff: null };
  assert.equal(textoRanking({ ...base, entered: true, position: 1, isRecord: true }, "La Rampa", 64.2), "¡Nuevo récord en La Rampa! 64,2 m");
  assert.equal(textoRanking({ ...base, entered: true, position: 4 }, "La Rampa", 50), "Entra en el ranking de La Rampa: puesto 4 de 10");
  assert.equal(textoRanking({ ...base, cutoff: 41.2 }, "La Rampa", 10), "No entra en el ranking de La Rampa: el 10.º tiene 41,2 m");
  assert.equal(textoRanking({ ...base, alreadyAt: 2 }, "La Rampa", 10), "Ya está en el ranking de La Rampa: puesto 2");
  assert.equal(avisoRanking({ ...base, entered: true, position: 4 }, "Las Dunas", 52), "Puesto 4 en Las Dunas · 52,0 m");
  assert.equal(avisoRanking({ ...base, entered: true, position: 1, isRecord: true }, "Las Dunas", 64.2), "¡Nuevo récord en Las Dunas! 64,2 m");
  assert.equal(avisoRanking({ ...base, alreadyAt: 1 }, "Las Dunas", 64.2), null);
});
