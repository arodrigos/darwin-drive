// Antes que planck: Planck captura Math.sin/cos al cargarse y debe ver la versión determinista.
import "../../src/sim/detmath";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGenome, randomGenome, STOCK_CAR, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import type { TrackId } from "../../src/sim/tracks";
import { seededRand } from "./helpers/rng";

const PISTAS: TrackId[] = ["cordillera", "rampa", "dunas"];

const girar180 = (g: Genome): Genome =>
  normalizeGenome({ ...g, wheels: g.wheels.map((w) => ({ ...w, axisAngle: w.axisAngle + Math.PI })) });

// fu-2: justifica que la interfaz muestre la suspensión de −90° a +90°. Un eje y su opuesto son la misma guía
// para WheelJoint; se mide con la física real en lugar de darlo por supuesto.
test("fu-2: girar 180° el eje de todas las ruedas da la misma distancia (±1 % o 0,5 m) en ≥ 95 % de los casos", () => {
  const rand = seededRand(2026);
  // Los coches al azar casi nunca avanzan: el coche de serie y sus variantes sí miden algo.
  const genomas = [STOCK_CAR, ...Array.from({ length: 99 }, () => randomGenome(rand))];
  let casos = 0;
  let iguales = 0;
  for (const g of genomas) {
    for (const pista of PISTAS) {
      const a = simulateCar(g, pista).distance;
      const b = simulateCar(girar180(g), pista).distance;
      casos++;
      if (Math.abs(a - b) <= Math.max(0.5, 0.01 * Math.max(a, b))) iguales++;
    }
  }
  const fraccion = iguales / casos;
  console.log(`fu-2: equivalencia 180° = ${iguales}/${casos} (${(fraccion * 100).toFixed(1)} %)`);
  assert.ok(fraccion >= 0.95, `solo ${(fraccion * 100).toFixed(1)} % equivalentes`);
});
