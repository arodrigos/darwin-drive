import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { COLORES_COCHE, type ColorCoche } from "../../src/game/colores-coche";
import {
  KEY_BATALLA,
  crearBatalla,
  ordenarBatalla,
  transicion,
  validarBatalla,
  type AccionBatalla,
  type EstadoBatalla,
  type ResultadoCrudo,
} from "../../src/batalla/estado";
import { cargarBatalla, guardarBatalla, borrarBatalla } from "../../src/batalla/guardado";
import { resetStoreConnection } from "../../src/storage/store";
import { genomeHash, normalizeGenome, STOCK_CAR } from "../../src/sim/genome";
import { TRACKS } from "../../src/sim/tracks";
import { seededGenomes } from "./helpers/rng";

const GENOMAS = seededGenomes(11, 8);
const IDS_PISTA = TRACKS.map((t) => t.id);

function tres(): EstadoBatalla {
  return crearBatalla(
    [
      { nombre: "Ana", color: "naranja" },
      { nombre: "Bea", color: "azul" },
      { nombre: "Carlos", color: "verde" },
    ],
    "b1",
    "2026-10-25T10:00:00.000Z",
  );
}

function aTurnos(e: EstadoBatalla): EstadoBatalla {
  let s = transicion(e, { tipo: "empezar" });
  for (let i = 0; i < e.jugadores.length; i++) {
    s = transicion(s, { tipo: "comenzar-turno" });
    s = transicion(s, { tipo: "terminar-coche", genome: GENOMAS[i], nombre: `Coche ${i}` });
  }
  return s;
}

const crudo = (jugador: number, distance: number, bestStep = 600, piezasPerdidas = 0, reason = "stall"): ResultadoCrudo => ({
  jugador,
  distance,
  bestStep,
  piezasPerdidas,
  reason,
});

test("ba-e1-a: el recorrido completo de 3 jugadores llega a carrera con 3 coches y la pista elegida", () => {
  let s = aTurnos(tres());
  assert.equal(s.fase, "elegir-pista");
  s = transicion(s, { tipo: "elegir-pista", pista: "cordillera" });
  s = transicion(s, { tipo: "correr" });
  assert.equal(s.fase, "carrera");
  assert.equal(s.pista, "cordillera");
  assert.ok(s.jugadores.every((j) => j.coche !== null));
  assert.deepEqual(validarBatalla(JSON.parse(JSON.stringify(s))), s);
});

test("ba-e1-a: terminar-coche fuera de turno lanza y deja el estado igual", () => {
  let s = aTurnos(tres());
  s = transicion(transicion(s, { tipo: "elegir-pista", pista: "cordillera" }), { tipo: "correr" });
  const antes = JSON.stringify(s);
  assert.throws(() => transicion(s, { tipo: "terminar-coche", genome: STOCK_CAR, nombre: "X" }));
  assert.equal(JSON.stringify(s), antes);
});

test("ba-e1-a: relevo no pinta coches: los de jugadores anteriores solo existen en el estado, nunca el del que va a diseñar", () => {
  let s = transicion(tres(), { tipo: "empezar" });
  assert.equal(s.fase, "relevo");
  assert.ok(s.jugadores.every((j) => j.coche === null));
  s = transicion(transicion(s, { tipo: "comenzar-turno" }), { tipo: "terminar-coche", genome: STOCK_CAR, nombre: "Uno" });
  assert.equal(s.fase, "relevo");
  assert.equal(s.activo, 1);
  assert.equal(s.jugadores[1].coche, null);
});

test("ba-e1-a: correr sin pista elegida lanza, y de resultado se vuelve a carrera, a elegir pista", () => {
  const s = aTurnos(tres());
  assert.throws(() => transicion(s, { tipo: "correr" }));
  const c = transicion(transicion(s, { tipo: "elegir-pista", pista: "recta" }), { tipo: "correr" });
  const r = transicion(c, { tipo: "terminar-carrera", resultados: [crudo(0, 50), crudo(1, 80), crudo(2, 20)] });
  assert.equal(r.fase, "resultado");
  assert.deepEqual(r.resultados!.map((x) => [x.jugador, x.posicion]), [[1, 1], [0, 2], [2, 3]]);
  const rev = transicion(r, { tipo: "revancha" });
  assert.equal(rev.fase, "carrera");
  assert.equal(rev.pista, "recta");
  assert.equal(rev.resultados, null);
  const otra = transicion(r, { tipo: "otra-pista" });
  assert.equal(otra.fase, "elegir-pista");
  assert.equal(otra.pista, null);
});

test("ba-e1-a: la carrera exige un resultado por jugador", () => {
  const c = transicion(transicion(aTurnos(tres()), { tipo: "elegir-pista", pista: "recta" }), { tipo: "correr" });
  assert.throws(() => transicion(c, { tipo: "terminar-carrera", resultados: [crudo(0, 5)] }));
  assert.throws(() => transicion(c, { tipo: "terminar-carrera", resultados: [crudo(0, 5), crudo(0, 6), crudo(1, 7)] }));
});

test("ba-e1: crear o configurar con 1 o 5 jugadores o colores repetidos lanza", () => {
  const j = (n: number, color: (i: number) => ColorCoche) => Array.from({ length: n }, (_, i) => ({ nombre: `J${i}`, color: color(i) }));
  assert.throws(() => crearBatalla(j(1, (i) => COLORES_COCHE[i]), "x", "t"));
  assert.throws(() => crearBatalla(j(5, (i) => COLORES_COCHE[i]), "x", "t"));
  assert.throws(() => crearBatalla(j(2, () => "azul"), "x", "t"));
  assert.equal(crearBatalla(j(4, (i) => COLORES_COCHE[i]), "x", "t").jugadores.length, 4);
  assert.throws(() => transicion(transicion(tres(), { tipo: "empezar" }), { tipo: "configurar", jugadores: j(2, (i) => COLORES_COCHE[i]) }));
});

test("ba-e1-a: los estados manipulados y de versión futura devuelven null sin lanzar", () => {
  const base = JSON.parse(JSON.stringify(aTurnos(tres())));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const copia = (f: (o: Record<string, any>) => void) => {
    const o = JSON.parse(JSON.stringify(base));
    f(o);
    return o;
  };
  const malos = [
    copia((o) => o.jugadores.push({ ...o.jugadores[0], color: "cielo" }, { ...o.jugadores[0], color: "amarillo" }, { ...o.jugadores[0], color: "hueso" })),
    copia((o) => (o.jugadores[1].color = "naranja")),
    copia((o) => (o.fase = "jugando")),
    copia((o) => (o.v = 2)),
    copia((o) => (o.jugadores[2].coche = null)),
    copia((o) => (o.jugadores[0].coche.genome.v = 9)),
    copia((o) => (o.jugadores[0].coche.genome.body = [])),
    copia((o) => (o.pista = "no-existe")),
    copia((o) => (o.activo = 7)),
    copia((o) => (o.jugadores[0].color = "rojo")),
    copia((o) => (o.fase = "carrera")),
    copia((o) => (o.resultados = [])),
    null,
    "hola",
    [],
    { v: 1 },
  ];
  for (const m of malos) assert.equal(validarBatalla(m), null, JSON.stringify(m)?.slice(0, 80));
  assert.ok(validarBatalla(base));
});

test("ba-e2: ordena por distancia, luego entero y luego tiempo, y marca el criterio decisivo", () => {
  const r = ordenarBatalla([
    crudo(0, 100.04, 500, 0),
    crudo(1, 200, 900, 0),
    crudo(2, 100.0, 500, 1), // misma distancia en décimas que el 0, pero perdió una pieza
    crudo(3, 100.0, 450, 0), // misma que el 0 y 2 en décimas, más rápido que el 0
  ]);
  assert.deepEqual(r.map((x) => x.jugador), [1, 3, 0, 2]);
  assert.deepEqual(r.map((x) => x.posicion), [1, 2, 3, 4]);
  assert.deepEqual(r.map((x) => x.criterio), ["distancia", "tiempo", "entero", "entero"]);
});

test("ba-e2: dos coches idénticos empatan y el orden de diseño no desempata", () => {
  const r = ordenarBatalla([crudo(0, 70, 300), crudo(1, 70, 300), crudo(2, 10)]);
  assert.deepEqual(r.map((x) => x.posicion), [1, 1, 3]);
  assert.deepEqual(r.map((x) => x.criterio), ["empate", "empate", "distancia"]);
  assert.deepEqual(ordenarBatalla([crudo(1, 70, 300), crudo(0, 70, 300)]).map((x) => x.posicion), [1, 1]);
});

test("ba-e2: un coche descalificado por anomalía va el último aunque la distancia sea mayor", () => {
  const r = ordenarBatalla([crudo(0, 999, 100, 0, "anomaly"), crudo(1, 5)]);
  assert.deepEqual(r.map((x) => x.jugador), [1, 0]);
});

// --- Propiedades (invariantes del bloque)

const arbColores = fc.shuffledSubarray([...COLORES_COCHE], { minLength: 2, maxLength: 4 });
const arbJugadores = arbColores.map((cs) => cs.map((color, i) => ({ nombre: `Jugador ${i + 1}`, color })));
const arbEstado = fc.record({ js: arbJugadores, pasos: fc.nat(40), pista: fc.constantFrom(...IDS_PISTA), seed: fc.nat(7) }).map(({ js, pasos, pista, seed }) => {
  // Avanza por el camino válido tantos pasos como se pida, para cubrir todas las fases.
  let s = crearBatalla(js, "p", "t");
  const cola: ((e: EstadoBatalla) => AccionBatalla)[] = [
    () => ({ tipo: "empezar" }),
    ...js.flatMap((_, i): ((e: EstadoBatalla) => AccionBatalla)[] => [
      () => ({ tipo: "comenzar-turno" }),
      () => ({ tipo: "terminar-coche", genome: GENOMAS[(seed + i) % GENOMAS.length], nombre: `Coche ${i}` }),
    ]),
    () => ({ tipo: "elegir-pista", pista }),
    () => ({ tipo: "correr" }),
    (e) => ({ tipo: "terminar-carrera", resultados: e.jugadores.map((_, i) => crudo(i, (i * 37 + seed) % 11)) }),
  ];
  for (const f of cola.slice(0, Math.min(pasos, cola.length))) s = transicion(s, f(s));
  return s;
});

test("ba-e1 invariante: todo estado alcanzable sobrevive a JSON y a validarBatalla igual que entró", () => {
  fc.assert(fc.property(arbEstado, (e) => assert.deepEqual(validarBatalla(JSON.parse(JSON.stringify(e))), e)), { numRuns: 200 });
});

test("ba-e1 invariante: con acciones al azar, todo estado alcanzable es coherente", () => {
  const arbAccion = fc.oneof(
    fc.constant<AccionBatalla>({ tipo: "empezar" }),
    fc.constant<AccionBatalla>({ tipo: "comenzar-turno" }),
    fc.nat(7).map((i): AccionBatalla => ({ tipo: "terminar-coche", genome: GENOMAS[i], nombre: `C${i}` })),
    fc.constantFrom(...IDS_PISTA).map((pista): AccionBatalla => ({ tipo: "elegir-pista", pista })),
    fc.constant<AccionBatalla>({ tipo: "correr" }),
    fc.constant<AccionBatalla>({ tipo: "revancha" }),
    fc.constant<AccionBatalla>({ tipo: "otra-pista" }),
    fc.array(fc.nat(60), { minLength: 4, maxLength: 4 }).map((ds): AccionBatalla => ({ tipo: "terminar-carrera", resultados: ds.map((d, i) => crudo(i, d)) })),
    fc.constant<AccionBatalla>({ tipo: "terminar-carrera", resultados: [] }),
  );
  fc.assert(
    fc.property(arbJugadores, fc.array(arbAccion, { maxLength: 40 }), (js, acciones) => {
      let s = crearBatalla(js, "q", "t");
      for (const a of acciones) {
        const antes = JSON.stringify(s);
        try {
          s = transicion(s, a);
        } catch {
          // Una acción que no vale lanza y el estado de entrada queda intacto.
          assert.equal(JSON.stringify(s), antes);
          continue;
        }
        assert.ok(s.jugadores.length >= 2 && s.jugadores.length <= 4);
        assert.equal(new Set(s.jugadores.map((j) => j.color)).size, s.jugadores.length);
        assert.ok(s.activo >= 0 && s.activo < s.jugadores.length);
        if (["elegir-pista", "carrera", "resultado"].includes(s.fase)) assert.ok(s.jugadores.every((j) => j.coche !== null));
        assert.ok(validarBatalla(JSON.parse(JSON.stringify(s))), s.fase);
      }
    }),
    { numRuns: 200 },
  );
});

test("ba-e2 invariante: posiciones de 1 a n que no bajan, iguales si y solo si coinciden en décimas, entero y tiempo", () => {
  const arbRes = fc.array(
    fc.record({ d: fc.integer({ min: 0, max: 30 }).map((x) => x / 10), t: fc.integer({ min: 0, max: 3 }), p: fc.integer({ min: 0, max: 2 }) }),
    { minLength: 2, maxLength: 4 },
  );
  fc.assert(
    fc.property(arbRes, (rs) => {
      const out = ordenarBatalla(rs.map((r, i) => crudo(i, r.d, r.t * 100, r.p)));
      out.forEach((x, k) => {
        assert.ok(x.posicion >= 1 && x.posicion <= out.length);
        if (k > 0) assert.ok(x.posicion >= out[k - 1].posicion);
      });
      for (const a of out) for (const b of out) {
        const ra = rs[a.jugador];
        const rb = rs[b.jugador];
        const igual = Math.round(ra.d * 10) === Math.round(rb.d * 10) && ra.t === rb.t && (ra.p === 0) === (rb.p === 0);
        assert.equal(a.posicion === b.posicion, igual);
      }
    }),
    { numRuns: 300 },
  );
});

// --- Persistencia

beforeEach(() => resetStoreConnection());

test("ba-e1: se guarda en dd:v1:batalla, se recarga igual y se borra; un valor ilegible no ofrece continuar", async () => {
  assert.equal(KEY_BATALLA, "dd:v1:batalla");
  assert.equal(await cargarBatalla(), null);
  const e = aTurnos(tres());
  await guardarBatalla(e);
  assert.deepEqual(await cargarBatalla(), e);
  await borrarBatalla();
  assert.equal(await cargarBatalla(), null);
  await guardarBatalla({ ...e, v: 2 } as unknown as EstadoBatalla);
  assert.equal(await cargarBatalla(), null);
});

test("el genoma que guarda terminar-coche es el normalizado y no cambia su hash", () => {
  const s = aTurnos(tres());
  assert.equal(genomeHash(s.jugadores[0].coche!.genome), genomeHash(normalizeGenome(GENOMAS[0])));
});
