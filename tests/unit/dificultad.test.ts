import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { LARGO_RESPIRO, PERIODO_RESPIRO, curvaDificultad, enRespiro } from "../../src/sim/dificultad";
import { FLAT_START, MAX_SLOPE_DEG, VERTEX_SPACING } from "../../src/sim/terrain";
import { TRACKS, getTrack, type TrackId } from "../../src/sim/tracks";
import { STOCK_CAR, genomeHash } from "../../src/sim/genome";
import { createRace, simulateCar } from "../../src/sim/race";
import { seededGenomes } from "./helpers/rng";

const h = (id: TrackId) => {
  const t = getTrack(id);
  assert.ok(t);
  return t.heightAt;
};

function muestrear(f: (x: number) => number, a: number, b: number, paso = 0.1) {
  let min = Infinity;
  let max = -Infinity;
  let maxAbs = 0;
  let pendiente = 0;
  for (let x = a; x <= b; x += paso) {
    const y = f(x);
    min = Math.min(min, y);
    max = Math.max(max, y);
    maxAbs = Math.max(maxAbs, Math.abs(y));
    pendiente = Math.max(pendiente, (Math.atan(Math.abs(f(x + VERTEX_SPACING) - y) / VERTEX_SPACING) * 180) / Math.PI);
  }
  return { min, max, maxAbs, pendiente };
}

// Altura de la mayor piedra: el rango dentro de cada celda de 4 m.
function piedraMayor(f: (x: number) => number, a: number, b: number): number {
  let m = 0;
  for (let c = a; c < b; c += 4) {
    const r = muestrear(f, c, c + 4);
    m = Math.max(m, r.max - r.min);
  }
  return m;
}

test("dif-1 a los 100 m las cuatro clásicas ya complican y los techos no suben; versiones 4, 3, 3, 3", () => {
  const a = FLAT_START + 90;
  const b = FLAT_START + 110;
  assert.ok(muestrear(h("cordillera"), a, b).maxAbs >= 3, "cordillera");
  assert.ok(muestrear(h("rampa"), a, b).pendiente >= 20, "rampa");
  assert.ok(muestrear(h("dunas"), a, b).maxAbs >= 3, "dunas");
  assert.ok(piedraMayor(h("pedregal"), a, b) >= 0.45, "pedregal");

  assert.ok(muestrear(h("cordillera"), 3000, 4000).maxAbs <= 14);
  assert.ok(muestrear(h("rampa"), 3000, 4000).pendiente <= 60);
  assert.ok(muestrear(h("dunas"), 3000, 4000).maxAbs <= 7);
  assert.ok(piedraMayor(h("pedregal"), 3000, 4000) <= 0.9);

  assert.deepEqual(
    TRACKS.filter((t) => ["cordillera", "rampa", "dunas", "pedregal"].includes(t.id)).map((t) => t.version),
    [4, 3, 3, 3],
  );
});

test("dif-1 límites: x = FLAT_START y x negativo dan 0", () => {
  for (const id of ["cordillera", "rampa", "dunas", "pedregal"] as const) {
    assert.equal(h(id)(FLAT_START), 0);
    assert.equal(h(id)(-5), 0);
  }
  assert.equal(curvaDificultad(0), 0);
  assert.equal(curvaDificultad(-3), 0);
});

test("curva: cóncava, ≈50 % a 120 m y ≈80 % a 450 m", () => {
  assert.ok(Math.abs(curvaDificultad(120) - 0.5) < 0.03, String(curvaDificultad(120)));
  assert.ok(Math.abs(curvaDificultad(450) - 0.8) < 0.03, String(curvaDificultad(450)));
  assert.ok(curvaDificultad(120) > 120 / 450 * curvaDificultad(450), "cóncava");
});

test("invariante: curvaDificultad ∈ [0,1], 0 para d ≤ 0 y no decreciente fuera de respiros", () => {
  fc.assert(
    fc.property(fc.double({ min: -100, max: 20000, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (d, dd) => {
      const c = curvaDificultad(d);
      assert.ok(c >= 0 && c <= 1);
      if (d <= 0) assert.equal(c, 0);
      else if (!enRespiro(d) && !enRespiro(d + dd)) {
        // Entre dos respiros distintos la curva solo puede haber subido.
        assert.ok(curvaDificultad(d + dd) >= c - 1e-12);
      }
    }),
    { numRuns: 500 },
  );
});

test("invariante: tras un respiro recupera el pico en menos de 50 m", () => {
  assert.ok(LARGO_RESPIRO < 50);
  for (let k = 1; k < 20; k++) {
    const inicio = k * PERIODO_RESPIRO;
    const pico = curvaDificultad(inicio - 1e-6);
    assert.ok(curvaDificultad(inicio + 25) < pico, `el respiro ${k} baja`);
    assert.ok(curvaDificultad(inicio + 49.9) >= pico, `el respiro ${k} se recupera`);
  }
});

test("invariantes de las clásicas: heightAt pura, llana en la salida, pendiente ≤ 70°", () => {
  const tope = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180) * VERTEX_SPACING;
  fc.assert(
    fc.property(fc.double({ min: -50, max: 6000, noNaN: true }), (x) => {
      for (const id of ["cordillera", "rampa", "dunas", "pedregal"] as const) {
        const f = h(id);
        const y = f(x);
        f(x + 17);
        assert.equal(f(x), y);
        if (x <= FLAT_START) assert.equal(y, 0);
        assert.ok(Math.abs(f(x + VERTEX_SPACING) - y) <= tope + 1e-9, `${id} en ${x}`);
      }
    }),
    { numRuns: 400 },
  );
});

test("dif-5 determinismo: 20 genomas dan el mismo resultado dos veces en cada clásica", () => {
  const genomas = seededGenomes(5151, 20);
  for (const id of ["cordillera", "rampa", "dunas", "pedregal"] as const) {
    const carreras = [0, 1].map(() => {
      const race = createRace(genomas.map((g) => ({ carId: genomeHash(g), genome: g })), id, { maxSteps: 900 });
      while (!race.done()) race.step(60);
      const r = race.results();
      race.dispose();
      return r;
    });
    assert.deepEqual(carreras[0], carreras[1], id);
  }
});

test("dif-6 el coche de serie recorre al menos 20 m en cada clásica", () => {
  for (const id of ["cordillera", "rampa", "dunas", "pedregal"] as const) {
    const r = simulateCar(STOCK_CAR, id);
    assert.ok(r.distance >= 20, `${id}: ${r.distance} m`);
  }
});
