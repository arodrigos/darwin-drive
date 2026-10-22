import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  DEFAULT_PARAMS,
  nextGeneration,
  seedPopulation,
  setFavorite,
  type EvolutionState,
  type GaParams,
} from "../../src/evolution/ga";
import {
  MAX_LINEAGE_NODES,
  mergeLineage,
  originOf,
  pruneLineage,
  type LineageNode,
} from "../../src/evolution/lineage";
import { STOCK_CAR, genomeHash, normalizeGenome, type Genome } from "../../src/sim/genome";
import type { CarResult } from "../../src/sim/constants";
import { compararMarcas, marcaDeResultado } from "../../src/sim/clasificacion";
import type { TrackId } from "../../src/sim/tracks";
import { evolve, raceGeneration } from "./helpers/evolucionar";

/** Resultados simulados (sin física): la distancia es una función pura del genoma. */
function fakeResults(state: EvolutionState, distanceOf: (g: Genome) => number, trackId: TrackId = state.trackId): CarResult[] {
  return state.population.map((p) => ({
    carId: p.id,
    distance: distanceOf(p.genome),
    reason: "stall",
    steps: 100,
    bestStep: Math.ceil(distanceOf(p.genome) * 1.2) + 1,
    piezasPerdidas: 0,
    metroRotura: null,
    causaParada: null,
    pendienteParada: null,
    physicsVersion: 1,
    trackId,
    trackVersion: 1,
  }));
}

/** Una función de aptitud cualquiera pero determinista y sensible a cada gen. */
const score = (g: Genome) => g.bodyDensity + g.body.reduce((s, b) => s + b.length * 10, 0) + g.wheels.reduce((s, w) => s + (w.vertex >= 0 ? w.radius * 50 : 0), 0);

const PARAMS: GaParams = { populationSize: 8, eliteCount: 2, mutationRate: 0.05, mutationSize: "medium", seed: 42 };

function run(state: EvolutionState, gens: number, distanceOf = score): { states: EvolutionState[]; nodes: LineageNode[] } {
  const states = [state];
  const nodes: LineageNode[] = [];
  for (let g = 0; g < gens; g++) {
    const next = nextGeneration(states[states.length - 1], fakeResults(states[states.length - 1], distanceOf));
    states.push(next.state);
    nodes.push(...next.lineageAdded);
  }
  return { states, nodes };
}

test("ga-1: misma semilla, mismas generaciones; retomar desde el JSON guardado da lo mismo (física real)", () => {
  const opts = { maxSteps: 1800 };
  const a = evolve(PARAMS, "cordillera", 6, opts);
  const b = evolve(PARAMS, "cordillera", 6, opts);
  assert.deepStrictEqual(a.states, b.states);
  assert.deepStrictEqual(a.results, b.results);

  // Tercera: el estado de la generación 3 pasa por JSON y se sigue desde ahí.
  let state = JSON.parse(JSON.stringify(a.states[2])) as EvolutionState;
  assert.deepStrictEqual(state, a.states[2]);
  const resumed: EvolutionState[] = [state];
  for (let g = 3; g < 6; g++) {
    state = JSON.parse(JSON.stringify(nextGeneration(state, raceGeneration(state, 1800)).state)) as EvolutionState;
    resumed.push(state);
  }
  assert.deepStrictEqual(resumed, a.states.slice(2, 6));
  assert.equal(nextGeneration(a.states[5], a.results[5]).state.history.length, 6);
  for (const s of a.states) assert.equal(s.trackId, "cordillera");
});

test("ga-3: «mi coche» parte del diseño intacto y de 15 mutantes que difieren en algún gen", () => {
  const params = { ...PARAMS, populationSize: 16, seed: 5 };
  const { state, lineageAdded } = seedPopulation(params, "dunas", { kind: "genomes", items: [{ genome: STOCK_CAR, op: "design" }] });
  assert.equal(state.population.length, 16);
  const design = state.population.filter((p) => p.op === "design");
  assert.equal(design.length, 1);
  assert.deepStrictEqual(design[0].genome, STOCK_CAR);
  const mutants = state.population.filter((p) => p.op === "mutation");
  assert.equal(mutants.length, 15);
  for (const m of mutants) {
    assert.deepStrictEqual(m.parents, [design[0].id]);
    assert.notEqual(genomeHash(m.genome), genomeHash(STOCK_CAR));
  }
  const node = lineageAdded.find((n) => n.id === design[0].id);
  assert.equal(node?.humanTouched, true);
  assert.equal(state.trackId, "dunas");
  assert.equal(lineageAdded.length, 16);
  for (const m of mutants) assert.ok(lineageAdded.find((n) => n.id === m.id)!.generation > node!.generation);
});

test("ga-4: sin mejora del 1 % en 5 generaciones la mutación se dobla; al mejorar, vuelve", () => {
  const flat = () => 100;
  let state = seedPopulation(PARAMS, "rampa", { kind: "random" }).state;
  assert.equal(state.effectiveMutationRate, 0.05);
  // La primera generación fija la referencia; las cinco siguientes son planas.
  for (let g = 0; g < 5; g++) {
    state = nextGeneration(state, fakeResults(state, flat)).state;
    assert.equal(state.effectiveMutationRate, 0.05, `generación ${g}`);
  }
  state = nextGeneration(state, fakeResults(state, flat)).state;
  assert.equal(state.stagnantFor, 5);
  assert.equal(state.effectiveMutationRate, 0.1);
  state = nextGeneration(state, fakeResults(state, () => 150)).state;
  assert.equal(state.stagnantFor, 0);
  assert.equal(state.effectiveMutationRate, 0.05);
});

test("ga-4: el doble se corta en el 30 %", () => {
  let state = seedPopulation({ ...PARAMS, mutationRate: 0.25 }, "rampa", { kind: "random" }).state;
  for (let g = 0; g < 8; g++) state = nextGeneration(state, fakeResults(state, () => 100)).state;
  assert.equal(state.effectiveMutationRate, 0.3);
});

test("ga-5: 250 generaciones de 16 con poda: tope, antepasados del mejor y prunedParents", () => {
  let state = seedPopulation({ ...DEFAULT_PARAMS, seed: 9 }, "pedregal", { kind: "random" }).state;
  let lineage = seedPopulation({ ...DEFAULT_PARAMS, seed: 9 }, "pedregal", { kind: "random" }).lineageAdded;
  let pruned = false;
  for (let g = 0; g < 250; g++) {
    const next = nextGeneration(state, fakeResults(state, score));
    state = next.state;
    lineage = mergeLineage(lineage, next.lineageAdded);
    const protectedIds = [state.history[state.history.length - 1].bestId];
    if (lineage.length > MAX_LINEAGE_NODES) pruned = true;
    lineage = pruneLineage(lineage, protectedIds);
    assert.ok(lineage.length <= MAX_LINEAGE_NODES);
  }
  assert.ok(pruned, "el test tiene que llegar a podar");
  assert.ok(lineage.some((n) => n.prunedParents));
  // La cadena completa de antepasados del mejor sigue ahí, hasta una raíz.
  const byId = new Map(lineage.map((n) => [n.id, n]));
  let cur = byId.get(state.history[state.history.length - 1].bestId)!;
  assert.ok(cur);
  while (cur.parents.length > 0) {
    const parent = byId.get(cur.parents[0]);
    assert.ok(parent, "padre conservado");
    cur = parent;
  }
});

test("ga-6: un favorito, aunque sea el peor, tiene al menos 2 hijos", () => {
  let state = seedPopulation(PARAMS, "cordillera", { kind: "random" }).state;
  const results = fakeResults(state, score);
  const worst = results.reduce((w, r) => (r.distance < w.distance ? r : w));
  state = setFavorite(state, worst.carId, true);
  const next = nextGeneration(state, results).state;
  assert.ok(next.population.filter((p) => p.parents.includes(worst.carId)).length >= 2);
  assert.deepStrictEqual(next.favorites, []);
});

test("ga-7: originOf distingue diseño, evolución y mixto", () => {
  const g = STOCK_CAR;
  const n = (id: string, op: LineageNode["op"], parents: string[], human: boolean, generation: number): LineageNode => ({
    id, parents, op, generation, distance: null, trackId: null, genome: g, hue: 0, humanTouched: human, prunedParents: false,
  });
  const evolucion = [n("r", "random", [], false, 1), n("c", "crossover", ["r"], false, 2), n("m", "mutation", ["c"], false, 3)];
  assert.equal(originOf("m", evolucion), "evolución");
  const diseno = [n("d", "design", [], true, 0), n("k", "clone", ["d"], false, 1)];
  assert.equal(originOf("d", diseno), "diseño");
  assert.equal(originOf("k", diseno), "diseño");
  const mixtoA = [...diseno, n("m", "mutation", ["d"], false, 1)];
  assert.equal(originOf("m", mixtoA), "mixto");
  const mixtoB = [...evolucion, n("t", "retouch", ["m"], true, 4)];
  assert.equal(originOf("t", mixtoB), "mixto");
});

test("nextGeneration lanza si algún resultado es de otra pista, o falta alguno", () => {
  const state = seedPopulation(PARAMS, "rampa", { kind: "random" }).state;
  assert.throws(() => nextGeneration(state, fakeResults(state, score, "dunas")), /pista/);
  assert.throws(() => nextGeneration(state, fakeResults(state, score).slice(1)), /Falta/);
});

test("un coche descalificado no es élite ni cuenta como mejor", () => {
  const state = seedPopulation(PARAMS, "rampa", { kind: "random" }).state;
  const results = fakeResults(state, score).map((r, i) => (i === 0 ? { ...r, distance: 9999, reason: "anomaly" as const } : r));
  const next = nextGeneration(state, results).state;
  assert.notEqual(next.history[0].bestId, state.population[0].id);
  assert.ok(next.history[0].best < 9999);
});

// --- Invariantes (property tests) ---------------------------------------------

const paramsArb = fc.record({
  populationSize: fc.integer({ min: 8, max: 32 }),
  eliteCount: fc.integer({ min: 0, max: 4 }),
  mutationRate: fc.double({ min: 0.01, max: 0.3, noNaN: true }),
  mutationSize: fc.constantFrom("small", "medium", "large" as const),
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
});
const trackArb = fc.constantFrom<TrackId>("cordillera", "rampa", "dunas", "pedregal");

test("invariante: hijos normalizados con 1 o 2 padres de la generación anterior; tamaño constante; élite intacta; determinista", () => {
  fc.assert(
    fc.property(paramsArb, trackArb, fc.integer({ min: 1, max: 6 }), (params, track, gens) => {
      const { state: s0 } = seedPopulation(params, track, { kind: "random" });
      const { states } = run(s0, gens);
      const { states: again } = run(s0, gens);
      assert.deepStrictEqual(states, again);
      for (let i = 1; i < states.length; i++) {
        const prev = states[i - 1];
        const cur = states[i];
        const prevIds = new Set(prev.population.map((p) => p.id));
        assert.equal(cur.population.length, s0.params.populationSize);
        assert.equal(cur.trackId, track);
        assert.equal(new Set(cur.population.map((p) => p.id)).size, cur.population.length);
        for (const child of cur.population) {
          assert.deepStrictEqual(child.genome, normalizeGenome(child.genome));
          assert.ok(child.parents.length === 1 || child.parents.length === 2);
          for (const p of child.parents) assert.ok(prevIds.has(p));
          assert.equal(child.generation, prev.generation + 1);
        }
        // El mismo orden que usa el algoritmo: décimas de distancia y, a igualdad, el tiempo.
        const marcas = fakeResults(prev, score).map((r, i) => marcaDeResultado(r, { genomeHash: prev.population[i].id }));
        const ranked = prev.population.map((_, i) => i).sort((a, b) => compararMarcas(marcas[a], marcas[b]) || a - b).map((i) => prev.population[i]);
        const elite = new Set(cur.population.map((c) => genomeHash(c.genome)));
        for (const e of ranked.slice(0, s0.params.eliteCount)) assert.ok(elite.has(genomeHash(e.genome)));
        assert.ok(cur.effectiveMutationRate >= s0.params.mutationRate && cur.effectiveMutationRate <= 0.3);
      }
    }),
    { numRuns: 40 },
  );
});

test("invariante: con élite ≥ 1 la mejor distancia nunca decrece", () => {
  fc.assert(
    fc.property(paramsArb.filter((p) => p.eliteCount >= 1), trackArb, (params, track) => {
      const { states } = run(seedPopulation(params, track, { kind: "random" }).state, 12);
      const bests = states.slice(0, -1).map((s) => Math.max(...s.population.map((p) => score(p.genome))));
      for (let i = 1; i < bests.length; i++) assert.ok(bests[i] >= bests[i - 1]);
    }),
    { numRuns: 30 },
  );
});

test("invariante: el linaje es acíclico y todo padre conservado tiene generación menor", () => {
  fc.assert(
    fc.property(paramsArb, fc.boolean(), (params, fromDesign) => {
      const seeded = seedPopulation(
        params,
        "dunas",
        fromDesign ? { kind: "genomes", items: [{ genome: STOCK_CAR, op: "design" }] } : { kind: "random" },
      );
      const { nodes } = run(seeded.state, 6);
      const lineage = mergeLineage(seeded.lineageAdded, nodes);
      const byId = new Map(lineage.map((n) => [n.id, n]));
      assert.equal(byId.size, lineage.length);
      for (const n of lineage) {
        for (const p of n.parents) {
          const parent = byId.get(p);
          if (parent) assert.ok(parent.generation < n.generation);
        }
      }
    }),
    { numRuns: 30 },
  );
});

/** DAG aleatorio: cada nodo cuelga de 0-2 nodos anteriores. */
const dagArb = fc.integer({ min: 1, max: 120 }).chain((size) =>
  fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { minLength: size, maxLength: size }).map((spec) =>
    spec.map(([a, b, two], i): LineageNode => ({
      id: `n${i}`,
      parents: i === 0 ? [] : [...new Set(two ? [a % i, b % i] : [a % i])].map((x) => `n${x}`),
      op: i === 0 ? "random" : "mutation",
      generation: i,
      distance: null,
      trackId: null,
      genome: STOCK_CAR,
      hue: 0,
      humanTouched: false,
      prunedParents: false,
    })),
  ),
);

function ancestorsOf(ids: string[], nodes: LineageNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    stack.push(...byId.get(id)!.parents);
  }
  return seen;
}

test("invariante: pruneLineage conserva los antepasados de lo protegido (hasta el tope) y no pasa del tope", () => {
  fc.assert(
    fc.property(dagArb, fc.array(fc.nat(), { maxLength: 4 }), fc.integer({ min: 1, max: 60 }), (nodes, picks, max) => {
      const protectedIds = picks.map((p) => `n${p % nodes.length}`);
      const out = pruneLineage(nodes, protectedIds, max);
      assert.ok(out.length <= Math.max(max, nodes.length <= max ? nodes.length : 0));
      const kept = new Set(out.map((n) => n.id));
      const closure = ancestorsOf(protectedIds, nodes);
      if (closure.size <= max) for (const id of closure) assert.ok(kept.has(id), `falta ${id}`);
      for (const n of out) for (const p of n.parents) assert.ok(kept.has(p));
    }),
    { numRuns: 200 },
  );
});

test("invariante: effectiveMutationRate se mantiene en [mutationRate, 0,30] aun con resultados erráticos", () => {
  fc.assert(
    fc.property(paramsArb, fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 1, maxLength: 12 }), (params, ds) => {
      let state = seedPopulation(params, "rampa", { kind: "random" }).state;
      for (const d of ds) {
        state = nextGeneration(state, fakeResults(state, () => d)).state;
        assert.ok(state.effectiveMutationRate >= state.params.mutationRate);
        assert.ok(state.effectiveMutationRate <= 0.3);
      }
    }),
    { numRuns: 60 },
  );
});
