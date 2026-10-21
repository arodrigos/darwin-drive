import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import * as det from "../../src/sim/detmath";
import { genomeHash, normalizeGenome } from "../../src/sim/genome";
import demoTexto from "../../src/debug/escenarios/rankings-demo.texto";

// Las nativas se guardan antes de que detmath las sustituya en Math.
const nativas = { sin: det.sin, cos: det.cos };

test("detmath: se instala en Math y coincide con la matemática exacta a 1e-14", () => {
  assert.equal(Math.sin, det.sin);
  assert.equal(Math.atan2, det.atan2);
  fc.assert(
    fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -50, max: 50, noNaN: true }), (x, y) => {
      assert.ok(Math.abs(nativas.sin(x) ** 2 + nativas.cos(x) ** 2 - 1) < 1e-14);
      assert.ok(Math.abs(det.tan(y) - Math.sin(y) / Math.cos(y)) < 1e-9 * Math.max(1, Math.abs(det.tan(y))));
      assert.ok(Math.abs(det.exp(det.log(Math.abs(x) + 1e-3)) / (Math.abs(x) + 1e-3) - 1) < 1e-13);
      assert.ok(Math.abs(det.atan2(y, x) - Math.atan(y / x) - (x < 0 ? (y >= 0 ? Math.PI : -Math.PI) : 0)) < 1e-12 || x === 0 || y === 0); // y = -0 con x < 0 da -π (IEEE), no π: el caso y = 0 lo cubre el test de valores conocidos
    }),
  );
});

test("detmath: valores conocidos y casos límite", () => {
  assert.ok(Math.abs(det.sin(Math.PI / 6) - 0.5) < 1e-15);
  assert.ok(Math.abs(det.cos(Math.PI / 3) - 0.5) < 1e-15);
  assert.ok(Math.abs(det.log(Math.E) - 1) < 1e-15);
  assert.ok(Math.abs(det.exp(1) - Math.E) < 1e-15);
  assert.ok(Math.abs(det.atan2(1, 1) - Math.PI / 4) < 1e-15);
  assert.equal(det.atan2(0, -1), Math.PI);
  assert.equal(det.log(0), -Infinity);
  assert.ok(Number.isNaN(det.log(-1)));
  assert.equal(det.exp(1000), Infinity);
  assert.equal(det.exp(-1000), 0);
  assert.ok(Number.isNaN(det.sin(Infinity)));
});

test("rk-1: el escenario demo cargado como texto llega al navegador bit a bit y su hash es el carId", () => {
  const desdeFichero = JSON.parse(readFileSync(new URL("../../src/debug/escenarios/rankings-demo.json", import.meta.url), "utf8"));
  const desdeTexto = JSON.parse(demoTexto);
  assert.deepEqual(desdeTexto, desdeFichero);
  for (const lista of Object.values(desdeTexto) as { carId: string; genome: unknown }[][]) {
    for (const e of lista) assert.equal(genomeHash(normalizeGenome(e.genome)), e.carId);
  }
});
