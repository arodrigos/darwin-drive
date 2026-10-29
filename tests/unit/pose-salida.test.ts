import test from "node:test";
import assert from "node:assert/strict";
import { poseSalida } from "../../src/game/pose-salida";
import { STOCK_CAR } from "../../src/sim/genome";
import { createRace } from "../../src/sim/race";

test("la pose de salida del hilo principal coincide con la t=0 del núcleo (sin salto al llegar la del Worker)", () => {
  const cars = [{ carId: "a", genome: STOCK_CAR }];
  const esperada = createRace(cars, "cordillera");
  const poses = esperada.poses();
  esperada.dispose();
  assert.deepEqual(poseSalida(cars, "cordillera"), poses);
});
