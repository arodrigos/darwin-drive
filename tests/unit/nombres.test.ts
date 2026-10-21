import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { genomeHash } from "../../src/sim/genome";
import { getTrack, type TrackId } from "../../src/sim/tracks";
import { nombrePropuesto, fichaOrigen } from "../../src/app/nombres";
import { MAX_NOMBRE, normalizarNombre } from "../../src/storage/nombres";
import { COPIA_FORMAT, validarCopia } from "../../src/storage/copia";
import { emptyRankings, KEY_GARAGE, KEY_RANKINGS, type RankingEntry, type SavedCar } from "../../src/storage/schema";
import { loadAll, renombrarCoche, resetStoreConnection, save, saveToGarage } from "../../src/storage/store";
import { seededGenomes } from "./helpers/rng";

const GENOMAS = seededGenomes(77, 20);
const PROHIBIDO = /[\p{Cc}\p{Cf}]/u;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
});

// Cadenas con los caracteres que importan: controles, U+202E, U+2066, U+200B, ZWJ, espacios y emoji.
const textoSucio = fc.string({ unit: fc.oneof(fc.string({ minLength: 1, maxLength: 1 }), fc.constantFrom("‮", "⁦", "​", "‍", "\u0007", "\u0000", "\n", "\t", " ", "😀", "é", "﻿")), maxLength: 120 });

test("normalizarNombre es idempotente, corta a 40 puntos de código, no deja Cc ni Cf y nunca devuelve vacío", () => {
  fc.assert(
    fc.property(textoSucio, textoSucio, (s, propuesto) => {
      const n = normalizarNombre(s, propuesto);
      assert.equal(normalizarNombre(n, propuesto), n);
      assert.ok(Array.from(n).length <= MAX_NOMBRE);
      assert.ok(!PROHIBIDO.test(n));
      assert.ok(n.length > 0);
      assert.equal(n, n.trim());
    }),
    { numRuns: 400 },
  );
});

test("normalizarNombre: casos concretos del diseño", () => {
  assert.equal(normalizarNombre("  Limpet\u0007‮ 2  ", "x"), "Limpet 2");
  assert.equal(normalizarNombre("a".repeat(60), "x"), "a".repeat(40));
  assert.equal(normalizarNombre("   ", "Propuesto Uno"), "Propuesto Uno");
  assert.equal(normalizarNombre("<img src=x onerror=alert(1)>", "p"), "<img src=x onerror=alert(1)>");
  // Un emoji (dos unidades UTF-16) no se parte al cortar.
  assert.equal(Array.from(normalizarNombre("😀".repeat(50), "p")).length, 40);
});

test("nombrePropuesto es pura y da entre 3 y 40 caracteres", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 64 }), (h) => {
      const a = nombrePropuesto(h);
      assert.equal(a, nombrePropuesto(h));
      assert.ok(a.length >= 3 && a.length <= 40);
      assert.ok(!PROHIBIDO.test(a));
    }),
    { numRuns: 300 },
  );
});

test("fichaOrigen no falla con datos que faltan", () => {
  assert.equal(fichaOrigen("evolución", { generation: 7, trackId: "cordillera" }), "Evolucionado en La Cordillera · gen 7");
  assert.equal(fichaOrigen("evolución", null), "Evolucionado");
  assert.equal(fichaOrigen("diseño", null), "Diseñado en el Taller");
  assert.equal(fichaOrigen("mixto", null), "Mezcla de diseño y evolución");
});

function coche(n: number, name: string): SavedCar {
  const genome = GENOMAS[n];
  return { id: genomeHash(genome), name, genome, marks: { rampa: 12.5 }, origin: "evolución", savedAt: "2026-10-02T09:00:00.000Z" };
}

function fila(n: number, trackId: TrackId, date: string, name?: string): RankingEntry {
  const genome = GENOMAS[n];
  const e: RankingEntry = {
    carId: genomeHash(genome),
    genome,
    genomeHash: genomeHash(genome),
    distance: 100 + n,
    origin: "evolución",
    date,
    trackId,
    trackVersion: getTrack(trackId)!.version,
    physicsVersion: PHYSICS_VERSION,
  };
  if (name) e.name = name;
  return e;
}

test("renombrarCoche cambia coche y filas de ranking sin tocar fechas, genoma ni marcas", async () => {
  const uno = coche(0, "Diseño 3");
  const otro = coche(1, "Otro");
  await saveToGarage(uno);
  await saveToGarage(otro);
  const r = { ...emptyRankings(), rampa: [fila(0, "rampa", "2026-10-01T10:00:00.000Z", "Diseño 3"), fila(1, "rampa", "2026-10-03T10:00:00.000Z")], dunas: [fila(0, "dunas", "2026-10-02T10:00:00.000Z")] };
  await save(KEY_RANKINGS, r);
  const antes = (await loadAll()).data;

  const final = await renombrarCoche(uno.id, "  Limpet\u0007‮ 2  ");
  assert.equal(final, "Limpet 2");
  const despues = (await loadAll()).data;
  const garaje = despues[KEY_GARAGE] as SavedCar[];
  assert.equal(garaje.find((c) => c.id === uno.id)!.name, "Limpet 2");
  assert.equal(garaje.find((c) => c.id === otro.id)!.name, "Otro");
  assert.deepEqual({ ...garaje.find((c) => c.id === uno.id)!, name: "" }, { ...(antes[KEY_GARAGE] as SavedCar[]).find((c) => c.id === uno.id)!, name: "" });
  const rk = despues[KEY_RANKINGS] as ReturnType<typeof emptyRankings>;
  const antesRk = antes[KEY_RANKINGS] as ReturnType<typeof emptyRankings>;
  for (const t of ["rampa", "dunas"] as const) {
    for (const e of rk[t]) {
      const previa = antesRk[t].find((x) => x.genomeHash === e.genomeHash)!;
      assert.equal(e.date, previa.date);
      assert.deepEqual(e.genome, previa.genome);
      assert.equal(e.name, e.genomeHash === uno.id ? "Limpet 2" : undefined);
    }
  }
});

test("renombrarCoche: solo espacios deja el propuesto y 60 caracteres quedan en 40", async () => {
  const uno = coche(2, "Antes");
  await saveToGarage(uno);
  assert.equal(await renombrarCoche(uno.id, "   "), nombrePropuesto(uno.id));
  assert.equal(await renombrarCoche(uno.id, "z".repeat(60)), "z".repeat(40));
});

test("para cualquier secuencia de guardar y renombrar el garaje no repite genomeHash", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.tuple(fc.constantFrom("guardar", "renombrar"), fc.integer({ min: 0, max: 3 }), textoSucio), { maxLength: 12 }), async (pasos) => {
      globalThis.indexedDB = new IDBFactory();
      resetStoreConnection();
      for (const [accion, n, texto] of pasos) {
        const c = coche(n, normalizarNombre(texto, "Base"));
        if (accion === "guardar") await saveToGarage(c);
        else await renombrarCoche(c.id, texto);
      }
      const garaje = ((await loadAll()).data[KEY_GARAGE] as SavedCar[] | undefined) ?? [];
      assert.equal(new Set(garaje.map((c) => c.id)).size, garaje.length);
      for (const c of garaje) assert.ok(c.name.length > 0 && !PROHIBIDO.test(c.name));
    }),
    { numRuns: 25 },
  );
});

test("importar una copia: los nombres de SavedCar y RankingEntry pasan por normalizarNombre", () => {
  const sucio = "‮" + "x".repeat(100) + "\u0007".repeat(5) + "y".repeat(100);
  const copia = {
    format: COPIA_FORMAT,
    v: 1,
    exportedAt: "2026-10-20T10:00:00.000Z",
    data: { [KEY_GARAGE]: [coche(3, sucio)], [KEY_RANKINGS]: { ...emptyRankings(), rampa: [fila(3, "rampa", "2026-10-01T10:00:00.000Z", sucio)] } },
  };
  const r = validarCopia(JSON.stringify(copia));
  assert.ok(r.ok);
  const garaje = r.data[KEY_GARAGE] as SavedCar[];
  assert.equal(garaje[0].name, "x".repeat(40));
  const rk = r.data[KEY_RANKINGS] as ReturnType<typeof emptyRankings>;
  assert.equal(rk.rampa[0].name, "x".repeat(40));
});
