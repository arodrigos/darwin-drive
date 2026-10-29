import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { despuesDeMedir, latencias, markInput, measureOnNextFrame, reiniciarLatencias } from "../../src/debug/latencias";

// Reloj y requestAnimationFrame simulados: el fotograma solo llega cuando la prueba lo dice.
let ahora = 0;
let cola: (() => void)[] = [];
let timers: (() => void)[] = [];
const g = globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number };

beforeEach(() => {
  reiniciarLatencias();
  ahora = 0;
  cola = [];
  timers = [];
  mock.method(globalThis, "setTimeout", ((fn: () => void) => {
    timers.push(fn);
    return timers.length;
  }) as unknown as typeof setTimeout);
  mock.method(performance, "now", () => ahora);
  g.requestAnimationFrame = (cb) => {
    cola.push(cb);
    return cola.length;
  };
});

function fotograma(): void {
  const pendientes = cola;
  cola = [];
  pendientes.forEach((cb) => cb());
  // La medida se cierra en un setTimeout lanzado desde el rAF: con el fotograma ya pintado.
  const t = timers;
  timers = [];
  t.forEach((cb) => cb());
}

test("ml-1: una medida trae trabajoMs al llamar y ms al fotograma siguiente", () => {
  ahora = 100;
  markInput("abrir-pista");
  ahora = 140;
  measureOnNextFrame("abrir-pista");
  assert.equal(latencias().length, 0);
  ahora = 185;
  fotograma();
  const [m] = latencias();
  assert.equal(m.trabajoMs, 40);
  assert.equal(m.ms, 85);
});

test("invariante: con relojes crecientes, toda latencia cumple 0 ≤ trabajoMs ≤ ms y nunca hay más de 50", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ evento: fc.constantFrom("a", "b", "c"), d1: fc.nat(500), d2: fc.nat(500), d3: fc.nat(500) }), { maxLength: 120 }),
      (pasos) => {
        reiniciarLatencias();
        ahora = 0;
        for (const p of pasos) {
          ahora += p.d1;
          markInput(p.evento);
          ahora += p.d2;
          measureOnNextFrame(p.evento);
          ahora += p.d3;
          fotograma();
        }
        const lista = latencias();
        assert.ok(lista.length <= 50);
        for (const l of lista) assert.ok(l.trabajoMs >= 0 && l.trabajoMs <= l.ms, `${l.trabajoMs} ${l.ms}`);
      },
    ),
    { numRuns: 200 },
  );
});

test("invariante: measureOnNextFrame sin markInput previo no produce medida", () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom("a", "b", "c"), { maxLength: 30 }), (eventos) => {
      reiniciarLatencias();
      for (const e of eventos) measureOnNextFrame(e);
      fotograma();
      assert.equal(latencias().length, 0);
    }),
  );
});

test("una marca se consume: medir dos veces el mismo evento solo da una medida", () => {
  markInput("x");
  measureOnNextFrame("x");
  measureOnNextFrame("x");
  fotograma();
  assert.equal(latencias().length, 1);
});

test("ml-despues: despuesDeMedir espera a que la medida esté cerrada", () => {
  markInput("a");
  measureOnNextFrame("a");
  let corrio = false;
  despuesDeMedir("a", () => (corrio = true));
  assert.equal(corrio, false);
  fotograma();
  assert.equal(latencias().length, 1);
  assert.equal(corrio, true);
});
