import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  amortiguar,
  ANCLA_CARRERA,
  bandaSegura,
  pasoCamara,
  TAU_PARADO_MS,
  TAU_SEGUIR_MS,
  type EstadoCamara,
} from "../../src/game/camara";
import { TRACKS } from "../../src/sim/tracks";

const PX_M = 20;
const ALTOS = [640, 1180, 820];

function cajaPx(e: EstadoCamara, altoPx: number, liderY: number, sobreM: number, bajoM: number) {
  const toY = (h: number) => altoPx * e.ancla - (h - e.refH) * PX_M;
  return { top: toY(liderY + sobreM), bottom: toY(liderY - bajoM) };
}

test("cp-2: dividir el tiempo en cualquier número de pasos da el mismo resultado", () => {
  const exacto = 10 - 10 * Math.exp(-2000 / TAU_SEGUIR_MS);
  const pasos = (n: number, dt: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = amortiguar(v, 10, TAU_SEGUIR_MS, dt);
    return v;
  };
  for (const v of [pasos(120, 2000 / 120), pasos(6, 2000 / 6), pasos(1, 2000)]) {
    assert.ok(Math.abs(v - exacto) <= 1e-9 * Math.max(1, Math.abs(exacto)));
  }
  assert.equal(amortiguar(0, 10, TAU_SEGUIR_MS, 0), 0);
  assert.ok(Math.abs(amortiguar(0, 10, TAU_SEGUIR_MS, 1e6) - 10) < 1e-9);
});

test("cp-2: independencia de los fps con particiones aleatorias (property)", () => {
  fc.assert(
    fc.property(
      fc.double({ min: -50, max: 50, noNaN: true }),
      fc.double({ min: -50, max: 50, noNaN: true }),
      fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 1, maxLength: 40 }),
      (a, b, dts) => {
        let v = a;
        for (const dt of dts) v = amortiguar(v, b, TAU_SEGUIR_MS, dt);
        const junto = amortiguar(a, b, TAU_SEGUIR_MS, dts.reduce((s, d) => s + d, 0));
        return Math.abs(v - junto) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      },
    ),
  );
});

test("sin rebote: el resultado queda entre actual y objetivo (property)", () => {
  fc.assert(
    fc.property(
      fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      fc.double({ min: 0, max: 1e5, noNaN: true }),
      (a, b, dt) => {
        const v = amortiguar(a, b, TAU_SEGUIR_MS, dt);
        return v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9;
      },
    ),
  );
});

test("cp-2: el retraso en régimen nunca pasa de v·τ (property, ambos sentidos)", () => {
  fc.assert(
    fc.property(fc.double({ min: -40, max: 40, noNaN: true }), fc.integer({ min: 8, max: 1000 }), (v, dt) => {
      let obj = 0;
      let ref = 0;
      for (let t = 0; t < 60000; t += dt) {
        obj += (v * dt) / 1000;
        ref = amortiguar(ref, obj, TAU_SEGUIR_MS, dt);
        if (Math.abs(obj - ref) > (Math.abs(v) * TAU_SEGUIR_MS) / 1000 + 1e-9) return false;
      }
      return true;
    }),
  );
});

test("cp-2: la fórmula vieja (0,1 por fotograma) a 333 ms rebasa con mucho el tope v·τ", () => {
  const v = 5;
  let obj = 0;
  let ref = 0;
  for (let i = 0; i < 200; i++) {
    obj += v * 0.333;
    ref += (obj - ref) * 0.1;
  }
  assert.ok(obj - ref > 18 * v * (TAU_SEGUIR_MS / 1000));
});

test("cp-3: a 60 fps el factor por fotograma es el de siempre", () => {
  const seguir = 1 - Math.exp(-16.67 / TAU_SEGUIR_MS);
  const parado = 1 - Math.exp(-16.67 / TAU_PARADO_MS);
  assert.ok(Math.abs(seguir - 0.1) <= 0.005, String(seguir));
  assert.ok(Math.abs(parado - 0.5) <= 0.02, String(parado));
});

const dtsArb = fc.array(fc.integer({ min: 8, max: 1000 }), { minLength: 20, maxLength: 120 });

for (const pista of TRACKS) {
  for (const alto of ALTOS) {
    test(`cp-1: ${pista.id} a ${alto} px, la caja del líder no sale de la banda (property)`, () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 8, noNaN: true }),
          fc.double({ min: 0.5, max: 3, noNaN: true }),
          fc.double({ min: 0.5, max: 3, noNaN: true }),
          fc.boolean(),
          dtsArb,
          (mult, sobreM, bajoM, parado, dts) => {
            const banda = bandaSegura(alto, parado);
            let x = 0;
            let estado: EstadoCamara | null = null;
            for (const dt of dts) {
              x = Math.min(5000, x + (mult * 15 * dt) / 1000);
              const liderY = pista.heightAt(x) + 0.5;
              const r = pasoCamara(estado, { dtMs: dt, liderY, sobreM, bajoM, altoPx: alto, pxPorMetro: PX_M, parado });
              estado = { refH: r.refH, ancla: r.ancla };
              const c = cajaPx(estado, alto, liderY, sobreM, bajoM);
              if ((sobreM + bajoM) * PX_M <= banda.abajoPx - banda.arribaPx) {
                if (c.top < banda.arribaPx - 0.5 || c.bottom > banda.abajoPx + 0.5) return false;
              } else if (Math.abs((c.top + c.bottom) / 2 - (banda.arribaPx + banda.abajoPx) / 2) > 0.5) return false;
            }
            return true;
          },
        ),
        { numRuns: 200 },
      );
    });
  }
}

test("cp-1-rampa-3fps: la cámara nueva mantiene el coche en la banda y la vieja lo pierde por arriba", () => {
  const rampa = TRACKS.find((t) => t.id === "rampa")!;
  const sobreM = 1.6;
  const bajoM = 0.6;
  const banda = bandaSegura(640, false);
  let nuevo: EstadoCamara | null = null;
  let viejo: EstadoCamara | null = null;
  let viejoSale = false;
  for (let i = 1; i * 333 <= 40000; i++) {
    const x = (i * 333 * 48) / 1000;
    const liderY = rampa.heightAt(x) + 0.5;
    const r = pasoCamara(nuevo, { dtMs: 333, liderY, sobreM, bajoM, altoPx: 640, pxPorMetro: PX_M, parado: false });
    nuevo = { refH: r.refH, ancla: r.ancla };
    const c = cajaPx(nuevo, 640, liderY, sobreM, bajoM);
    assert.ok(c.top >= banda.arribaPx - 0.5 && c.bottom <= banda.abajoPx + 0.5);
    viejo = viejo ? { refH: viejo.refH + (liderY - viejo.refH) * 0.1, ancla: ANCLA_CARRERA } : { refH: liderY, ancla: ANCLA_CARRERA };
    if (cajaPx(viejo, 640, liderY, sobreM, bajoM).top < 0) viejoSale = true;
  }
  assert.ok(viejoSale, "la fórmula vieja debería sacar el coche por arriba");
});

test("límites: 1 fps, dt alterno y caída brusca siguen dentro", () => {
  const aca = TRACKS.find((t) => t.id === "acantilado")!;
  for (const alto of ALTOS) {
    const banda = bandaSegura(alto, false);
    let estado: EstadoCamara | null = null;
    for (let i = 0; i < 400; i++) {
      const dt = i % 2 ? 8 : 1000;
      const x = i * 13;
      const liderY = aca.heightAt(x) + 0.5;
      const r = pasoCamara(estado, { dtMs: dt, liderY, sobreM: 1.6, bajoM: 0.6, altoPx: alto, pxPorMetro: PX_M, parado: false });
      estado = { refH: r.refH, ancla: r.ancla };
      const c = cajaPx(estado, alto, liderY, 1.6, 0.6);
      assert.ok(c.top >= banda.arribaPx - 0.5 && c.bottom <= banda.abajoPx + 0.5);
    }
  }
});

test("encuadre directo y entradas raras nunca dan NaN ni infinito (property)", () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.constant(null), fc.constant({ refH: Number.NaN, ancla: 0.6 }), fc.record({ refH: fc.double({ min: -100, max: 100, noNaN: true }), ancla: fc.double({ min: 0, max: 1, noNaN: true }) })),
      fc.oneof(fc.double(), fc.constant(Number.POSITIVE_INFINITY), fc.constant(Number.NEGATIVE_INFINITY), fc.constant(-5)),
      fc.double({ min: -100, max: 100, noNaN: true }),
      fc.boolean(),
      (previo, dtMs, liderY, parado) => {
        const r = pasoCamara(previo, { dtMs, liderY, sobreM: 1.6, bajoM: 0.6, altoPx: 640, pxPorMetro: PX_M, parado });
        return Number.isFinite(r.refH) && Number.isFinite(r.ancla);
      },
    ),
  );
  const r = pasoCamara(null, { dtMs: 16, liderY: 3, sobreM: 0.5, bajoM: 0.5, altoPx: 640, pxPorMetro: PX_M, parado: false });
  assert.ok(Math.abs(r.refH - 3) < 1e-9 && r.ancla === ANCLA_CARRERA);
});

test("cp-4: camara.ts no importa phaser, DOM ni módulos de debug, físicas o worker", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync("src/game/camara.ts", "utf8");
  assert.doesNotMatch(fuente, /from\s+["'](phaser|[^"']*\/(debug|worker)\/|[^"']*sim\/physics)/);
  assert.doesNotMatch(fuente, /\b(window|document|navigator)\b\s*[.[]/);
});
