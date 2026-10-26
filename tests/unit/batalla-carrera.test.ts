import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { avisoGuardado, filasMarcador, flechasBorde, idCocheBatalla, jugadorDeCoche, resultadoCrudo } from "../../src/batalla/carrera";
import type { CarPose } from "../../src/sim/constants";
import { createRace, simulateCar } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { seededGenomes } from "./helpers/rng";

const pose = (jugador: number, x: number, finished = false) => ({ carId: idCocheBatalla(jugador), x, finished }) as unknown as CarPose;

test("bc-4 la carrera de varios coches da a cada uno lo mismo que correr solo, aunque dos jugadores lleven el mismo diseño", () => {
  const [a, b] = seededGenomes(5, 2);
  const coches = [a, b, a].map((genome, i) => ({ carId: idCocheBatalla(i), genome }));
  const race = createRace(coches, "rampa");
  while (!race.done()) race.step(60);
  const multi = race.results();
  race.dispose();
  assert.equal(multi.length, 3);
  for (const r of multi) {
    const solo = simulateCar(coches[jugadorDeCoche(r.carId)].genome, "rampa");
    assert.equal(r.distance, solo.distance);
    assert.equal(r.bestStep, solo.bestStep);
  }
  assert.equal(multi[0].distance, multi[2].distance);
});

test("bc-4 el marcador siempre va de más lejos a menos y la distancia de cada jugador nunca baja", () => {
  fc.assert(
    fc.property(fc.array(fc.array(fc.double({ min: -50, max: 5000, noNaN: true }), { minLength: 3, maxLength: 3 }), { minLength: 1, maxLength: 20 }), (cuadros) => {
      const maximos = new Map<number, number>();
      const previo = [0, 0, 0];
      for (const c of cuadros) {
        const filas = filasMarcador(c.map((x, i) => pose(i, x)), maximos);
        assert.equal(filas.length, 3);
        for (let k = 1; k < filas.length; k++) assert.ok(filas[k - 1].distancia >= filas[k].distancia);
        for (const f of filas) {
          assert.ok(f.distancia >= previo[f.jugador]);
          previo[f.jugador] = f.distancia;
        }
      }
    }),
  );
});

test("bc-4 las flechas solo salen para los coches fuera de pantalla y lo que falta nunca es negativo", () => {
  fc.assert(
    fc.property(fc.array(fc.double({ min: 0, max: 3000, noNaN: true }), { minLength: 2, maxLength: 4 }), fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }), (xs, fuera) => {
      const filas = filasMarcador(xs.map((x, i) => pose(i, x)), new Map());
      const dentro = new Set(xs.map((_, i) => i).filter((i) => fuera[i]));
      const fl = flechasBorde(filas, dentro);
      assert.deepEqual(new Set(fl.map((f) => f.jugador)), dentro);
      for (const f of fl) assert.ok(f.falta >= 0);
    }),
  );
});

test("bc-5 el aviso de «Guardar todos» cuenta lo guardado, lo que ya estaba y lo que no cabe", () => {
  assert.equal(avisoGuardado(3, 0, 0), "3 coches guardados en el garaje");
  assert.equal(avisoGuardado(1, 1, 0), "1 coche guardado en el garaje · 1 ya estaba");
  assert.equal(avisoGuardado(0, 0, 2), "0 coches guardados en el garaje · 2 no caben: el garaje está lleno");
});

test("bc-3 el resultado crudo conserva el id del jugador", () => {
  const r = simulateCar(STOCK_CAR, "rampa");
  const crudo = resultadoCrudo({ ...r, carId: idCocheBatalla(2) });
  assert.equal(crudo.jugador, 2);
  assert.equal(crudo.distance, r.distance);
});
