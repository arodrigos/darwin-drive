import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { STOCK_CAR, genomeHash } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { TRACKS, type TrackId } from "../../src/sim/tracks";
import { RANKING_SIZE, validateRankings } from "../../src/storage/schema";
import { medirEnTodasLasPistas } from "../../src/app/medir-pistas";
import { resumenMedicion } from "../../src/app/ranking-text";
import { nombreDe, textoVacio, tonoDe } from "../../src/app/components/Rankings";
import { createInlineRunner } from "../../src/worker/inline";
import { DEMO_CARS, DEMO_ORIGINS, demoDate, demoGenomes } from "./helpers/demo-rankings";
import { seededGenomes } from "./helpers/rng";

// El escenario demo trae las cuatro claves clásicas, como una partida guardada antes de las pistas nuevas.
const CLASICAS = TRACKS.filter((t) => ["cordillera", "rampa", "dunas", "pedregal"].includes(t.id));

const DEMO = JSON.parse(readFileSync(new URL("../../src/debug/escenarios/rankings-demo.json", import.meta.url), "utf8"));

test("rk-1: el escenario demo es válido, con 10 marcas por pista y clasificaciones distintas entre pistas", () => {
  const validos = validateRankings(DEMO);
  assert.ok(validos, "el JSON pasa el validador del guardado");
  for (const t of CLASICAS) {
    assert.equal(validos[t.id].length, RANKING_SIZE, t.id);
    const d: number[] = validos[t.id].map((e) => e.distance);
    assert.deepEqual(d, [...d].sort((a, b) => b - a), `${t.id} de mayor a menor`);
    assert.ok(validos[t.id].every((e) => e.trackId === t.id && e.trackVersion === t.version && e.physicsVersion === PHYSICS_VERSION));
  }
  const orden = (id: TrackId) => validos[id].map((e) => e.carId).join();
  assert.notEqual(orden("rampa"), orden("dunas"));
  assert.notEqual(orden("cordillera"), orden("pedregal"));
});

test("rk-1: el escenario demo coincide con volver a simular a los 12 coches con el núcleo", () => {
  const genomas = demoGenomes();
  assert.equal(genomas.length, DEMO_CARS);
  for (const t of CLASICAS) {
    for (const e of DEMO[t.id] as { carId: string; distance: number; origin: string; date: string }[]) {
      const i = genomas.findIndex((g) => genomeHash(g) === e.carId);
      assert.ok(i >= 0, "el coche del JSON es uno de los 12");
      assert.equal(e.distance, simulateCar(genomas[i], t.id).distance, `${t.id}/${e.carId}`);
      assert.equal(e.origin, DEMO_ORIGINS[i % DEMO_ORIGINS.length]);
      assert.equal(e.date, demoDate(i));
    }
  }
});

test("rk-1: nombre, tono y texto vacío de la pantalla", () => {
  assert.equal(nombreDe({ name: "Mi bólido", genomeHash: "abcdef0123456789" }), "Mi bólido");
  assert.equal(nombreDe({ genomeHash: "abcdef0123456789" }), "Coche abcd");
  assert.equal(textoVacio("El Pedregal"), "Nadie ha corrido aún en El Pedregal. Prueba un coche del Taller o evoluciona uno en esta pista.");
  fc.assert(
    fc.property(fc.stringMatching(/^[0-9a-f]{16}$/), (h) => {
      const t = tonoDe(h);
      return Number.isInteger(t) && t >= 0 && t < 360 && t === tonoDe(h);
    }),
  );
});

test("rk-4: el resumen nombra cada ranking con su puesto", () => {
  const marca = (trackId: TrackId, outcome: Partial<Parameters<typeof resumenMedicion>[0][number]["outcome"]>, reason = "stall") => ({
    trackId,
    result: { reason },
    outcome: { entered: false, position: null, alreadyAt: null, isRecord: false, cutoff: null, ...outcome },
  });
  assert.equal(
    resumenMedicion([marca("cordillera", {}), marca("rampa", { entered: true, position: 3 }), marca("dunas", {}), marca("pedregal", { entered: true, position: 1, isRecord: true })]),
    "Entra en 2 rankings: La Rampa (puesto 3) y El Pedregal (puesto 1).",
  );
  assert.equal(resumenMedicion([marca("rampa", { entered: true, position: 2 })]), "Entra en 1 ranking: La Rampa (puesto 2).");
  assert.equal(resumenMedicion([marca("rampa", {})]), "No entra en ningún ranking.");
  assert.equal(
    resumenMedicion([marca("rampa", { alreadyAt: 4 }), marca("dunas", {}, "anomaly")]),
    "No entra en ningún ranking. Ya estaba en La Rampa (puesto 4). Descalificado en Las Dunas.",
  );
});

/** Corre la medición con el ejecutor en línea y la termina con adelantar, como hace el gancho de pruebas. */
async function medir(genome: typeof STOCK_CAR, adelantos: number[]) {
  const runner = createInlineRunner();
  const llamadas: { trackId: TrackId; carId: string }[] = [];
  const progreso: number[] = [];
  const m = medirEnTodasLasPistas({
    runner,
    carId: genomeHash(genome),
    genome,
    onProgress: (n) => progreso.push(n),
    registrar: async (result) => {
      llamadas.push({ trackId: result.trackId, carId: result.carId });
      return result.distance;
    },
  });
  for (const s of adelantos) await m.avanzar(s);
  const marcas = await m.terminada;
  runner.terminate();
  return { marcas, llamadas, progreso };
}

test("rk-4: medir el coche de serie da exactamente simulateCar en cada pista, una vez por pista y en orden", async () => {
  const { marcas, llamadas, progreso } = await medir(STOCK_CAR, [800]);
  assert.deepEqual(progreso, TRACKS.map((_, i) => i + 1));
  assert.deepEqual(llamadas.map((l) => l.trackId), TRACKS.map((t) => t.id));
  for (const m of marcas) {
    assert.deepEqual(m.result, simulateCar(STOCK_CAR, m.trackId), m.trackId);
    assert.equal(m.outcome, m.result.distance);
  }
  // Las pistas donde el coche de serie llega a la meta empatan en el techo (5000 m): solo las demás deben ser distintas.
  const sinMeta = marcas.filter((m) => m.result.reason !== "meta");
  assert.equal(new Set(sinMeta.map((m) => m.result.distance)).size, sinMeta.length, "las marcas de las pistas sin meta son distintas entre sí");
});

test("rk-4 (propiedad): para cualquier coche y cualquier troceo de adelantar, una marca por pista igual a simulateCar", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 1e6 }),
      fc.array(fc.double({ min: 0.5, max: 150, noNaN: true }), { maxLength: 4 }),
      async (semilla, trozos) => {
        const genome = seededGenomes(semilla, 1)[0];
        const { marcas, llamadas } = await medir(genome, [...trozos, 5000]);
        assert.equal(marcas.length, TRACKS.length);
        assert.equal(llamadas.length, TRACKS.length);
        TRACKS.forEach((t, i) => {
          assert.equal(llamadas[i].trackId, t.id, "registrar solo recibe la marca de la pista que se midió");
          assert.deepEqual(marcas[i].result, simulateCar(genome, t.id));
        });
      },
    ),
    { numRuns: 4 },
  );
});

test("rk-4: cancelar la medición rechaza y no deja nada por registrar", async () => {
  const runner = createInlineRunner();
  let registros = 0;
  const m = medirEnTodasLasPistas({
    runner,
    carId: genomeHash(STOCK_CAR),
    genome: STOCK_CAR,
    onProgress: () => {},
    registrar: async () => {
      registros++;
    },
  });
  m.cancelar();
  await assert.rejects(m.terminada, /cancelada/);
  runner.terminate();
  assert.equal(registros, 0);
});

test("pn-6: una partida con 4 claves de ranking carga sin avisos y las pistas nuevas quedan vacías", () => {
  const avisos: string[] = [];
  const antiguo = { cordillera: [], rampa: [], dunas: [], pedregal: [] };
  const out = validateRankings(antiguo, (m) => avisos.push(m))!;
  assert.deepEqual(avisos, []);
  for (const id of ["glaciar", "trampolines", "escalera", "acantilado", "recta"] as const) assert.deepEqual(out[id], []);
});
