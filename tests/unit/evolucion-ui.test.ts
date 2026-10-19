import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { formatDelta, textoGeneracion } from "../../src/app/components/Evolucion";
import { evolucionSintetica } from "../../src/debug/escenario-evolucion";
import { DEFAULT_PARAMS, nextGeneration, seedPopulation, type EvolutionState } from "../../src/evolution/ga";
import { createRace } from "../../src/sim/race";
import { validateEvolution } from "../../src/storage/schema";
import { evolve, raceGeneration } from "./helpers/evolucionar";

/** Pasos de simulación suficientes para que haya diferencias entre coches sin pagar una carrera entera. */
const PASOS = 240;

const distanciaCircular = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

test("ev-6: el aviso de generación enseña la mejor distancia y el cambio con signo", () => {
  assert.equal(textoGeneracion(6, 180.4, 168.3), "Gen 6: mejor 180,4 m (+12,1 m)");
  assert.equal(textoGeneracion(2, 40, null), "Gen 2: mejor 40,0 m");
  assert.equal(formatDelta(-3), "−3,0 m");
  assert.equal(formatDelta(0), "+0,0 m");
});

test("ev-6: el tono de un hijo queda cerca del de su padre (proporcional a la deriva, no aleatorio)", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2 ** 30 }), (seed) => {
      const { states } = evolve({ ...DEFAULT_PARAMS, seed }, "cordillera", 2, { maxSteps: PASOS });
      const [primera, segunda] = states;
      const porId = new Map(primera.population.map((p) => [p.id, p]));
      const distancias: number[] = [];
      for (const hijo of segunda.population) {
        if (hijo.parents.length !== 1) continue;
        const padre = porId.get(hijo.parents[0]);
        if (!padre) continue;
        const d = distanciaCircular(hijo.hue, padre.hue);
        // Una gaussiana de sigma 12 grados no supera 9 sigmas con una fuente de 53 bits.
        assert.ok(d <= 12 * 9, `tono del hijo a ${d}° del padre`);
        if (hijo.op === "clone") assert.equal(d, 0);
        distancias.push(d);
      }
      if (distancias.length > 0) {
        const media = distancias.reduce((a, b) => a + b, 0) / distancias.length;
        assert.ok(media < 40, `deriva media ${media}° demasiado alta`);
      }
    }),
    { numRuns: 4 },
  );
});

test("invariante: la población que se guarda es la que devuelve nextGeneration, ida y vuelta por el almacén", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2 ** 30 }), fc.constantFrom("cordillera", "rampa"), (seed, pista) => {
      const { state } = seedPopulation({ ...DEFAULT_PARAMS, seed }, pista, { kind: "random" });
      const siguiente = nextGeneration(state, raceGeneration(state, PASOS));
      const guardado = validateEvolution(JSON.parse(JSON.stringify(siguiente.state)));
      assert.ok(guardado);
      assert.deepEqual(guardado, siguiente.state);
      assert.deepEqual(
        guardado.population.map((p) => p.id),
        siguiente.state.population.map((p) => p.id),
      );
    }),
    { numRuns: 4 },
  );
});

test("invariante: todas las carreras de una evolución usan EvolutionState.trackId", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2 ** 30 }), fc.constantFrom("cordillera", "rampa"), (seed, pista) => {
      const { states, results } = evolve({ ...DEFAULT_PARAMS, seed }, pista, 3, { maxSteps: PASOS });
      for (const s of states) assert.equal(s.trackId, pista);
      for (const generacion of results) for (const r of generacion) assert.equal(r.trackId, pista);
    }),
    { numRuns: 3 },
  );
});

test("invariante: cambiar de ritmo (más pasos por tirón) no cambia las distancias", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2 ** 30 }), fc.constantFrom(1, 3, 7, 60, 240), (seed, tiron) => {
      const { state } = seedPopulation({ ...DEFAULT_PARAMS, seed }, "rampa", { kind: "random" });
      const coches = state.population.map((p) => ({ carId: p.id, genome: p.genome }));
      const correr = (paso: number) => {
        const race = createRace(coches, "rampa", { maxSteps: PASOS });
        while (!race.done()) race.step(paso);
        const out = race.results().map((r) => [r.carId, r.distance] as const);
        race.dispose();
        return out;
      };
      assert.deepEqual(correr(tiron), correr(120));
    }),
    { numRuns: 5 },
  );
});

test("escenario sintético: generación pedida, un punto por generación terminada y estancamiento", () => {
  const e: EvolutionState = evolucionSintetica({ generacion: 9, stagnantFor: 6, trackId: "rampa" }, "cordillera");
  assert.equal(e.generation, 9);
  assert.equal(e.trackId, "rampa");
  assert.equal(e.history.length, 8);
  assert.equal(e.stagnantFor, 6);
  assert.ok(validateEvolution(e));
});
