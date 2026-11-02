import { test } from "node:test";
import assert from "node:assert/strict";
import { crearMotor, type DepsMotor, type EscenaMotor } from "../../src/game/motor";
import type { SimRunner } from "../../src/worker/protocol";

function motorFalso(creados: { n: number; terminados: number }) {
  const deps = {
    crearRunner: (): SimRunner => {
      creados.n++;
      return { kind: "worker", post() {}, subscribe: () => () => {}, terminate: () => void creados.terminados++ };
    },
  } as unknown as DepsMotor<EscenaMotor>;
  return crearMotor(deps);
}

test("poolint-3: el pool cuenta sus Workers aparte del compartido y los descuenta una sola vez al terminar", () => {
  const c = { n: 0, terminados: 0 };
  const motor = motorFalso(c);
  const p = motor.pool({ worker: true }, 3);
  assert.deepEqual([motor.estado().workersPool, motor.estado().workersPoolVivos, motor.estado().workersCreados], [3, 3, 0]);
  p.terminate();
  p.terminate();
  assert.deepEqual([motor.estado().workersPool, motor.estado().workersPoolVivos], [3, 0]);
  assert.equal(c.terminados, 3);
});
