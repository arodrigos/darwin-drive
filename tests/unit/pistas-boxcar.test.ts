import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { createRace } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { META_DISTANCE } from "../../src/sim/constants";
import { compararMarcas, claveTexto, type Marca } from "../../src/sim/clasificacion";
import { ACANTILADO_MAX, ACANTILADO_MIN, ROCA, getTrack } from "../../src/sim/tracks";
import { FLAT_START, MAX_SLOPE_DEG } from "../../src/sim/terrain";

const acantilado = getTrack("acantilado")!;
const recta = getTrack("recta")!;
const TAN_MAX = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);

test("invariante bx-1: en El Acantilado heightAt no sube más de 0,5 m en 25 m, ninguna cara pasa de 70° y ningún escalón de 6 m", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 5000, noNaN: true }), fc.double({ min: 0, max: 25, noNaN: true }), (x, dx) => {
      assert.ok(acantilado.heightAt(x + dx) - acantilado.heightAt(x) <= 0.5);
      // Entre vértices de 0,5 m (y en cualquier intervalo corto) la pendiente no supera los 70°.
      assert.ok(Math.abs(acantilado.heightAt(x + 0.5) - acantilado.heightAt(x)) <= TAN_MAX * 0.5 + 1e-9);
    }),
    { numRuns: 500 },
  );
  // Cada escalón (caída total entre rellanos) mide entre 0,5 y 6 m.
  let previo = acantilado.heightAt(FLAT_START + 0.001);
  for (let n = 1; n < 360; n++) {
    const rellano = acantilado.heightAt(FLAT_START + n * 14 - 0.001);
    const caida = previo - rellano;
    assert.ok(caida >= -1e-6 && caida <= ACANTILADO_MAX + 0.01, `escalón ${n}: ${caida}`);
    previo = rellano;
  }
  assert.ok(ACANTILADO_MIN <= 0.5);
});

test("bx-1: los escalones crecen de ~0,5 m a 6 m con la distancia", () => {
  const caida = (n: number) => acantilado.heightAt(FLAT_START + n * 14 - 0.01) - acantilado.heightAt(FLAT_START + (n + 1) * 14 - 0.01);
  assert.ok(caida(0) < 1.5, `primero ${caida(0)}`);
  const tarde = Array.from({ length: 20 }, (_, i) => caida(300 + i));
  assert.ok(Math.max(...tarde) > 5.5 && Math.max(...tarde) <= 6.0001);
});

test("invariante bx-1: en La Recta |heightAt| ≤ 0,5, superficie ROCA y llana en [0, FLAT_START]", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 8000, noNaN: true }), fc.integer({ min: 0, max: 5000 }), (x, i) => {
      assert.ok(Math.abs(recta.heightAt(x)) <= 0.5);
      assert.equal(recta.surfaceOfSegment(i), ROCA);
      assert.equal(recta.heightAt(x), recta.heightAt(x));
      if (x <= FLAT_START) assert.equal(recta.heightAt(x), 0);
    }),
    { numRuns: 400 },
  );
});

test("invariante bx-1: heightAt de las dos pistas vale 0 en [0, FLAT_START]", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: FLAT_START, noNaN: true }), (x) => {
      assert.equal(acantilado.heightAt(x), 0);
      assert.equal(recta.heightAt(x), 0);
    }),
  );
});

test("bx-2: El Acantilado tiene placas de hielo cada vez más frecuentes y roca entre ellas", () => {
  const hielo = (desde: number) => Array.from({ length: 60 }, (_, k) => acantilado.surfaceOfSegment(desde + k)).filter((s) => s.tipo === "hielo").length;
  assert.equal(acantilado.surfaceOfSegment(1), ROCA);
  assert.ok(hielo(2) > 0 && hielo(2) < 60);
  assert.ok(hielo(140) > hielo(2), "más hielo lejos que cerca");
});

test("bx-3: el coche de serie llega a la meta de La Recta y el ranking se ordena por tiempo", () => {
  const race = createRace([{ carId: "serie", genome: STOCK_CAR }], "recta", {});
  while (!race.done()) race.step(60);
  const r = race.results()[0];
  race.dispose();
  assert.equal(r.reason, "meta");
  assert.equal(r.distance, META_DISTANCE);
  assert.ok(r.bestStep > 0);

  const base: Marca = { distance: 5000, bestStep: 6000, piezasPerdidas: 0, date: "2026-01-01T00:00:00.000Z", genomeHash: "a" };
  const rapida: Marca = { ...base, bestStep: 5000, genomeHash: "b" };
  assert.ok(compararMarcas(rapida, base) < 0);
  assert.equal(claveTexto(rapida, base), "rapida");
});

test("bx-2: surfaceOfSegment de El Acantilado devuelve siempre una superficie válida, también con índices negativos", () => {
  fc.assert(
    fc.property(fc.integer({ min: -50, max: 5000 }), (i) => {
      const s = acantilado.surfaceOfSegment(i);
      assert.ok(s.friction >= 0.02 && s.friction <= 1);
      assert.deepEqual(acantilado.surfaceOfSegment(i), s);
    }),
  );
});
