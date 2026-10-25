import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { createRace, simulateCar } from "../../src/sim/race";
import { STOCK_CAR, randomGenome } from "../../src/sim/genome";
import { seededRand } from "./helpers/rng";
import { ESCALON_MAX, ESCALON_MIN, ESCALERA_HUELLA, HIELO, ROCA, TRACKS, getTrack } from "../../src/sim/tracks";
import { FLAT_START, MAX_SLOPE_DEG, VERTEX_SPACING } from "../../src/sim/terrain";

const CLASICAS = ["cordillera", "rampa", "dunas", "pedregal"] as const;
const NUEVAS = ["glaciar", "trampolines", "escalera", "acantilado", "recta"] as const;
const SLOPE_RAD = (MAX_SLOPE_DEG * Math.PI) / 180;

test("invariante pn-2: surfaceOfSegment es pura y queda en friction [0,02, 1] y restitution [0, 0,85]", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), (i, j) => {
      for (const t of TRACKS) {
        const a = t.surfaceOfSegment(i);
        t.surfaceOfSegment(j);
        assert.deepEqual(t.surfaceOfSegment(i), a);
        assert.ok(a.friction >= 0.02 && a.friction <= 1, `${t.id} friction ${a.friction}`);
        assert.ok(a.restitution >= 0 && a.restitution <= 0.85, `${t.id} restitution ${a.restitution}`);
      }
    }),
    { numRuns: 300 },
  );
});

test("invariante pn-2: las clásicas devuelven ROCA", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5000 }), (i) => {
      for (const id of CLASICAS) assert.equal(getTrack(id)!.surfaceOfSegment(i), ROCA);
    }),
  );
});

test("pn-2: El Glaciar es hielo (0,05) y Los Trampolines rebotan entre 0,5 y 0,85", () => {
  assert.deepEqual(getTrack("glaciar")!.surfaceOfSegment(7), HIELO);
  assert.equal(HIELO.friction, 0.05);
  const rebotes = Array.from({ length: 400 }, (_, i) => getTrack("trampolines")!.surfaceOfSegment(i).restitution);
  assert.ok(Math.min(...rebotes) >= 0.5 && Math.max(...rebotes) <= 0.85);
  assert.ok(new Set(rebotes).size > 50, "cada tramo tiene su rebote");
});

test("invariante pn-1: en La Escalera cada escalón mide 0,2-1,3 m y la contrahuella no pasa de 70°", () => {
  const t = getTrack("escalera")!;
  const escalones = Math.floor(4900 / ESCALERA_HUELLA);
  for (let n = 1; n < escalones; n++) {
    const x0 = FLAT_START + n * ESCALERA_HUELLA;
    // El salto ocupa el intervalo de un vértice y lleva encima la bajada media (≤ 0,053 m en ese intervalo).
    const rise = Math.abs(t.heightAt(x0 + VERTEX_SPACING) - t.heightAt(x0));
    assert.ok(rise >= ESCALON_MIN - 0.06 && rise <= ESCALON_MAX + 0.06, `escalón ${n}: ${rise}`);
    assert.ok(Math.atan2(rise, VERTEX_SPACING) <= SLOPE_RAD, `contrahuella ${n}`);
  }
});

test("invariante pn-1: las pistas nuevas son llanas en [0, FLAT_START], continuas y puras", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 5000, noNaN: true }), (x) => {
      for (const id of NUEVAS) {
        const t = getTrack(id)!;
        if (x <= FLAT_START) assert.equal(t.heightAt(x), 0);
        assert.equal(t.heightAt(x), t.heightAt(x));
        // Continua: en 1 mm no salta más de lo que permite la pendiente máxima.
        assert.ok(Math.abs(t.heightAt(x + 0.001) - t.heightAt(x)) <= Math.tan(SLOPE_RAD) * 0.001 + 1e-9);
      }
    }),
    { numRuns: 400 },
  );
});

function correr(friccion: number | undefined): number {
  const race = createRace([{ carId: "a", genome: STOCK_CAR }], "cordillera", { friccionSuelo: friccion, maxSteps: 1500 });
  while (!race.done()) race.step(60);
  const d = race.results()[0].distance;
  race.dispose();
  return d;
}

test("pn-2: el hielo patina: con la fricción del hielo el mismo coche llega menos lejos que en roca", () => {
  assert.ok(correr(HIELO.friction) < correr(undefined));
});

test("pn-2: Los Trampolines dan un CarResult distinto al de una roca de la misma forma y El Glaciar es determinista", () => {
  const sim = (id: "glaciar" | "trampolines") => {
    const race = createRace([{ carId: "a", genome: STOCK_CAR }], id, { maxSteps: 1200 });
    while (!race.done()) race.step(60);
    const r = race.results()[0];
    race.dispose();
    return r;
  };
  assert.deepEqual(sim("glaciar"), sim("glaciar"));
  const rebota = sim("trampolines");
  const race = createRace([{ carId: "a", genome: STOCK_CAR }], "trampolines", { maxSteps: 1200, friccionSuelo: 1 });
  while (!race.done()) race.step(60);
  assert.ok(race.results()[0].distance !== rebota.distance || race.results()[0].steps !== rebota.steps);
  race.dispose();
});

test("pn-2: 20 genomas en las clásicas dan 80 de 80 CarResult idénticos al dorado (regenerado al endurecer las pistas: las superficies de roca siguen sin cambiar nada)", () => {
  const dorado = JSON.parse(readFileSync("tests/fixtures/dorado-clasicas.json", "utf8")) as Record<string, unknown[]>;
  const rand = seededRand(2024);
  const genomas = Array.from({ length: 20 }, () => randomGenome(rand));
  let iguales = 0;
  for (const id of CLASICAS) {
    genomas.forEach((g, i) => {
      assert.deepEqual(simulateCar(g, id), dorado[id][i], `${id} #${i}`);
      iguales++;
    });
  }
  assert.equal(iguales, 80);
});
