import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DISTANCIA_TOPE, LARGO_RESPIRO, PERIODO_KM, PERIODO_RESPIRO, PISTAS_ENDURECIDAS, curvaDificultad, enRespiro } from "../../src/sim/dificultad";
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

test("dif-1 a los 100 m las cuatro clásicas ya complican (algo menos que antes) y los techos no suben; versiones 5, 4, 4, 4", () => {
  const a = FLAT_START + 90;
  const b = FLAT_START + 110;
  assert.ok(muestrear(h("cordillera"), a, b).maxAbs >= 1.5, "cordillera");
  assert.ok(muestrear(h("rampa"), a, b).pendiente >= 10, "rampa");
  assert.ok(muestrear(h("dunas"), a, b).maxAbs >= 1.5, "dunas");
  assert.ok(piedraMayor(h("pedregal"), a, b) >= 0.3, "pedregal");

  assert.ok(muestrear(h("cordillera"), 3000, 4000).maxAbs <= 26);
  assert.ok(muestrear(h("rampa"), 3000, 4000).pendiente <= 60);
  assert.ok(muestrear(h("dunas"), 3000, 4000).maxAbs <= 9);
  assert.ok(piedraMayor(h("pedregal"), 3000, 4000) <= 1.3);

  assert.deepEqual(
    TRACKS.filter((t) => ["cordillera", "rampa", "dunas", "pedregal"].includes(t.id)).map((t) => t.version),
    [5, 4, 4, 4],
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

test("curva: rampa temprana cóncava, ≈ 0,23 a 120 m y exactamente 1 en la meta", () => {
  assert.ok(Math.abs(curvaDificultad(120) - 0.23) < 0.03, String(curvaDificultad(120)));
  assert.ok(curvaDificultad(120) > (120 / 450) * curvaDificultad(450), "cóncava al principio");
  assert.equal(curvaDificultad(DISTANCIA_TOPE), 1);
  assert.equal(curvaDificultad(DISTANCIA_TOPE + 700), 1);
  assert.equal(curvaDificultad(Number.NaN), 0);
});

test("pd-1 invariante: el pico de cada kilómetro supera en ≥ 0,08 al del anterior y el último llega a 1", () => {
  const pico = (k: number) => {
    let m = 0;
    for (let d = k * 1000; d < (k + 1) * 1000; d += 0.5) m = Math.max(m, curvaDificultad(d));
    return m;
  };
  for (let k = 1; k <= 4; k++) assert.ok(pico(k) - pico(k - 1) >= 0.08, `km ${k + 1}: ${pico(k)} frente a ${pico(k - 1)}`);
  assert.ok(pico(4) > 0.999);
});

test("pd-1: PISTAS_ENDURECIDAS son las nueve que no son La Recta", () => {
  assert.equal(PISTAS_ENDURECIDAS.length, 9);
  assert.deepEqual(TRACKS.map((t) => t.id).filter((id) => !(PISTAS_ENDURECIDAS as readonly string[]).includes(id)), ["recta"]);
  assert.equal(getTrack("recta")!.version, 1);
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
  // Los respiros de cada kilómetro son más largos (LARGO_RESPIRO_KM) y tienen su propio criterio abajo.
  for (let k = 1; k < 19; k++) {
    const inicio = k * PERIODO_RESPIRO;
    if (inicio % PERIODO_KM === 0) continue;
    const pico = curvaDificultad(inicio - 1e-6);
    assert.ok(curvaDificultad(inicio + 25) < pico, `el respiro ${k} baja`);
    assert.ok(curvaDificultad(inicio + 49.9) >= pico, `el respiro ${k} se recupera`);
  }
});

test("pd-1: tras el respiro de cada kilómetro la curva recupera el pico en menos de 150 m", () => {
  for (let k = 1; k <= 4; k++) {
    const pico = curvaDificultad(k * PERIODO_KM - 1e-6);
    assert.ok(curvaDificultad(k * PERIODO_KM + 50) < pico, `el respiro del km ${k} baja`);
    assert.ok(curvaDificultad(k * PERIODO_KM + 150) >= pico, `el respiro del km ${k} se recupera`);
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

test("pd-2: el fixture de campeones trae ≥ 40 genomas, ≥ 4 por pista endurecida, todos válidos y distintos", async () => {
  const { CAMPEONES_5K } = await import("../../tests/fixtures/campeones-5k");
  const { normalizeGenome } = await import("../../src/sim/genome");
  let total = 0;
  const hashes = new Set<string>();
  for (const id of PISTAS_ENDURECIDAS) {
    const gs = CAMPEONES_5K[id] ?? [];
    assert.ok(gs.length >= 4, `${id}: ${gs.length}`);
    for (const g of gs) {
      assert.deepEqual(normalizeGenome(g), g, `${id}: genoma sin normalizar`);
      hashes.add(`${id}:${genomeHash(g)}`);
    }
    total += gs.length;
  }
  assert.ok(total >= 40);
  assert.equal(hashes.size, total);
});
