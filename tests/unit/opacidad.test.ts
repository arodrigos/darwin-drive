import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { CONTORNO_COCHE, NIVELES_OPACIDAD, cargaTriangulo, opacidadBase, opacidadTriangulo, opacidadesCoche } from "../../src/game/opacidad";
import { PALETTES } from "../../src/game/palette";
import { GENE_RANGES, STOCK_CAR, normalizeGenome } from "../../src/sim/genome";
import { createRace } from "../../src/sim/race";

const densidad = fc.double({ min: GENE_RANGES.bodyDensity[0], max: GENE_RANGES.bodyDensity[1], noNaN: true });

test("opa-1: opacidadBase es no decreciente, solo da los cuatro niveles y no baja de 0,4", () => {
  fc.assert(
    fc.property(densidad, densidad, (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const ol = opacidadBase(lo);
      return ol <= opacidadBase(hi) && (NIVELES_OPACIDAD as readonly number[]).includes(ol) && ol >= 0.4;
    }),
  );
});

test("opa-1: los límites 64/65, 109/110 y 154/155 cambian de escalón; 20 y 200 son los extremos", () => {
  assert.equal(opacidadBase(64), 0.4);
  assert.equal(opacidadBase(65), 0.6);
  assert.equal(opacidadBase(109), 0.6);
  assert.equal(opacidadBase(110), 0.8);
  assert.equal(opacidadBase(154), 0.8);
  assert.equal(opacidadBase(155), 1);
  assert.equal(opacidadBase(20), 0.4);
  assert.equal(opacidadBase(200), 1);
  assert.equal(opacidadBase(NaN), 0.4);
});

test("opa-2: opacidadTriangulo está en [base, 1] y no decrece con la carga", () => {
  fc.assert(
    fc.property(fc.constantFrom(...NIVELES_OPACIDAD), fc.double({ min: -1, max: 2, noNaN: true }), fc.double({ min: -1, max: 2, noNaN: true }), (base, c1, c2) => {
      const [lo, hi] = c1 <= c2 ? [c1, c2] : [c2, c1];
      const a = opacidadTriangulo(base, lo);
      const b = opacidadTriangulo(base, hi);
      return a >= base && b <= 1 && a <= b;
    }),
  );
});

test("opa-2: un triángulo sin rueda tiene la opacidad base y uno con rueda cargada es más opaco", () => {
  const g = normalizeGenome({ ...STOCK_CAR, bodyDensity: 20, wheels: STOCK_CAR.wheels.map((w, i) => ({ ...w, vertex: i === 0 ? 3 : -1 })) });
  const op = opacidadesCoche(g, [1]);
  assert.equal(op[0], 0.4);
  assert.equal(op[2], 1);
  assert.equal(op[3], 1);
  assert.equal(op[5], 0.4);
  assert.deepEqual(opacidadesCoche(g), Array(8).fill(0.4));
  assert.equal(cargaTriangulo(3, undefined, g), 0);
});

test("opa-2: la carga de cada rueda sigue el orden de las ruedas activas y se acota a 1", () => {
  fc.assert(
    fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 4, maxLength: 4 }), fc.integer({ min: 0, max: 7 }), (cargas, i) => {
      const c = cargaTriangulo(i, cargas, STOCK_CAR);
      return c >= 0 && c <= 1;
    }),
  );
});

test("opa-2: la carga que llega a la pantalla ya viene suavizada (sin saltos entre muestras)", () => {
  const race = createRace([{ carId: "c", genome: STOCK_CAR }], "rampa");
  let prev: number[] | undefined;
  let maxSalto = 0;
  for (let i = 0; i < 600; i++) {
    race.step();
    const poses = race.poses();
    const c = poses[0].cargas;
    if (c && prev) c.forEach((v, k) => (maxSalto = Math.max(maxSalto, Math.abs(v - prev![k]))));
    prev = c;
  }
  assert.ok(prev, "la pose lleva cargas");
  assert.ok(maxSalto <= 0.2, `salto máximo entre pasos ${maxSalto}`);
});

test("opa-inv: pintar con opacidad no cambia ningún CarResult (el módulo no toca la simulación)", () => {
  const correr = () => {
    const r = createRace([{ carId: "c", genome: STOCK_CAR }], "cordillera");
    for (let i = 0; i < 400; i++) r.step();
    const res = [...r.poses()].map((p) => [p.x, p.y]);
    r.dispose();
    return res;
  };
  const a = correr();
  opacidadesCoche(STOCK_CAR, [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(correr(), a);
});

function luminancia(c: number): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
}
const contraste = (a: number, b: number) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("opa-3: el contorno (siempre opaco) tiene contraste ≥ 3:1 con cielo y suelo de cada pista", () => {
  for (const [id, p] of Object.entries(PALETTES)) {
    for (const [zona, color] of [["cielo", p.skyTop], ["cielo bajo", p.skyBottom], ["suelo", p.earth], ["hierba", p.grass]] as const) {
      assert.ok(contraste(CONTORNO_COCHE, color) >= 3, `${id} ${zona}: ${contraste(CONTORNO_COCHE, color).toFixed(2)}`);
    }
  }
});
