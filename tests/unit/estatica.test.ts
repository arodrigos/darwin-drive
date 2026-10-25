// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Vec2, World } from "planck";
import { STOCK_CAR, normalizeGenome, randomGenome } from "../../src/sim/genome";
import { buildCar, maxMotorTorque } from "../../src/sim/physics/car";
import { estatica, parMaximo } from "../../src/sim/physics/estatica";
import { ejeDeInclinacion, inclinacionDeEje, lecturaInclinacion } from "../../src/game/editor";
import { seededRand } from "./helpers/rng";

const TAU = 2 * Math.PI;
const mod = (a: number) => ((a % TAU) + TAU) % TAU;

test("fu-4: estatica(g) coincide con el centro de masas y la masa del coche que construye car.ts (sin gravedad)", () => {
  const rand = seededRand(77);
  const genomas = [STOCK_CAR, ...Array.from({ length: 150 }, () => randomGenome(rand))];
  for (const g of genomas) {
    const mundo = new World({ gravity: Vec2(0, 0) });
    const coche = buildCar(mundo, g, 0, 0);
    const origen = coche.chassis.getPosition();
    let masa = coche.chassis.getMass();
    let cx = coche.chassis.getWorldCenter().x * masa;
    let cy = coche.chassis.getWorldCenter().y * masa;
    for (const r of coche.wheels) {
      const m = r.body.getMass();
      masa += m;
      cx += r.body.getWorldCenter().x * m;
      cy += r.body.getWorldCenter().y * m;
    }
    const e = estatica(g);
    assert.ok(Math.abs(e.masa - masa) <= 0.005 * masa, `masa ${e.masa} vs ${masa}`);
    assert.ok(Math.abs(e.centroMasas.x - (cx / masa - origen.x)) <= 0.01, `x ${e.centroMasas.x} vs ${cx / masa - origen.x}`);
    assert.ok(Math.abs(e.centroMasas.y - (cy / masa - origen.y)) <= 0.01, `y ${e.centroMasas.y} vs ${cy / masa - origen.y}`);
    assert.equal(e.masa > 0, true);
  }
});

test("fu-4: parMaximo es el valor de maxMotorTorque y crece con la masa y con el radio", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 1, max: 5000, noNaN: true }),
      fc.double({ min: 0.1, max: 2, noNaN: true }),
      fc.double({ min: 0.01, max: 100, noNaN: true }),
      fc.integer({ min: 1, max: 4 }),
      (m, r, dm, n) => {
        assert.equal(parMaximo(m, r, n), maxMotorTorque(m, r, n));
        assert.ok(parMaximo(m + dm, r) > parMaximo(m, r));
        assert.ok(parMaximo(m, r + 0.01) > parMaximo(m, r));
      },
    ),
  );
});

test("fu-4: los pares por rueda de estatica son los maxMotorTorque con que car.ts arma las uniones", () => {
  const mundo = new World({ gravity: Vec2(0, 0) });
  const coche = buildCar(mundo, STOCK_CAR, 0, 0);
  const e = estatica(STOCK_CAR);
  assert.equal(e.ruedas.length, coche.wheels.length);
  e.ruedas.forEach((r, i) => assert.ok(Math.abs(r.parMax - coche.wheels[i].joint!.getMaxMotorTorque()) < 1e-9));
});

test("fu-1: ejeDeInclinacion(inclinacionDeEje(a)) es a o a − π, y la inclinación cae en [−90, 90]", () => {
  fc.assert(
    fc.property(fc.double({ min: -20, max: 20, noNaN: true }), (a) => {
      const g = inclinacionDeEje(a);
      assert.ok(g >= -90 - 1e-9 && g <= 90 + 1e-9);
      const e = ejeDeInclinacion(g);
      const d = mod(a) - e;
      const mismo = Math.abs(d) < 1e-9 || Math.abs(Math.abs(d) - Math.PI) < 1e-9 || Math.abs(Math.abs(d) - TAU) < 1e-9;
      assert.ok(mismo, `a=${a} e=${e}`);
    }),
  );
});

test("fu-1: vertical = 0°, hacia delante es positivo y la lectura lo dice en palabras", () => {
  assert.equal(inclinacionDeEje(Math.PI / 2), 0);
  assert.ok(Math.abs(inclinacionDeEje(Math.PI / 2 - Math.PI / 6) - 30) < 1e-9);
  assert.ok(Math.abs(ejeDeInclinacion(30) - (Math.PI / 2 - Math.PI / 6)) < 1e-9);
  // El eje opuesto (3π/2) se ve igual de vertical y no se reescribe.
  assert.ok(Math.abs(inclinacionDeEje((3 * Math.PI) / 2)) < 1e-9);
  assert.equal(lecturaInclinacion(0), "vertical");
  assert.equal(lecturaInclinacion(30), "inclinada 30° hacia delante");
  assert.equal(lecturaInclinacion(-20), "inclinada 20° hacia atrás");
  assert.equal(lecturaInclinacion(90), "tumbada");
  assert.equal(lecturaInclinacion(-90), "tumbada");
  const g = normalizeGenome({ ...STOCK_CAR, wheels: STOCK_CAR.wheels.map((w) => ({ ...w, axisAngle: (3 * Math.PI) / 2 })) });
  assert.equal(g.wheels[0].axisAngle, (3 * Math.PI) / 2);
});
