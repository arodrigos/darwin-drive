import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash } from "../../src/sim/genome";
import { getTrack, TRACKS, type TrackId } from "../../src/sim/tracks";
import { aplicarMarca } from "../../src/storage/marcas";
import { leerMigrables, trabajoPendiente } from "../../src/storage/migracion";
import { type SavedCar } from "../../src/storage/schema";
import { recordMark, resetStoreConnection, saveToGarage } from "../../src/storage/store";
import { seededGenomes } from "./helpers/rng";

const GENOMES = seededGenomes(41, 4);
const vigente = (t: TrackId) => ({ trackVersion: getTrack(t)!.version, physicsVersion: PHYSICS_VERSION });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
});

function coche(marks: SavedCar["marks"], markVersions?: SavedCar["markVersions"]): SavedCar {
  const car: SavedCar = { id: genomeHash(GENOMES[0]), name: "A", genome: GENOMES[0], marks, origin: "diseño", savedAt: "2026-10-01T10:00:00.000Z" };
  if (markVersions) car.markVersions = markVersions;
  return car;
}

async function pendientes(): Promise<number> {
  return trabajoPendiente(await leerMigrables()).length;
}

test("mig-garaje-1: guardar con las versiones de 2-4 rankings vigentes no deja trabajo de migración", async () => {
  let base: Pick<SavedCar, "marks" | "markVersions"> | undefined;
  for (const t of TRACKS.slice(0, 4)) base = aplicarMarca(base, t.id, 10 + t.version, vigente(t.id));
  await saveToGarage(coche(base!.marks, base!.markVersions));
  assert.equal(await pendientes(), 0);
});

test("mig-garaje-2: recordMark seguido de un re-guardado sin versiones (Guardar campeón) no la borra", async () => {
  const t = TRACKS[0].id;
  await saveToGarage(coche({}));
  await recordMark(genomeHash(GENOMES[0]), t, 12, vigente(t));
  assert.equal(await pendientes(), 0);
  // El re-guardado reemplaza el coche con las mismas marcas pero sin markVersions.
  const [guardado] = (await leerMigrables()).garage;
  await saveToGarage({ ...guardado, name: "B", markVersions: undefined });
  const [tras] = (await leerMigrables()).garage;
  assert.equal(tras.name, "B");
  assert.deepEqual(tras.markVersions?.[t], vigente(t));
  assert.equal(await pendientes(), 0);
});

test("mig-garaje-3: una marca sin versión de verdad antigua sigue migrándose", async () => {
  await saveToGarage(coche({ [TRACKS[0].id]: 5 }));
  assert.equal(await pendientes(), 1);
});

test("invariante: aplicarMarca siempre deja versión en cada marca que escribe y nunca mezcla versiones en el máximo", () => {
  const pista = fc.constantFrom(...TRACKS.map((t) => t.id));
  const versiones = fc.record({ trackVersion: fc.integer({ min: 0, max: 4 }), physicsVersion: fc.integer({ min: 0, max: 4 }) });
  fc.assert(
    fc.property(fc.array(fc.tuple(pista, fc.integer({ min: 0, max: 500 }), versiones), { minLength: 1, maxLength: 12 }), (pasos) => {
      let base: Pick<SavedCar, "marks" | "markVersions"> | undefined;
      for (const [t, d, v] of pasos) {
        base = aplicarMarca(base, t, d, v);
        assert.ok(base.markVersions?.[t]);
        assert.ok(base.marks[t] !== undefined);
      }
      for (const t of Object.keys(base!.marks) as TrackId[]) assert.ok(base!.markVersions?.[t]);
      // Si todas las escrituras de una pista comparten versión, la marca es el máximo de ellas.
      for (const t of new Set(pasos.map((p) => p[0]))) {
        const delaPista = pasos.filter((p) => p[0] === t);
        if (delaPista.every((p) => p[2].trackVersion === delaPista[0][2].trackVersion && p[2].physicsVersion === delaPista[0][2].physicsVersion)) {
          assert.equal(base!.marks[t], Math.max(...delaPista.map((p) => p[1])));
        }
      }
    }),
  );
});
