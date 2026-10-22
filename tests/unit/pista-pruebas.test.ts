import test from "node:test";
import assert from "node:assert/strict";
import { createRace } from "../../src/sim/race";
import { STOCK_CAR } from "../../src/sim/genome";
import { getTrack, PRUEBAS_LLANA_ID, resolverPista, TRACKS } from "../../src/sim/tracks";

test("cla-5 la llana de pruebas se simula pero no es una pista del juego", () => {
  assert.equal(getTrack(PRUEBAS_LLANA_ID), null);
  assert.equal(TRACKS.some((t) => (t.id as string) === PRUEBAS_LLANA_ID), false);
  const pista = resolverPista(PRUEBAS_LLANA_ID);
  assert.ok(pista);
  assert.equal(pista.heightAt(2500), 0);
  assert.equal(resolverPista("desconocida"), null);
  assert.doesNotThrow(() => createRace([{ carId: "a", genome: STOCK_CAR }], PRUEBAS_LLANA_ID as never));
});
