import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { CAMPEONES_5K } from "../fixtures/campeones-5k";
import { resultadoFiel } from "../../src/app/repeticion";
import { STOCK_CAR, genomeHash, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { RaceEngine } from "../../src/worker/engine";
import type { FromWorker } from "../../src/worker/protocol";

function motor(fantasma?: Genome, pace: "x1" | "x8" = "x1", principal: Genome = STOCK_CAR) {
  const mensajes: FromWorker[] = [];
  const engine = new RaceEngine((m) => mensajes.push(m));
  const empezar = (trackId: TrackId) =>
    engine.handle({
      type: "startRace",
      raceId: "r1",
      cars: [{ carId: genomeHash(principal), genome: principal }],
      trackId,
      pace,
      ...(fantasma ? { fantasma: { carId: genomeHash(fantasma), genome: fantasma } } : {}),
    });
  const fin = () => mensajes.find((m): m is Extract<FromWorker, { type: "fantasmaFin" }> => m.type === "fantasmaFin");
  const hecho = () => mensajes.find((m): m is Extract<FromWorker, { type: "raceDone" }> => m.type === "raceDone");
  return { engine, mensajes, empezar, fin, hecho };
}

const campeon = (id: TrackId): Genome => (CAMPEONES_5K[id] ?? [])[0] ?? STOCK_CAR;

test("fa-7: el fantasma termina con exactamente el resultado de simular su genoma solo", () => {
  for (const t of TRACKS) {
    const g = campeon(t.id);
    // Mismo genoma delante y detrás: la repetición de un récord, que acaba a la vez que su fantasma.
    const { engine, empezar, fin } = motor(g, "x1", g);
    empezar(t.id);
    engine.handle({ type: "advance", raceId: "r1", seconds: 3000 });
    const esperado = simulateCar(g, t.id);
    assert.deepEqual(fin()?.result, esperado, t.id);
    assert.equal(resultadoFiel(fin()!.result, esperado), true);
  }
});

test("fa-5: el fantasma no altera el resultado, el progreso ni los finales de la carrera principal", () => {
  for (const t of TRACKS) {
    const con = motor(campeon(t.id), "x1", campeon(t.id));
    con.empezar(t.id);
    con.engine.handle({ type: "advance", raceId: "r1", seconds: 3000 });
    const sin = motor(undefined, "x1", campeon(t.id));
    sin.empezar(t.id);
    sin.engine.handle({ type: "advance", raceId: "r1", seconds: 3000 });
    assert.deepEqual(con.hecho()?.results, sin.hecho()?.results, t.id);
    const finales = (ms: FromWorker[]) => ms.filter((m) => m.type === "carFinished").length;
    assert.equal(finales(con.mensajes), finales(sin.mensajes));
    assert.equal(con.fin() !== undefined, true);
    assert.equal(sin.fin(), undefined);
  }
});

test("fa-4 (propiedad): con cualquier troceo y ritmo el fantasma avanza los mismos pasos que el coche", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...TRACKS.map((t) => t.id)),
      fc.constantFrom("x1" as const, "x8" as const),
      fc.array(fc.double({ min: 0.01, max: 20, noNaN: true }), { minLength: 1, maxLength: 5 }),
      (trackId, pace, trozos) => {
        const { engine, mensajes, empezar } = motor(STOCK_CAR, pace);
        empezar(trackId);
        for (const s of trozos) engine.handle({ type: "advance", raceId: "r1", seconds: s });
        for (const m of mensajes) {
          if (m.type !== "poses" || !m.fantasma) continue;
          // Mismo genoma, mismo suelo y mismos pasos: las dos poses son idénticas.
          assert.deepEqual(m.fantasma, { ...m.poses[0], carId: m.fantasma.carId });
        }
      },
    ),
    { numRuns: 6 },
  );
});

test("fantasmaFin se avisa una sola vez y la pose del fantasma no entra en poses", () => {
  const { engine, mensajes, empezar } = motor(STOCK_CAR);
  empezar("cordillera");
  engine.handle({ type: "advance", raceId: "r1", seconds: 3000 });
  assert.equal(mensajes.filter((m) => m.type === "fantasmaFin").length, 1);
  for (const m of mensajes) if (m.type === "poses") assert.equal(m.poses.length, 1);
});
