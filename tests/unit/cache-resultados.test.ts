import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGenome, STOCK_CAR } from "../../src/sim/genome";
import { CacheResultados, simulateCar } from "../../src/sim/race";

// Pistas cortas para el coche de serie: cada simulación tarda decenas de ms.
const CORTA = "trampolines" as const;
const OTRA = "pedregal" as const;

test("cache: la primera vez simula y devuelve lo mismo que simulateCar", () => {
  const cache = new CacheResultados();
  const r = cache.simular(STOCK_CAR, CORTA);
  assert.equal(cache.simulaciones, 1);
  assert.deepEqual(r, simulateCar(STOCK_CAR, CORTA));
});

test("cache: la misma entrada otra vez no vuelve a simular", () => {
  const cache = new CacheResultados();
  const a = cache.simular(STOCK_CAR, CORTA);
  const b = cache.simular(STOCK_CAR, CORTA);
  assert.equal(cache.simulaciones, 1);
  assert.deepEqual(a, b);
});

test("cache: la clave es el contenido del genoma, no el objeto", () => {
  const cache = new CacheResultados();
  cache.simular(STOCK_CAR, CORTA);
  // Una copia profunda con el mismo contenido tiene el mismo hash.
  cache.simular(normalizeGenome(structuredClone(STOCK_CAR)), CORTA);
  assert.equal(cache.simulaciones, 1);
});

test("cache: otra pista es otra entrada", () => {
  const cache = new CacheResultados();
  const a = cache.simular(STOCK_CAR, CORTA);
  const b = cache.simular(STOCK_CAR, OTRA);
  assert.equal(cache.simulaciones, 2);
  assert.equal(a.trackId, CORTA);
  assert.equal(b.trackId, OTRA);
  cache.simular(STOCK_CAR, OTRA);
  assert.equal(cache.simulaciones, 2);
});

test("cache: cada llamada devuelve una copia; tocarla no cambia lo guardado", () => {
  const cache = new CacheResultados();
  const a = cache.simular(STOCK_CAR, CORTA);
  const distancia = a.distance;
  a.distance = -1;
  a.carId = "tocado";
  const b = cache.simular(STOCK_CAR, CORTA);
  assert.notEqual(a, b);
  assert.equal(b.distance, distancia);
  assert.notEqual(b.carId, "tocado");
  assert.equal(cache.simulaciones, 1);
});

test("cache: dos caches no comparten resultados", () => {
  const una = new CacheResultados();
  const otra = new CacheResultados();
  una.simular(STOCK_CAR, CORTA);
  otra.simular(STOCK_CAR, CORTA);
  assert.equal(una.simulaciones, 1);
  assert.equal(otra.simulaciones, 1);
});
