import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { actualizarAviso, ESPERA_AVISO_MS, SIN_AVISO } from "../../src/app/ritmo";
import { DT, simulateCar, type CarResult } from "../../src/sim/race";
import { genomeHash, STOCK_CAR, type Genome } from "../../src/sim/genome";
import type { TrackId } from "../../src/sim/tracks";
import { BUDGET_MS, RaceEngine } from "../../src/worker/engine";
import { MULTIPLIER, type FromWorker, type Pace } from "../../src/worker/protocol";
import { seededGenomes } from "./helpers/rng";

const PACES: Pace[] = ["x1", "x2", "x4", "x8", "turbo"];

/** Reloj falso: cada lectura cuesta `coste` ms, así el coste de un paso es determinista. */
function reloj(coste: number) {
  const r = { t: 1000, coste, ahora: () => ((r.t += r.coste), r.t - r.coste) };
  return r;
}

function motor(g: Genome, trackId: TrackId, coste = 0.5) {
  const mensajes: FromWorker[] = [];
  const clock = reloj(coste);
  const engine = new RaceEngine((m) => mensajes.push(m), clock.ahora);
  engine.handle({ type: "startRace", raceId: "r", cars: [{ carId: genomeHash(g), genome: g }], trackId, pace: "x1" });
  const tick = () => {
    clock.t += 16;
    engine.tick(BUDGET_MS);
  };
  const resultado = () => mensajes.find((m): m is Extract<FromWorker, { type: "raceDone" }> => m.type === "raceDone")?.results[0];
  return { engine, mensajes, clock, tick, resultado };
}

const referencia = new Map<string, CarResult>();
const ref = (g: Genome, t: TrackId) => {
  const k = `${genomeHash(g)}:${t}`;
  if (!referencia.has(k)) referencia.set(k, simulateCar(g, t));
  return referencia.get(k)!;
};

test("rit-2 (propiedad): cualquier secuencia de ritmos, pausas, topes y reloj lento da el CarResult de ×1", () => {
  const genomas = [STOCK_CAR, ...seededGenomes(7, 2)];
  const accion = fc.oneof(
    fc.record({ k: fc.constant("pace" as const), p: fc.constantFrom(...PACES) }),
    fc.record({ k: fc.constant("pausa" as const) }),
    fc.record({ k: fc.constant("tope" as const), n: fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }) }),
    fc.record({ k: fc.constant("ticks" as const), n: fc.integer({ min: 1, max: 30 }) }),
  );
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: genomas.length - 1 }),
      fc.constantFrom<TrackId>("cordillera", "rampa"),
      fc.array(accion, { maxLength: 12 }),
      fc.constantFrom(0.25, 1, 4),
      (gi, trackId, acciones, coste) => {
        const g = genomas[gi];
        const { engine, tick, resultado } = motor(g, trackId, coste);
        let pausada = false;
        for (const a of acciones) {
          if (a.k === "pace") engine.handle({ type: "setPace", raceId: "r", pace: a.p });
          else if (a.k === "pausa") {
            pausada = !pausada;
            engine.handle({ type: pausada ? "pause" : "resume", raceId: "r" });
          } else if (a.k === "tope") engine.handle({ type: "limitRate", max: a.n });
          else for (let i = 0; i < a.n; i++) tick();
        }
        engine.handle({ type: "limitRate", max: null });
        engine.handle({ type: "resume", raceId: "r" });
        engine.handle({ type: "setPace", raceId: "r", pace: "turbo" });
        for (let i = 0; i < 200_000 && !resultado(); i++) tick();
        assert.deepEqual(resultado(), ref(g, trackId));
      },
    ),
    { numRuns: 6 },
  );
});

test("rit-2: empezar en turbo y acabar en ×8, y cada paso a 1 ms (×8 no llega), no cambia la marca", () => {
  const a = motor(STOCK_CAR, "rampa", 1);
  a.engine.handle({ type: "setPace", raceId: "r", pace: "turbo" });
  for (let i = 0; i < 20; i++) a.tick();
  a.engine.handle({ type: "setPace", raceId: "r", pace: "x8" });
  for (let i = 0; i < 200_000 && !a.resultado(); i++) a.tick();
  assert.deepEqual(a.resultado(), ref(STOCK_CAR, "rampa"));
});

test("rit-11 (propiedad): con cualquier coste por paso, un tick no pasa de 8 ms más un paso y la deuda no pasa de un tick", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.05, max: 6, noNaN: true }),
      fc.constantFrom<Pace>("x1", "x2", "x4", "x8"),
      fc.integer({ min: 1, max: 40 }),
      (coste, pace, ticks) => {
        const { engine, tick, mensajes } = motor(STOCK_CAR, "cordillera", coste);
        engine.handle({ type: "setPace", raceId: "r", pace });
        const privado = engine as unknown as { owedSteps: number; race: { simTime(): number } | null };
        let antes = 0;
        for (let i = 0; i < ticks && privado.race; i++) {
          tick();
          const ahora = privado.race?.simTime() ?? antes;
          const pasos = Math.round((ahora - antes) / DT);
          // Cada iteración lee el reloj una vez: a `coste` ms por lectura caben budget/coste + 1 pasos.
          assert.ok(pasos <= Math.floor(BUDGET_MS / coste) + 1, `${pasos} pasos con coste ${coste}`);
          const tope = (16 / 1000) * (1 / DT) * MULTIPLIER[pace === "turbo" ? "x8" : pace];
          assert.ok(privado.owedSteps <= tope + 1e-9, `deuda ${privado.owedSteps} > ${tope}`);
          antes = ahora;
        }
        assert.ok(mensajes.length > 0);
      },
    ),
    { numRuns: 60 },
  );
});

test("rit-11: con el tope de 5 y ×8 el motor informa un ritmo real de ≈5, y sin tope vuelve a 8", () => {
  const { engine, tick, mensajes } = motor(STOCK_CAR, "cordillera", 0.01);
  engine.handle({ type: "setPace", raceId: "r", pace: "x8" });
  engine.handle({ type: "limitRate", max: 5 });
  for (let i = 0; i < 90; i++) tick();
  const real = (mensajes.filter((m) => m.type === "poses").at(-1) as Extract<FromWorker, { type: "poses" }>).ritmoReal;
  assert.ok(real !== undefined && Math.abs(real - 5) < 0.6, `ritmoReal ${real}`);
  engine.handle({ type: "limitRate", max: null });
  for (let i = 0; i < 90; i++) tick();
  const libre = (mensajes.filter((m) => m.type === "poses").at(-1) as Extract<FromWorker, { type: "poses" }>).ritmoReal;
  assert.ok(libre !== undefined && Math.abs(libre - 8) < 1, `ritmoReal ${libre}`);
});

test("rit-13: al reanudar la deuda empieza a cero: una pausa larga no se recupera de golpe", () => {
  const { engine, tick } = motor(STOCK_CAR, "cordillera", 0.01);
  engine.handle({ type: "setPace", raceId: "r", pace: "x8" });
  for (let i = 0; i < 10; i++) tick();
  engine.handle({ type: "pause", raceId: "r" });
  engine.handle({ type: "resume", raceId: "r" });
  const privado = engine as unknown as { owedSteps: number };
  assert.equal(privado.owedSteps, 0);
});

test("rit-11: el aviso «real ×N» sale tras 2 s seguidos por debajo del 90 % y se va en cuanto se recupera", () => {
  let a = actualizarAviso(SIN_AVISO, "x8", 5.2, 0);
  assert.equal(a.rotulo, null);
  a = actualizarAviso(a, "x8", 4.9, ESPERA_AVISO_MS - 1);
  assert.equal(a.rotulo, null);
  a = actualizarAviso(a, "x8", 5.1, ESPERA_AVISO_MS);
  assert.equal(a.rotulo, 5);
  a = actualizarAviso(a, "x8", 7.3, ESPERA_AVISO_MS + 100);
  assert.deepEqual(a, SIN_AVISO);
  // Un tropiezo suelto reinicia la cuenta.
  a = actualizarAviso(SIN_AVISO, "x4", 1, 0);
  a = actualizarAviso(a, "x4", 4, 1500);
  a = actualizarAviso(a, "x4", 1, 2500);
  assert.equal(a.rotulo, null);
  assert.deepEqual(actualizarAviso({ desde: 0, rotulo: 3 }, "turbo", 1, 9000), SIN_AVISO);
});
