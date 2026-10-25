import { test } from "node:test";
import assert from "node:assert/strict";
import { GENOMA_DEMO_MOTOR_RAMPA } from "../../src/debug/genoma-demo-motor";
import { simulateCar } from "../../src/sim/race";

// El escenario protege el caso peor de la tarjeta de fin (récord y causa de motor a la vez):
// si una pista cambia y este coche deja de pararse por el motor, hay que buscar otro genoma.
test("demo-motor-rampa se para contra el límite de motor en La Rampa", () => {
  const r = simulateCar(GENOMA_DEMO_MOTOR_RAMPA, "rampa");
  assert.equal(r.reason, "stall");
  assert.equal(r.causaParada, "motor");
});
