import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { simulateCar } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { TIPOS_TRAMO, getTrack, tipoTramo } from "../../src/sim/tracks";
import { FLAT_START, MAX_SLOPE_DEG, VERTEX_SPACING } from "../../src/sim/terrain";
import { rotuloTramo } from "../../src/game/superficies";

const mosaico = getTrack("mosaico")!;

test("mos-1: los tramos 0 a 12 (primeros 300 m) usan al menos 4 tipos", () => {
  const tipos = new Set(Array.from({ length: 13 }, (_, i) => tipoTramo(i)));
  assert.ok(tipos.size >= 4, `solo ${tipos.size} tipos`);
});

test("invariante mos: para i ≥ 3 tipoTramo(i) ≠ tipoTramo(i − 1) y es pura", () => {
  fc.assert(
    fc.property(fc.integer({ min: 3, max: 3000 }), (i) => {
      assert.notEqual(tipoTramo(i), tipoTramo(i - 1));
      assert.equal(tipoTramo(i), tipoTramo(i));
      assert.ok(tipoTramo(i) >= 0 && tipoTramo(i) < TIPOS_TRAMO.length);
    }),
    { numRuns: 500 },
  );
});

test("invariante mos: heightAt es continua en las fronteras entre tramos", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 199 }), (i) => {
      const x = i * 25;
      assert.ok(Math.abs(mosaico.heightAt(x) - mosaico.heightAt(x - 1e-9)) < 1e-6, `salto en ${x}`);
      assert.ok(Math.abs(mosaico.heightAt(x + 1e-9) - mosaico.heightAt(x)) < 1e-6);
    }),
  );
});

test("invariante mos: la superficie del tramo coincide con su tipo", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 3000 }), (i) => {
      const tipo = TIPOS_TRAMO[tipoTramo(i)];
      const s = mosaico.surfaceOfSegment(i);
      assert.equal(s.tipo, tipo.startsWith("hielo") ? "hielo" : tipo.startsWith("elastico") ? "elastico" : "roca");
      assert.deepEqual(mosaico.surfaceOfSegment(i), s);
    }),
  );
});

test("mos-2: sin escalones fantasma, la pendiente nunca pasa del máximo y la salida es llana", () => {
  const maxDy = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180) * VERTEX_SPACING;
  for (let x = 0; x < 5000; x += VERTEX_SPACING) {
    assert.ok(Math.abs(mosaico.heightAt(x + VERTEX_SPACING) - mosaico.heightAt(x)) <= maxDy / 2, `escalón en ${x}`);
  }
  for (let x = 0; x <= FLAT_START; x += 0.5) assert.equal(mosaico.heightAt(x), 0);
});

test("mos-2: el mismo coche da el mismo resultado dos veces", () => {
  const a = simulateCar(STOCK_CAR, "mosaico");
  const b = simulateCar(STOCK_CAR, "mosaico");
  assert.deepEqual(a, b);
});

test("mos-3: el rótulo nombra el tipo del tramo en el que está el coche", () => {
  assert.equal(rotuloTramo(0), "Hielo");
  const cambios = new Set<string>();
  for (let x = 0; x < 300; x += 25) cambios.add(rotuloTramo(x + 1));
  assert.ok(cambios.size >= 4);
});
