import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { marcaFantasma, mejorMarcaGaraje, repeticionDisponible, resultadoFiel } from "../../src/app/repeticion";
import { PHYSICS_VERSION, type CarResult } from "../../src/sim/constants";
import { STOCK_CAR } from "../../src/sim/genome";
import { TRACKS } from "../../src/sim/tracks";
import type { RankingEntry, SavedCar } from "../../src/storage/schema";

const pista = TRACKS[0];

function entrada(over: Partial<RankingEntry> = {}): RankingEntry {
  return {
    carId: "a",
    genome: STOCK_CAR,
    genomeHash: "h",
    distance: 30,
    bestStep: 3000,
    piezasPerdidas: 0,
    causaParada: null,
    origin: "diseño",
    date: "2026-10-28T00:00:00.000Z",
    trackId: pista.id,
    trackVersion: pista.version,
    physicsVersion: PHYSICS_VERSION,
    ...over,
  };
}

test("fa-1 repeticionDisponible: solo con las versiones de hoy, medida y sin migración", () => {
  assert.equal(repeticionDisponible(entrada(), pista, false), true);
  assert.equal(repeticionDisponible(undefined, pista, false), false);
  assert.equal(repeticionDisponible(entrada(), pista, true), false);
  assert.equal(repeticionDisponible(entrada({ bestStep: undefined }), pista, false), false);
});

test("fa-1 property: cualquier versión distinta de pista o física desactiva la repetición", () => {
  fc.assert(
    fc.property(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 }), (dt, dp) => {
      const e = entrada({ trackVersion: pista.version + dt, physicsVersion: PHYSICS_VERSION + dp });
      assert.equal(repeticionDisponible(e, pista, false), dt === 0 && dp === 0);
    }),
  );
});

test("fa-7 property: resultadoFiel exige distancia, tiempo y causa idénticos", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 100, noNaN: true }),
      fc.integer({ min: 0, max: 5000 }),
      fc.integer({ min: -2, max: 2 }),
      fc.constantFrom("stall" as const, null),
      (distance, bestStep, dStep, causa) => {
        const marca = { distance, bestStep, causaParada: causa };
        const r = { distance, bestStep: bestStep + dStep, causaParada: causa } as CarResult;
        assert.equal(resultadoFiel(r, marca), dStep === 0);
        assert.equal(resultadoFiel({ ...r, bestStep, distance: distance + 1e-3 }, marca), false);
        assert.equal(resultadoFiel({ ...r, bestStep, causaParada: causa === null ? "stall" : null }, marca), false);
      },
    ),
  );
});

test("fa-7 resultadoFiel: una marca sin tiempo guardado nunca es fiel", () => {
  assert.equal(resultadoFiel({ distance: 1, bestStep: 5, causaParada: null } as CarResult, { distance: 1 }), false);
});

test("fa-2 marcaFantasma: la primera reproducible de la lista", () => {
  const vieja = entrada({ carId: "v", trackVersion: pista.version + 1 });
  const buena = entrada({ carId: "b", distance: 20 });
  assert.equal(marcaFantasma([vieja, buena], pista, false)?.carId, "b");
  assert.equal(marcaFantasma([vieja], pista, false), undefined);
  assert.equal(marcaFantasma(undefined, pista, false), undefined);
});

function coche(over: Partial<SavedCar> = {}): SavedCar {
  return {
    marks: { [pista.id]: 30 },
    markVersions: { [pista.id]: { trackVersion: pista.version, physicsVersion: PHYSICS_VERSION } },
    markDetails: { [pista.id]: { bestStep: 3000, piezasPerdidas: 0, causaParada: null } },
    ...over,
  } as SavedCar;
}

test("fa-6 mejorMarcaGaraje: toma la mejor reproducible y descarta lo anterior al versionado", () => {
  assert.equal(mejorMarcaGaraje(coche(), false)?.trackId, pista.id);
  assert.equal(mejorMarcaGaraje(coche(), true), null);
  assert.equal(mejorMarcaGaraje(coche({ markVersions: undefined }), false), null);
  assert.equal(mejorMarcaGaraje(coche({ markDetails: undefined }), false), null);
  const vieja = coche({ markVersions: { [pista.id]: { trackVersion: pista.version + 1, physicsVersion: PHYSICS_VERSION } } });
  assert.equal(mejorMarcaGaraje(vieja, false), null);
});
