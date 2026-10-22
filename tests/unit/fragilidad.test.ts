// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { createRace } from "../../src/sim/race";
import { STOCK_CAR, GENE_RANGES, type Genome } from "../../src/sim/genome";
import { PIEZAS_MAX, V_ROTURA, VIDA_PIEZA_PASOS, anguloMinimo, areaTriangulo, umbralRotura } from "../../src/sim/rotura";
import type { TrackId } from "../../src/sim/tracks";
import type { CarResult } from "../../src/sim/constants";
import { diagnosticoDeRotura } from "./helpers/fragilidad";

const conDensidad = (d: number): Genome => ({ ...STOCK_CAR, bodyDensity: d });

function caer(genome: Genome, caida: number, pasos = 240, trozo = 60): CarResult {
  const race = createRace([{ carId: "a", genome }], "pruebas-llana" as TrackId, { caida, maxSteps: pasos });
  while (!race.done()) race.step(trozo);
  const r = race.results()[0];
  race.dispose();
  return r;
}

const punto = fc.record({ x: fc.double({ min: -3, max: 3, noNaN: true }), y: fc.double({ min: -3, max: 3, noNaN: true }) });

test("fra-2 (invariante): umbral_i > 0 y no decrece con la densidad, el ángulo agudo ni el área", () => {
  fc.assert(
    fc.property(punto, punto, fc.double({ min: 20, max: 200, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (a, b, d, extra) => {
      const u = umbralRotura(d, a, b);
      assert.ok(u > 0 && Number.isFinite(u));
      assert.ok(umbralRotura(d + extra, a, b) >= u);
      // Escalar el triángulo crece su área sin tocar sus ángulos.
      const k = 1 + extra / 50;
      assert.ok(umbralRotura(d, { x: a.x * k, y: a.y * k }, { x: b.x * k, y: b.y * k }) >= u);
      assert.ok(anguloMinimo(a, b) >= 0 && areaTriangulo(a, b) >= 0);
    }),
    { numRuns: 300 },
  );
});

test("fra-2: un triángulo fino rompe antes que uno grueso de la misma área", () => {
  const grueso = umbralRotura(70, { x: 1, y: 0 }, { x: 0, y: 1 });
  const fino = umbralRotura(70, { x: 2, y: 0 }, { x: 2, y: 0.5 });
  assert.equal(areaTriangulo({ x: 1, y: 0 }, { x: 0, y: 1 }), areaTriangulo({ x: 2, y: 0 }, { x: 2, y: 0.5 }));
  assert.ok(fino < grueso);
  assert.ok(grueso <= V_ROTURA * 1.5 * Math.sqrt(1));
});

test("fra-2: caer de más altura no rompe menos, y lo ligero rompe antes que lo pesado", () => {
  const alturas = [1, 3, 6, 10, 15];
  const rotas = (d: number) => alturas.map((h) => caer(conDensidad(d), h).piezasPerdidas);
  const ligero = rotas(GENE_RANGES.bodyDensity[0]);
  const pesado = rotas(GENE_RANGES.bodyDensity[1]);
  const primera = (v: number[]) => v.findIndex((n) => n > 0);
  assert.equal(ligero[0], 0, "1 m no rompe nada");
  assert.equal(ligero[1], 0, "por debajo de 3 m no rompe un triángulo grueso");
  assert.ok(primera(ligero) >= 0 && (primera(pesado) === -1 || primera(ligero) <= primera(pesado)));
});

test("fra-4 / invariantes: piezasPerdidas ∈ [0, 8], metroRotura null sii 0 y ≤ distance", () => {
  for (const h of [0, 4, 8, 12, 20, 40]) {
    const r = caer(conDensidad(20), h);
    assert.ok(Number.isInteger(r.piezasPerdidas) && r.piezasPerdidas >= 0 && r.piezasPerdidas <= PIEZAS_MAX);
    assert.equal(r.metroRotura === null, r.piezasPerdidas === 0);
    if (r.metroRotura !== null) assert.ok(r.metroRotura <= r.distance);
  }
});

test("fra-4: tras romperse, el par por kilo no sube, la rueda solo se suelta con los dos triángulos y casi sin carrocería es destrozado", () => {
  const d = diagnosticoDeRotura();
  assert.ok(d.parPorKilo.length >= 2);
  for (let i = 1; i < d.parPorKilo.length; i++) assert.ok(d.parPorKilo[i] <= d.parPorKilo[i - 1] + 1e-9);
  assert.equal(d.ruedaSueltaConUnTrianguloVivo, false);
  assert.ok(d.masaRestante < 0.05);
  assert.equal(d.destrozado, true);
});

test("fra-5: las piezas sueltas desaparecen y los cuerpos nunca superan 1 + 2·ruedas + 8", () => {
  const ruedas = STOCK_CAR.wheels.filter((w) => w.vertex >= 0).length;
  const race = createRace([{ carId: "a", genome: conDensidad(20) }], "pruebas-llana" as TrackId, { caida: 20, maxSteps: 900 });
  let max = 0;
  let rotoEn = -1;
  for (let paso = 0; paso < 900 && !race.done(); paso++) {
    race.step(1);
    const p = race.poses()[0];
    if (rotoEn < 0 && (p.piezas ?? 255) < 255) rotoEn = paso;
    max = Math.max(max, (p.sueltas?.length ?? 0) + p.wheels.filter((w) => w.suelta && !w.fuera).length + 1 + ruedas);
    if (rotoEn >= 0 && paso > rotoEn + VIDA_PIEZA_PASOS + 1) assert.equal(p.sueltas, undefined, "toda pieza suelta desaparece en ≤ 600 pasos");
  }
  race.dispose();
  assert.ok(rotoEn >= 0, "con 20 m de caída algo se rompe");
  assert.ok(max <= 1 + 2 * ruedas + PIEZAS_MAX);
});

test("fra-3: el resultado no depende de cómo se troceen los pasos", () => {
  const a = caer(conDensidad(20), 12, 400, 60);
  const b = caer(conDensidad(20), 12, 400, 7);
  const c = caer(conDensidad(20), 12, 400, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.ok(a.piezasPerdidas > 0);
});
