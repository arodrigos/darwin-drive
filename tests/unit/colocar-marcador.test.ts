import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { colocarMarcador, cruzan, type Caja } from "../../src/game/colocar-marcador";

const ICONO = { w: 30, h: 28 };

// Entradas con hueco garantizado: el coche ocupa como mucho el 40 % del viewport y el rótulo es una placa pequeña.
// El rótulo va siempre por encima del coche, así que debajo hay sitio mientras el coche no pegue con el borde
// inferior: con fy ≤ 0,85 quedan ≥ 60 px libres (el icono pide 32). Pegado al borde puede no haber hueco
// válido a menos de 1,5 alturas (contraejemplo de la semilla -1253896976) y ya no es el caso que se prueba.
const entrada = fc
  .record({
    vw: fc.integer({ min: 320, max: 1400 }),
    vh: fc.integer({ min: 480, max: 1400 }),
    cw: fc.integer({ min: 24, max: 120 }),
    ch: fc.integer({ min: 20, max: 80 }),
    fx: fc.double({ min: 0, max: 1, noNaN: true }),
    fy: fc.double({ min: 0, max: 0.85, noNaN: true }),
    ew: fc.integer({ min: 60, max: 130 }),
    eh: fc.integer({ min: 16, max: 30 }),
    ex: fc.integer({ min: -60, max: 60 }),
    ey: fc.integer({ min: -50, max: 0 }),
    conEtiqueta: fc.boolean(),
  })
  .map((r) => {
    const viewport = { w: r.vw, h: r.vh };
    const coche: Caja = { x: Math.round(r.fx * (r.vw - r.cw)), y: Math.round(r.fy * (r.vh - r.ch)), w: r.cw, h: r.ch };
    const etiqueta: Caja | null = r.conEtiqueta ? { x: coche.x + r.ex, y: coche.y + r.ey - r.eh, w: r.ew, h: r.eh } : null;
    return { viewport, coche, etiqueta };
  });

const distancia = (a: Caja, b: Caja) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));

test("ic-3: la caja queda dentro del viewport y no se cruza con el coche ni con el rótulo", () => {
  fc.assert(
    fc.property(entrada, ({ viewport, coche, etiqueta }) => {
      const c = colocarMarcador(coche, etiqueta, viewport, ICONO);
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= viewport.w && c.y + c.h <= viewport.h);
      assert.equal(cruzan(c, coche), false);
      if (etiqueta) assert.equal(cruzan(c, etiqueta), false);
    }),
    { numRuns: 500 },
  );
});

test("ic-3: el icono está a no más de 1,5 alturas de coche del coche", () => {
  fc.assert(
    fc.property(entrada, ({ viewport, coche, etiqueta }) => {
      const c = colocarMarcador(coche, etiqueta, viewport, ICONO);
      assert.ok(distancia(c, coche) <= coche.h * 1.5);
    }),
    { numRuns: 500 },
  );
});

test("ic-3: es determinista", () => {
  fc.assert(
    fc.property(entrada, ({ viewport, coche, etiqueta }) => {
      assert.deepEqual(colocarMarcador(coche, etiqueta, viewport, ICONO), colocarMarcador(coche, etiqueta, viewport, ICONO));
    }),
    { numRuns: 200 },
  );
});

test("con hueco a la derecha, el icono va a la derecha del coche", () => {
  const c = colocarMarcador({ x: 100, y: 200, w: 80, h: 40 }, { x: 90, y: 170, w: 100, h: 20 }, { w: 360, h: 640 }, ICONO);
  assert.equal(c.x, 184);
});

test("con el coche pegado al borde derecho, pasa a la izquierda", () => {
  const c = colocarMarcador({ x: 270, y: 200, w: 80, h: 40 }, null, { w: 360, h: 640 }, ICONO);
  assert.ok(c.x + c.w <= 270);
});
