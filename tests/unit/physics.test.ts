// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fc from "fast-check";
import { Circle, Vec2, World } from "planck";
import { STOCK_CAR, genomeHash, normalizeGenome } from "../../src/sim/genome";
import { createGround } from "../../src/sim/physics/ground";
import { maxMotorTorque } from "../../src/sim/physics/car";
import { MAX_STEPS, PHYSICS_VERSION, createRace, liveBodyCount, simulateCar, type CarResult } from "../../src/sim/race";
import { TRACKS, getTrack, type TrackId } from "../../src/sim/tracks";
import { seededGenomes, seededRand } from "./helpers/rng";
import { randomGenome } from "../../src/sim/genome";

const IDS = TRACKS.map((t) => t.id);

function key(r: CarResult): string {
  return `${r.distance}|${r.steps}|${r.reason}|${r.trackId}|${r.trackVersion}`;
}

test("nf-2-proceso: STOCK_CAR da el mismo resultado bit a bit en el mismo proceso y en uno hijo", () => {
  const script = path.join(__dirname, "helpers", "simular-serie.ts");
  const hijo = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", timeout: 120_000 }),
  ) as Record<string, { distance: number; steps: number; trackId: string }>;
  for (const id of IDS) {
    const a = simulateCar(STOCK_CAR, id);
    const b = simulateCar(STOCK_CAR, id);
    assert.ok(a.distance === b.distance && a.steps === b.steps, `${id}: dos ejecuciones en el proceso`);
    assert.ok(a.distance === hijo[id].distance, `${id}: proceso hijo ${hijo[id].distance} vs ${a.distance}`);
    assert.equal(a.steps, hijo[id].steps);
    assert.equal(a.trackId, id);
  }
});

function comparaCarrera(id: TrackId, genomes: ReturnType<typeof seededGenomes>, trozo: number, solos: CarResult[]): number {
  const race = createRace(genomes.map((genome, i) => ({ carId: `c${i}`, genome })), id);
  while (!race.done()) race.step(trozo);
  const byId = new Map(race.results().map((r) => [r.carId, r]));
  race.dispose();
  assert.equal(byId.size, genomes.length);
  return solos.filter((s) => key(byId.get(s.carId)!) === key(s)).length;
}

for (const id of ["cordillera", "dunas"] as const) {
  test(`nf-2-poblacion: 50 de 50 resultados idénticos solos y en carrera con step(7) (${id})`, () => {
    const genomes = seededGenomes(7, 50);
    const solos = genomes.map((g, i) => ({ ...simulateCar(g, id), carId: `c${i}` }));
    assert.equal(comparaCarrera(id, genomes, 7, solos), 50);
  });
}

for (const id of ["rampa", "pedregal"] as const) {
  test(`nf-2: 16 de 16 idénticos al avanzar de 1 en 1 y de 1000 en 1000 (${id})`, () => {
    const genomes = seededGenomes(9, 16);
    const solos = genomes.map((g, i) => ({ ...simulateCar(g, id), carId: `c${i}` }));
    assert.equal(comparaCarrera(id, genomes, 1, solos), 16);
    assert.equal(comparaCarrera(id, genomes, 1000, solos), 16);
  });
}

test("invariante: el resultado de un coche no depende de con quién corre ni de cómo se troceen los pasos", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 1e6 }), fc.constantFrom(...IDS), fc.integer({ min: 1, max: 400 }), (seed, id, trozo) => {
      const rand = seededRand(seed);
      const [g, h] = [randomGenome(rand), randomGenome(rand)];
      const solo = simulateCar(g, id);
      const race = createRace(
        [
          { carId: genomeHash(g), genome: g },
          { carId: "otro", genome: h },
        ],
        id,
      );
      while (!race.done()) race.step(trozo);
      const mio = race.results().find((r) => r.carId === genomeHash(g))!;
      race.dispose();
      assert.equal(key(mio), key(solo));
    }),
    { numRuns: 25 },
  );
});

test("nf-3-serie: el coche de serie avanza lo exigido y acaba por atasco o tiempo", () => {
  for (const id of IDS) {
    const r = simulateCar(STOCK_CAR, id);
    console.log(`  serie en ${id}: ${r.distance.toFixed(1)} m, ${r.reason}, ${r.steps} pasos`);
    assert.ok(r.distance >= (id === "cordillera" ? 40 : 20), `${id}: ${r.distance}`);
    // En el hielo y en los trampolines no hay cuestas que frenen al coche de serie: llega a la meta.
    const llegaAMeta = id === "glaciar" || id === "trampolines";
    assert.ok(r.reason === "stall" || r.reason === "timeout" || (llegaAMeta && r.reason === "meta"), `${id}: ${r.reason}`);
  }
});

test("nf-3-sin-ruedas: sin ruedas no pasa de 2 m y se atasca antes de 400 pasos", () => {
  const sinRuedas = normalizeGenome({ ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w) => ({ ...w, vertex: -1 })) });
  const r = simulateCar(sinRuedas, "cordillera");
  assert.ok(r.distance < 2, `distancia ${r.distance}`);
  assert.equal(r.reason, "stall");
  assert.ok(r.steps < 400, `pasos ${r.steps}`);
});

test("nf-3: el par máximo crece con el radio de la rueda", () => {
  const m = 100;
  assert.ok(maxMotorTorque(m, 0.8, 2) > maxMotorTorque(m, 0.4, 2));
  assert.ok(Math.abs(maxMotorTorque(m, 0.8, 2) / maxMotorTorque(m, 0.4, 2) - 2) < 1e-9);
  assert.ok(maxMotorTorque(m, 0.4, 4) < maxMotorTorque(m, 0.4, 2), "se reparte entre las ruedas motrices");
});

test("invariante: toda carrera termina en ≤ MAX_STEPS, con distancia finita ≥ 0 y la pista y versión de la carrera (nf-4)", () => {
  const genomes = seededGenomes(11, 300);
  genomes.forEach((genome, i) => {
    const id = IDS[i % IDS.length] as TrackId;
    const r = simulateCar(genome, id);
    assert.ok(r.steps <= MAX_STEPS);
    assert.ok(["stall", "timeout", "anomaly", "meta"].includes(r.reason));
    assert.ok(Number.isFinite(r.distance) && r.distance >= 0);
    assert.equal(r.trackId, id);
    assert.equal(r.trackVersion, getTrack(id)!.version);
    assert.equal(r.physicsVersion, PHYSICS_VERSION);
  });
});

test("invariante: la distancia nunca decrece durante la carrera y la anomalía la congela", () => {
  const genomes = seededGenomes(23, 12);
  for (const [i, genome] of genomes.entries()) {
    const race = createRace([{ carId: "x", genome }], IDS[i % 4]);
    let previa = 0;
    let congelada: number | null = null;
    while (!race.done()) {
      race.step(5);
      const r = race.results()[0];
      if (r) {
        assert.ok(r.distance >= previa);
        if (r.reason === "anomaly") congelada = r.distance;
      }
      previa = r?.distance ?? previa;
    }
    if (congelada !== null) assert.equal(race.results()[0].distance, congelada);
    race.dispose();
  }
});

test("nf-4: 200 carreras seguidas dejan 0 cuerpos vivos tras dispose()", () => {
  const genomes = seededGenomes(5, 8);
  for (let i = 0; i < 200; i++) {
    const race = createRace([{ carId: "a", genome: genomes[i % 8] }, { carId: "b", genome: STOCK_CAR }], IDS[i % 4]);
    race.step(1 + (i % 50)); // a medias: dispose debe liberar también lo que sigue vivo
    assert.ok(liveBodyCount() > 0);
    race.dispose();
    assert.equal(liveBodyCount(), 0, `carrera ${i}`);
  }
  const completa = createRace([{ carId: "a", genome: STOCK_CAR }], "dunas");
  while (!completa.done()) completa.step(100);
  assert.equal(liveBodyCount(), 0, "al terminar, cada mundo ya se liberó");
  completa.dispose();
});

test("nf-4-limites: en llano el coche no se atasca, llega a la meta y para en el paso de su última marca", () => {
  const race = createRace([{ carId: "a", genome: STOCK_CAR }], "cordillera", { heightFn: () => 0 });
  while (!race.done()) race.step(500);
  const r = race.results()[0];
  assert.equal(r.reason, "meta");
  assert.ok(r.steps > 10800 && r.steps < 54000, `pasos ${r.steps}`);
  assert.equal(r.steps, r.bestStep);
  assert.equal(r.distance, 5000);
  race.dispose();
});

test("nf-5: una rueda suelta atraviesa 10 uniones sin saltos ni frenazos", () => {
  const world = new World({ gravity: Vec2(0, -9.81) });
  const ground = createGround(world, () => 0);
  const ball = world.createDynamicBody({ position: Vec2(1, 0.5), allowSleep: false });
  ball.createFixture(new Circle(0.5), { density: 1, friction: 1 });
  ball.setLinearVelocity(Vec2(5, 0));
  ball.setAngularVelocity(-10); // ya rueda sin deslizar: la fricción no frena
  let prevVx = 5;
  let cruzadas = 0;
  let pasos = 0;
  while (ball.getPosition().x < 260 && pasos++ < 4000) {
    ground.ensure(ball.getPosition().x, ball.getPosition().x);
    world.step(1 / 60, 8, 3);
    const { x } = ball.getPosition();
    const v = ball.getLinearVelocity();
    const cerca = Math.abs(x - 25 * Math.round(x / 25)) <= 0.5 && x > 12;
    if (cerca) {
      assert.ok(Math.abs(v.y) < 0.05, `vy ${v.y} en x=${x}`);
      assert.ok(v.x >= prevVx * 0.98, `frenazo ${prevVx} → ${v.x} en x=${x}`);
      if (Math.abs(x - 25 * Math.round(x / 25)) < 0.05) cruzadas++;
    }
    prevVx = v.x;
  }
  assert.ok(ball.getPosition().x >= 260, "llegó al final");
  assert.ok(cruzadas >= 1);
});

test("nf-5: soltada desde 2 m, la rueda queda apoyada con la normal del suelo hacia arriba", () => {
  const world = new World({ gravity: Vec2(0, -9.81) });
  const ground = createGround(world, () => 0);
  const ball = world.createDynamicBody({ position: Vec2(30, 2), allowSleep: false });
  ball.createFixture(new Circle(0.5), { density: 1, friction: 1 });
  for (let i = 0; i < 240; i++) {
    ground.ensure(30, 30);
    world.step(1 / 60, 8, 3);
  }
  assert.ok(Math.abs(ball.getPosition().y - 0.5) < 0.02, `y ${ball.getPosition().y}`);
  let normalY = 0;
  for (let c = world.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching()) continue;
    const m = c.getWorldManifold(null);
    if (m) normalY = Math.max(normalY, Math.abs(m.normal.y));
  }
  assert.ok(normalY > 0.99, `normal.y ${normalY}`);
});
