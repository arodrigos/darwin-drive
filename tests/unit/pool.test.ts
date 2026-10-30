import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createInlineRunner } from "../../src/worker/inline";
import { crearPoolRunner, tamPool } from "../../src/worker/pool";
import type { FromWorker, SimRunner, ToWorker } from "../../src/worker/protocol";
import type { CarResult } from "../../src/sim/constants";
import type { TrackId } from "../../src/sim/tracks";
import { seededGenomes } from "./helpers/rng";

/** Corre una carrera turbo hasta raceDone (o error) y devuelve todo lo emitido. */
function correr(runner: SimRunner, cars: { carId: string; genome: ReturnType<typeof seededGenomes>[number] }[], trackId: TrackId) {
  return new Promise<{ msgs: FromWorker[]; results: CarResult[] | null }>((resolve) => {
    const msgs: FromWorker[] = [];
    runner.subscribe((m) => {
      msgs.push(m);
      if (m.type === "raceDone") resolve({ msgs, results: m.results });
      if (m.type === "error") resolve({ msgs, results: null });
    });
    runner.post({ type: "startRace", raceId: "r", cars, trackId, pace: "turbo" });
  });
}

const coches = (seed: number, n: number) => seededGenomes(seed, n).map((genome, i) => ({ carId: `c${i}`, genome }));

test("pool-1-a: 1 y 4 runners dan los mismos resultados y en el mismo orden", async () => {
  const cars = coches(7, 30);
  const uno = createInlineRunner();
  const cuatro = crearPoolRunner(createInlineRunner, 4);
  const a = await correr(uno, cars, "dunas");
  const b = await correr(cuatro, cars, "dunas");
  uno.terminate();
  cuatro.terminate();
  assert.ok(a.results && b.results);
  assert.deepEqual(b.results, a.results);
});

test("pool-1: para cualquier población y N, mismos resultados y carFinished sin repetidos", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 1000 }), async (n, runners, seed) => {
      // maxSteps no se puede pasar por el protocolo: pocos coches por caso mantienen el coste en segundos.
      const cars = coches(seed, Math.min(n, 6));
      const ref = createInlineRunner();
      const pool = crearPoolRunner(createInlineRunner, runners);
      const a = await correr(ref, cars, "rampa");
      const b = await correr(pool, cars, "rampa");
      ref.terminate();
      pool.terminate();
      assert.deepEqual(b.results, a.results);
      const ids = b.msgs.flatMap((m) => (m.type === "carFinished" ? [m.result.carId] : []));
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual([...ids].sort(), cars.map((c) => c.carId).sort());
    }),
    { numRuns: 5 },
  );
});

test("pool-2: tamPool", () => {
  assert.equal(tamPool(undefined, 30), 1);
  assert.equal(tamPool(1, 30), 1);
  assert.equal(tamPool(4, 30), 3);
  assert.equal(tamPool(8, 30), 4);
  assert.equal(tamPool(16, 30), 4);
  assert.equal(tamPool(16, 5), 1);
  assert.equal(tamPool(16, 30, 2), 2);
  assert.equal(tamPool(undefined, 5, 2), 2);
  fc.assert(
    fc.property(fc.option(fc.integer({ min: 0, max: 64 }), { nil: undefined }), fc.integer({ min: 0, max: 100 }), (hc, n) => {
      const t = tamPool(hc, n);
      return t >= 1 && t <= 4 && (n >= 8 || t === 1);
    }),
  );
});

/** Subrunner falso: no simula, solo registra y emite lo que se le diga. */
function falso(alPostear: (m: ToWorker, emitir: (r: FromWorker) => void) => void) {
  const l = new Set<(m: FromWorker) => void>();
  const posts: ToWorker[] = [];
  let terminado = false;
  const r: SimRunner = {
    kind: "en-linea",
    post: (m) => {
      posts.push(m);
      alPostear(m, (x) => l.forEach((f) => f(x)));
    },
    subscribe: (f) => (l.add(f), () => l.delete(f)),
    terminate: () => void (terminado = true),
  };
  return { r, posts, terminado: () => terminado };
}

test("pool-3: un subrunner que falla da un único error y ningún raceDone", () => {
  let i = 0;
  const falsos = [0, 1, 2].map((k) =>
    falso((m, emitir) => {
      if (m.type !== "startRace") return;
      if (k === 1) emitir({ type: "error", raceId: m.raceId, message: "boom" });
      else emitir({ type: "raceDone", raceId: m.raceId, results: [] });
    }),
  );
  const pool = crearPoolRunner(() => falsos[i++].r, 3);
  const vistos: FromWorker[] = [];
  pool.subscribe((m) => vistos.push(m));
  pool.post({ type: "startRace", raceId: "x", cars: coches(1, 6), trackId: "rampa", pace: "turbo" });
  falsos[1].r.subscribe(() => {});
  assert.deepEqual(vistos.filter((m) => m.type === "error").length, 1);
  assert.equal(vistos.filter((m) => m.type === "raceDone").length, 0);
  assert.ok(falsos.every((f) => f.posts.some((p) => p.type === "stop")));
  pool.terminate();
  assert.ok(falsos.every((f) => f.terminado()));
});
