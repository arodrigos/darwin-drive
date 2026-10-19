import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { STOCK_CAR, genomeHash } from "../../src/sim/genome";
import { liveBodyCount, simulateCar, type CarResult } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { RaceEngine } from "../../src/worker/engine";
import type { FromWorker } from "../../src/worker/protocol";

const CAR_ID = genomeHash(STOCK_CAR);

function motor() {
  const mensajes: FromWorker[] = [];
  const engine = new RaceEngine((m) => mensajes.push(m));
  const empezar = (trackId: TrackId, raceId = "r1") =>
    engine.handle({ type: "startRace", raceId, cars: [{ carId: CAR_ID, genome: STOCK_CAR }], trackId, pace: "x1" });
  const hecho = () => mensajes.find((m): m is Extract<FromWorker, { type: "raceDone" }> => m.type === "raceDone");
  return { engine, mensajes, empezar, hecho };
}

test("pc-2: el resultado del ejecutor es el de simular el coche solo, sin importar cómo se troceen los pasos", () => {
  for (const track of TRACKS) {
    const { engine, empezar, hecho } = motor();
    empezar(track.id);
    engine.handle({ type: "advance", raceId: "r1", seconds: 500 });
    assert.deepEqual(hecho()?.results, [simulateCar(STOCK_CAR, track.id)], track.id);
  }
});

test("pc-2 (propiedad): cualquier troceo en segundos da exactamente el mismo CarResult", () => {
  const referencia = new Map<TrackId, CarResult>(TRACKS.map((t) => [t.id, simulateCar(STOCK_CAR, t.id)]));
  fc.assert(
    fc.property(
      fc.constantFrom(...TRACKS.map((t) => t.id)),
      fc.array(fc.double({ min: 0.01, max: 40, noNaN: true }), { minLength: 1, maxLength: 6 }),
      (trackId, trozos) => {
        const { engine, empezar, hecho } = motor();
        empezar(trackId);
        for (const s of trozos) engine.handle({ type: "advance", raceId: "r1", seconds: s });
        engine.handle({ type: "advance", raceId: "r1", seconds: 500 });
        assert.deepEqual(hecho()?.results[0], referencia.get(trackId));
      },
    ),
    { numRuns: 6 },
  );
});

test("pc-1: carFinished y raceDone llevan el mismo CarResult, con la pista de la carrera", () => {
  const { engine, mensajes, empezar } = motor();
  empezar("rampa");
  engine.handle({ type: "advance", raceId: "r1", seconds: 500 });
  const fin = mensajes.find((m) => m.type === "carFinished");
  const hecho = mensajes.find((m) => m.type === "raceDone");
  assert.ok(fin?.type === "carFinished" && hecho?.type === "raceDone");
  assert.deepEqual(hecho.results, [fin.result]);
  assert.equal(fin.result.trackId, "rampa");
  const ultimas = mensajes.filter((m) => m.type === "poses").at(-1);
  assert.ok(ultimas?.type === "poses" && ultimas.poses[0].finished);
});

test("la carrera libera sus cuerpos de Planck al terminar y al parar", () => {
  const base = liveBodyCount();
  const a = motor();
  a.empezar("cordillera");
  assert.ok(liveBodyCount() > base);
  a.engine.handle({ type: "advance", raceId: "r1", seconds: 500 });
  assert.equal(liveBodyCount(), base);
  const b = motor();
  b.empezar("cordillera");
  b.engine.handle({ type: "stop", raceId: "r1" });
  assert.equal(liveBodyCount(), base);
});

test("pc-6: en pausa el reloj no avanza la carrera y al reanudar sigue donde estaba", () => {
  const { engine, mensajes, empezar } = motor();
  empezar("cordillera");
  engine.handle({ type: "pause", raceId: "r1" });
  assert.equal(engine.active(), false);
  const antes = mensajes.length;
  engine.tick(8);
  assert.equal(mensajes.length, antes);
  engine.handle({ type: "advance", raceId: "r1", seconds: 1 });
  const t = mensajes.filter((m) => m.type === "poses").at(-1);
  assert.ok(t?.type === "poses" && Math.abs(t.simTime - 1) < 1e-9);
  engine.handle({ type: "resume", raceId: "r1" });
  assert.equal(engine.active(), true);
});

test("pc-7: una pista desconocida se notifica como error del ejecutor, no se queda callado", () => {
  const { mensajes, empezar } = motor();
  empezar("__fallo__" as TrackId);
  const e = mensajes.find((m) => m.type === "error");
  assert.ok(e?.type === "error" && e.raceId === "r1" && e.message.length > 0);
});

test("los mensajes de otra carrera se ignoran", () => {
  const { engine, mensajes, empezar } = motor();
  empezar("cordillera");
  const antes = mensajes.length;
  engine.handle({ type: "advance", raceId: "otra", seconds: 5 });
  assert.equal(mensajes.length, antes);
});
