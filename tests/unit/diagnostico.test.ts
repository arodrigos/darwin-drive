// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { STALL_STEPS, CAUSAS_PARADA, type CarResult } from "../../src/sim/constants";
import { BufferParada, clasificarParada, type MuestraParada } from "../../src/sim/diagnostico";
import { STOCK_CAR, normalizeGenome, type Genome } from "../../src/sim/genome";
import { createRace, simulateCar } from "../../src/sim/race";
import { textoCausa } from "../../src/app/ayuda/causas";
import { seededGenomes } from "./helpers/rng";

const rad = (grados: number) => Math.tan((grados * Math.PI) / 180);
const llanoY = (x0: number, h: (d: number) => number) => (x: number) => (x < x0 ? 0 : h(x - x0));

function correr(genome: Genome, heightFn: (x: number) => number, opts: { friccionSuelo?: number; sinDiagnostico?: boolean; trozo?: number } = {}): CarResult {
  const race = createRace([{ carId: "a", genome }], "cordillera", { heightFn, friccionSuelo: opts.friccionSuelo, sinDiagnostico: opts.sinDiagnostico });
  while (!race.done()) race.step(opts.trozo ?? 60);
  const r = race.results()[0];
  race.dispose();
  return r;
}

const SIN_RUEDAS: Genome = { ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w) => ({ ...w, vertex: -1 })) };
const PEQUENO: Genome = normalizeGenome({ ...STOCK_CAR, wheels: [{ ...STOCK_CAR.wheels[0], radius: 0.2, vertex: 5 }, { ...STOCK_CAR.wheels[1], radius: 0.2, vertex: 7 }, STOCK_CAR.wheels[2], STOCK_CAR.wheels[3]] });

test("diag-2-a: una cuesta constante de 40° para el coche de serie por el motor, con pendiente entre 38 y 42", () => {
  const r = correr(STOCK_CAR, llanoY(20, (d) => d * rad(40)));
  assert.equal(r.reason, "stall");
  assert.equal(r.causaParada, "motor");
  assert.ok(r.pendienteParada! >= 38 && r.pendienteParada! <= 42, `pendiente ${r.pendienteParada}`);
});

test("diag-2: hielo en 20° es agarre, y con la pendiente por debajo del límite del motor", () => {
  const r = correr(STOCK_CAR, llanoY(20, (d) => d * rad(20)), { friccionSuelo: 0.02 });
  assert.equal(r.reason, "stall");
  assert.equal(r.causaParada, "agarre");
  assert.ok(r.pendienteParada! < 33);
});

test("diag-2: un muro de 70° y 3 m es un obstáculo, no una cuesta que el motor no pueda subir", () => {
  const r = correr(STOCK_CAR, llanoY(20, (d) => (d < 3 ? d * rad(70) : 3 * rad(70))));
  assert.equal(r.causaParada, "obstaculo");
  assert.ok(r.pendienteParada! < 33);
});

test("diag-2: un coche sin ruedas se para sin apoyo o sobre la panza", () => {
  const r = correr(SIN_RUEDAS, () => 0);
  assert.equal(r.reason, "stall");
  assert.ok(r.causaParada === "sin-apoyo" || r.causaParada === "panza", String(r.causaParada));
});

test("diag-2: un escalón de 1 m lo vuelca", () => {
  const r = correr(STOCK_CAR, llanoY(20, (d) => (d < 0.5 ? d * 2 : 1)));
  assert.equal(r.causaParada, "vuelco");
});

test("diag-2: ruedas pequeñas sobre una cresta aguda dejan el coche sentado en la panza", () => {
  const r = correr(PEQUENO, (x) => (x < 29.4 ? 0 : x < 30 ? (0.6 * (x - 29.4)) / 0.6 : x < 30.6 ? 0.6 * (1 - (x - 30) / 0.6) : 0));
  assert.equal(r.causaParada, "panza");
});

test("diag-2: sin atasco no hay causa (meta, tiempo o anomalía)", () => {
  const r = correr(STOCK_CAR, () => 0);
  assert.notEqual(r.reason, "stall");
  assert.equal(r.causaParada, null);
  assert.equal(r.pendienteParada, null);
});

function muestra(over: Partial<MuestraParada> = {}): MuestraParada {
  return { pendiente: 0, patinaje: 0, ruedasEnContacto: 2, carroceriaEnContacto: false, angulo: 0, carga: 1, ...over };
}
const repetida = (m: MuestraParada, n = STALL_STEPS) => Array.from({ length: n }, () => ({ ...m }));

test("diag-2: la prioridad es vuelco > sin-apoyo > panza > motor > agarre > obstáculo", () => {
  const todo = muestra({ angulo: Math.PI, ruedasEnContacto: 0, carroceriaEnContacto: true, carga: 0, pendiente: 40, patinaje: 1 });
  assert.equal(clasificarParada(repetida(todo)).causa, "vuelco");
  assert.equal(clasificarParada(repetida({ ...todo, angulo: 0 })).causa, "sin-apoyo");
  assert.equal(clasificarParada(repetida({ ...todo, angulo: 0, ruedasEnContacto: 1 })).causa, "panza");
  assert.equal(clasificarParada(repetida({ ...todo, angulo: 0, ruedasEnContacto: 1, carga: 1 })).causa, "motor");
  assert.equal(clasificarParada(repetida({ ...todo, angulo: 0, ruedasEnContacto: 1, carga: 1, pendiente: 10 })).causa, "agarre");
  assert.equal(clasificarParada(repetida({ ...todo, angulo: 0, ruedasEnContacto: 1, carga: 1, pendiente: 10, patinaje: 0 })).causa, "obstaculo");
});

test("diag-2: los umbrales son los del diseño (vuelco > 50 %, sin apoyo ≥ 80 %, motor ≥ 33°)", () => {
  const mitad = (a: MuestraParada, b: MuestraParada, n: number) => [...repetida(a, n), ...repetida(b, STALL_STEPS - n)];
  const boca = muestra({ angulo: Math.PI });
  assert.notEqual(clasificarParada(mitad(boca, muestra(), STALL_STEPS / 2)).causa, "vuelco", "justo la mitad no es más de la mitad");
  assert.equal(clasificarParada(mitad(boca, muestra(), STALL_STEPS / 2 + 1)).causa, "vuelco");
  const volando = muestra({ ruedasEnContacto: 0 });
  assert.equal(clasificarParada(mitad(volando, muestra(), 0.8 * STALL_STEPS)).causa, "sin-apoyo");
  assert.notEqual(clasificarParada(mitad(volando, muestra(), 0.8 * STALL_STEPS - 1)).causa, "sin-apoyo");
  assert.equal(clasificarParada(repetida(muestra({ pendiente: 33 }))).causa, "motor");
  assert.notEqual(clasificarParada(repetida(muestra({ pendiente: 32.9 }))).causa, "motor");
});

const arbMuestra = fc.record({
  pendiente: fc.double({ min: -90, max: 90, noNaN: true }),
  patinaje: fc.double({ min: 0, max: 1, noNaN: true }),
  ruedasEnContacto: fc.integer({ min: 0, max: 4 }),
  carroceriaEnContacto: fc.boolean(),
  angulo: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
  carga: fc.double({ min: 0, max: 1, noNaN: true }),
});

test("diag-2 (invariante): motor implica pendiente ≥ 33, agarre y obstáculo < 33, y la pendiente cae siempre en [−90, 90]", () => {
  fc.assert(
    fc.property(fc.array(arbMuestra, { minLength: 1, maxLength: 40 }), (muestras) => {
      const d = clasificarParada(muestras);
      assert.ok(CAUSAS_PARADA.includes(d.causa));
      assert.ok(d.pendiente >= -90 && d.pendiente <= 90);
      if (d.causa === "motor") assert.ok(d.pendiente >= 33);
      if (d.causa === "agarre" || d.causa === "obstaculo") assert.ok(d.pendiente < 33);
      if (d.causa === "vuelco") assert.ok(muestras.filter((m) => Math.abs(m.angulo) > (100 * Math.PI) / 180).length > muestras.length / 2);
    }),
    { numRuns: 300 },
  );
});

test("el búfer circular guarda solo las últimas STALL_STEPS muestras", () => {
  const b = new BufferParada();
  for (let i = 0; i < STALL_STEPS + 50; i++) b.anotar(muestra({ pendiente: i }));
  const m = b.muestras();
  assert.equal(m.length, STALL_STEPS);
  assert.equal(Math.min(...m.map((x) => x.pendiente)), 50);
});

test("diag-3 (invariantes): 50 genomas, causa nula salvo atasco, determinista, independiente del trozo y con cargas en [0, 1]", () => {
  const genomas = seededGenomes(7, 50);
  const h = llanoY(20, (d) => Math.min(d * rad(36), 40));
  for (const [i, g] of genomas.entries()) {
    // Un trozo distinto imita otro ritmo: el resultado no puede depender de él.
    const a = correr(g, h, { trozo: 60 });
    const b = correr(g, h, { trozo: i % 2 === 0 ? 7 : 600 });
    assert.deepEqual(a, b, `genoma ${i}`);
    assert.equal(a.causaParada === null, a.reason !== "stall", `genoma ${i}: ${a.reason} / ${a.causaParada}`);
    assert.equal(a.pendienteParada === null, a.reason !== "stall");
    if (a.causaParada === "motor") assert.ok(a.pendienteParada! >= 33);
    if (a.causaParada === "agarre") assert.ok(a.pendienteParada! < 33);
  }
});

test("diag-3: con y sin muestreo el CarResult es el mismo salvo la causa (20 genomas), y las cargas están en [0, 1]", () => {
  const h = llanoY(20, (d) => Math.min(d * rad(30), 30));
  for (const [i, g] of seededGenomes(11, 20).entries()) {
    const con = correr(g, h);
    const sin = correr(g, h, { sinDiagnostico: true });
    assert.deepEqual({ ...con, causaParada: null, pendienteParada: null }, sin, `genoma ${i}`);
  }
  const race = createRace([{ carId: "a", genome: STOCK_CAR }], "cordillera", { heightFn: llanoY(20, (d) => d * rad(20)) });
  for (let i = 0; i < 40 && !race.done(); i++) {
    race.step(30);
    for (const p of race.poses()) for (const c of p.cargas ?? []) assert.ok(c >= 0 && c <= 1, `carga ${c}`);
  }
  assert.equal(race.poses()[0].cargas?.length, 2);
  race.dispose();
});

test("diag-3: la causa de la pista real La Rampa es la misma en dos ejecuciones", () => {
  const a = simulateCar(STOCK_CAR, "rampa");
  const b = simulateCar(STOCK_CAR, "rampa");
  // Con la rampa endurecida el coche de serie se atasca antes de llegar a la cuesta que agota el motor.
  assert.equal(a.causaParada, "obstaculo");
  assert.ok(a.pendienteParada !== null && Number.isFinite(a.pendienteParada));
  assert.deepEqual(a, b);
});

test("textoCausa (invariante): nunca lanza ni devuelve vacío; la de motor lleva la pendiente redondeada y «°»", () => {
  fc.assert(
    fc.property(fc.oneof(fc.constantFrom(...CAUSAS_PARADA), fc.string(), fc.constant(null), fc.constant(undefined), fc.integer()), fc.oneof(fc.double(), fc.constant(null), fc.constant(undefined), fc.string()), (c, p) => {
      const t = textoCausa(c as never, p as never);
      assert.ok(typeof t === "string" && t.trim().length > 0);
    }),
    { numRuns: 300 },
  );
  fc.assert(
    fc.property(fc.double({ min: 33, max: 90, noNaN: true }), (p) => {
      const t = textoCausa("motor", p);
      assert.ok(t.includes(`${Math.round(p)}°`) && t.includes("35°"));
    }),
  );
  assert.equal(textoCausa("zzz" as never, 3), "Se paró.");
  assert.match(textoCausa("motor", 36.4), /^Cuesta de 36°: más de lo que puede empujar el motor \(35°\)\. Todos los coches tienen ese límite: solo pasa quien llega lanzado\.$/);
});
