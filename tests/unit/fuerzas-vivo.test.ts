import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { STOCK_CAR, genomeHash, randomGenome, type Genome } from "../../src/sim/genome";
import { createRace } from "../../src/sim/race";
import type { FuerzasMuestra } from "../../src/sim/constants";
import { RaceEngine } from "../../src/worker/engine";
import type { FromWorker } from "../../src/worker/protocol";

// Generador determinista sencillo (LCG): los tests no dependen del azar.
function semilla(n: number): () => number {
  let s = n >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PASOS = 600;

function correr(g: Genome, consultar: boolean) {
  const id = genomeHash(g);
  const race = createRace([{ carId: id, genome: g }], "pedregal", { maxSteps: PASOS });
  const muestras: FuerzasMuestra[] = [];
  while (!race.done()) {
    race.step(1);
    if (consultar) {
      const m = race.fuerzas(id);
      if (m) muestras.push(m);
    }
  }
  const results = race.results();
  race.dispose();
  return { results, muestras };
}

test("fv-3: consultar las fuerzas en cada paso no cambia el CarResult de 30 genomas", () => {
  const rand = semilla(7);
  const genomas = [STOCK_CAR, ...Array.from({ length: 29 }, () => randomGenome(rand))];
  for (const g of genomas) {
    const sin = correr(g, false);
    const con = correr(g, true);
    assert.deepEqual(con.results, sin.results, genomeHash(g));
    assert.ok(con.muestras.length > 0);
  }
});

test("fv-3 (propiedad): las fuerzas siempre son números finitos y una por rueda", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
      const g = randomGenome(semilla(seed));
      const { muestras } = correr(g, true);
      for (const m of muestras) {
        assert.equal(m.ruedas.length, g.wheels.filter((w) => w.vertex >= 0).length);
        for (const r of m.ruedas) for (const v of [r.fx, r.fy, r.par, r.parMotor]) assert.ok(Number.isFinite(v));
      }
    }),
    { numRuns: 8 },
  );
});

function motor() {
  const mensajes: FromWorker[] = [];
  const engine = new RaceEngine((m) => mensajes.push(m));
  const rand = semilla(3);
  const cars = [STOCK_CAR, randomGenome(rand), randomGenome(rand)].map((genome) => ({ carId: genomeHash(genome), genome }));
  engine.handle({ type: "startRace", raceId: "r1", cars, trackId: "pedregal", pace: "x1" });
  const poses = () => mensajes.filter((m): m is Extract<FromWorker, { type: "poses" }> => m.type === "poses");
  return { engine, mensajes, poses };
}

test("fv-2: con la capa apagada el Worker no envía ninguna muestra de fuerzas", () => {
  const { engine, poses } = motor();
  for (let i = 0; i < 6; i++) engine.handle({ type: "advance", raceId: "r1", seconds: 2 });
  assert.ok(poses().length >= 6);
  assert.equal(poses().filter((p) => p.fuerzas !== undefined).length, 0);
});

test("fv-1: encendida, cada pose lleva la muestra del coche líder; apagada, deja de llevarla", () => {
  const { engine, poses } = motor();
  engine.handle({ type: "setFuerzas", raceId: "r1", on: true });
  engine.handle({ type: "advance", raceId: "r1", seconds: 3 });
  const ultima = poses().at(-1)!;
  assert.ok(ultima.fuerzas, "la pose trae fuerzas");
  const lider = ultima.poses.filter((p) => !p.finished).reduce((a, p) => (p.x > a.x ? p : a));
  assert.equal(ultima.fuerzas.carId, lider.carId);
  assert.equal(ultima.fuerzas.ruedas.length, lider.wheels.length);
  engine.handle({ type: "setFuerzas", raceId: "r1", on: false });
  const antes = poses().length;
  engine.handle({ type: "advance", raceId: "r1", seconds: 3 });
  assert.ok(poses().length > antes);
  assert.equal(poses().slice(antes).filter((p) => p.fuerzas !== undefined).length, 0);
});

test("fv-1: al encender, la muestra llega al instante aunque la carrera esté en pausa", () => {
  const { engine, poses } = motor();
  engine.handle({ type: "pause", raceId: "r1" });
  const antes = poses().length;
  engine.handle({ type: "setFuerzas", raceId: "r1", on: true });
  assert.equal(poses().length, antes + 1);
  assert.ok(poses().at(-1)!.fuerzas);
});

test("fv-3: los resultados del ejecutor son idénticos con la capa encendida y apagada", () => {
  const resultados = (encendida: boolean) => {
    const { engine, mensajes } = motor();
    engine.handle({ type: "setFuerzas", raceId: "r1", on: encendida });
    engine.handle({ type: "advance", raceId: "r1", seconds: 600 });
    return mensajes.find((m): m is Extract<FromWorker, { type: "raceDone" }> => m.type === "raceDone")?.results;
  };
  assert.deepEqual(resultados(true), resultados(false));
});
