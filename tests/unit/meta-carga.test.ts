import { IDBFactory } from "fake-indexeddb";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, get, set } from "idb-keyval";
import { DEFAULT_META, loadMeta, META_KEY, saveMeta, type Meta } from "../../src/storage/meta";

// meta.ts guarda su conexión en el propio módulo y no tiene reinicio: los tests van en orden.
// Primero sin IndexedDB (navegador que no deja guardar) y después con una base falsa.

const MENSAJE_SIN_ALMACEN = "Este navegador no deja guardar en el dispositivo: lo que hagas se perderá al cerrar.";
const g = globalThis as { indexedDB?: IDBFactory };

test("meta sin IndexedDB: loadMeta da la meta por defecto, avisa y dice que no hay almacén", async () => {
  delete g.indexedDB;
  const r = await loadMeta();
  assert.deepEqual(r.meta, DEFAULT_META);
  assert.equal(r.available, false);
  assert.equal(r.warning, MENSAJE_SIN_ALMACEN);
});

test("meta sin IndexedDB: saveMeta no lanza y lo guardado sobrevive en memoria hasta cerrar", async () => {
  delete g.indexedDB;
  const meta: Meta = { seenHelp: ["taller"], persistRequested: true, lastTrack: "dunas", ritmo: "x4", sonido: true };
  await saveMeta(meta);
  const r = await loadMeta();
  assert.deepEqual(r.meta, meta);
  assert.equal(r.available, false);
  assert.equal(r.warning, MENSAJE_SIN_ALMACEN);
});

test("meta con IndexedDB: sin nada guardado da la meta por defecto y sin aviso", async () => {
  g.indexedDB = new IDBFactory();
  const r = await loadMeta();
  assert.deepEqual(r, { meta: DEFAULT_META, warning: null, available: true });
});

test("meta con IndexedDB: lo que guarda saveMeta lo devuelve loadMeta", async () => {
  const meta: Meta = { seenHelp: ["pista", "linaje"], persistRequested: false, lastTrack: "glaciar", ritmo: "x8", sonido: false };
  await saveMeta(meta);
  const r = await loadMeta();
  assert.deepEqual(r, { meta, warning: null, available: true });
});

test("meta con IndexedDB: una meta guardada inválida se descarta, se borra y se avisa", async () => {
  // La misma base que abre meta.ts fuera del modo pruebas.
  const almacen = createStore("keyval-store", "keyval");
  await set(META_KEY, { seenHelp: "no es una lista", persistRequested: true, lastTrack: "rampa" }, almacen);
  const r = await loadMeta();
  assert.deepEqual(r.meta, DEFAULT_META);
  assert.equal(r.available, true);
  assert.equal(r.warning, "Los ajustes guardados no eran válidos y se han descartado.");
  assert.equal(await get(META_KEY, almacen), undefined);
  // Ya borrada, la siguiente carga no vuelve a avisar.
  assert.deepEqual(await loadMeta(), { meta: DEFAULT_META, warning: null, available: true });
});

test("meta con IndexedDB: una meta guardada se normaliza al cargar (recorta seenHelp a 50)", async () => {
  const almacen = createStore("keyval-store", "keyval");
  const seenHelp = Array.from({ length: 80 }, (_, i) => `ayuda-${i}`);
  await set(META_KEY, { seenHelp, persistRequested: true, lastTrack: "rampa", ritmo: "turbo", sonido: "sí" }, almacen);
  const r = await loadMeta();
  assert.equal(r.warning, null);
  assert.deepEqual(r.meta, { seenHelp: seenHelp.slice(0, 50), persistRequested: true, lastTrack: "rampa", ritmo: "x1", sonido: false });
});
