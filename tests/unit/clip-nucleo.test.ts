import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import type { Genome } from "../../src/sim/genome";
import { getTrack } from "../../src/sim/tracks";
import { simulateCar } from "../../src/sim/race";
import { MAX_STEPS } from "../../src/sim/constants";
import { FPS, MAX_DURACION_S, MOTIVO_NO_COINCIDE, fotogramas, planClip, verificar, type EntradaClip } from "../../src/clip/nucleo";

const FIXTURE: { trackId: "dunas"; campeon: Genome }[] = JSON.parse(readFileSync("tests/fixtures/medallas-calibracion.json", "utf8"));
const dunas = FIXTURE.find((f) => f.trackId === "dunas")!;

function entradaReal(): EntradaClip {
  // La marca guardada es lo que da la propia simulación.
  const distancia = simulateCar(dunas.campeon, "dunas").distance;
  return { genome: dunas.campeon, trackId: "dunas", trackVersion: getTrack("dunas")!.version, nombre: "Prueba", color: "#E69F00", distancia };
}

test("clip-1 invariante: duración ≤ 20 s, fotogramas = round(duración·30) y paso 1/30 con cualquier carrera", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: MAX_STEPS }), (pasos) => {
      const p = planClip(pasos);
      assert.ok(p.duracionS >= 1 && p.duracionS <= MAX_DURACION_S);
      assert.equal(p.fotogramas, Math.round(p.duracionS * FPS));
      assert.ok(Number.isInteger(p.factor) && p.factor >= 1);
      // El factor es el mínimo entero que cabe en 20 s.
      assert.ok(pasos / 60 / p.factor <= MAX_DURACION_S + 1e-9);
    }),
  );
});

test("clip-1 límite: una carrera de menos de 1 s da un clip de 1 s con factor 1", () => {
  const p = planClip(30);
  assert.deepEqual([p.factor, p.duracionS, p.fotogramas], [1, 1, 30]);
});

test("clip-4 una carrera de 15 min simulados se acelera ceil(900/20) = 45 veces y cabe en 20 s", () => {
  const p = planClip(MAX_STEPS);
  assert.equal(p.factor, 45);
  assert.equal(p.duracionS, 20);
  assert.equal(p.fotogramas, 600);
});

test("clip-1/clip-2 fotogramas con marcas crecientes y paso 1/30, y la distancia final es la de la marca; es repetible", () => {
  const entrada = entradaReal();
  const { resultado, plan } = verificar(entrada);
  const corrida = () => [...fotogramas(entrada, plan, resultado)];
  const a = corrida();
  assert.equal(a.length, plan.fotogramas);
  for (let i = 1; i < a.length; i++) assert.ok(Math.abs(a[i].ts - a[i - 1].ts - 1 / FPS) < 1e-12 && a[i].ts > a[i - 1].ts);
  assert.equal(a.at(-1)!.distancia, entrada.distancia);
  assert.ok(a.every((f, i) => i === 0 || f.distancia >= a[i - 1].distancia));
  const b = corrida();
  assert.equal(b.length, a.length);
  assert.equal(b.at(-1)!.distancia, a.at(-1)!.distancia);
  assert.deepEqual(b[Math.floor(b.length / 2)].pose, a[Math.floor(a.length / 2)].pose);
});

test("clip-2 una marca manipulada (+1 m) se rechaza y no entrega nada", () => {
  const entrada = entradaReal();
  assert.throws(() => verificar({ ...entrada, distancia: entrada.distancia + 1 }), { message: MOTIVO_NO_COINCIDE });
});
