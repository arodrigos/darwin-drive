import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_META, META_KEY } from "../../src/storage/meta";
import { emptyRankings, KEY_EVOLUTION, KEY_GARAGE, KEY_LINEAGE, KEY_RANKINGS, KEY_SPECIES } from "../../src/storage/schema";
import {
  clavesRegistradas,
  epocaActual,
  leerClave,
  leerGuardado,
  loadAll,
  nuevaEpoca,
  persistente,
  reemplazarTodo,
  registerKey,
  resetStoreConnection,
  save,
  validarEstricto,
} from "../../src/storage/store";

const MENSAJE_SIN_ALMACEN = "Este navegador no deja guardar en el dispositivo: lo que hagas se perderá al cerrar.";
const g = globalThis as { indexedDB?: IDBFactory };
const navegadorOriginal = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const espera = () => new Promise((r) => setTimeout(r, 10));

function conNavegador(storage: unknown): void {
  Object.defineProperty(globalThis, "navigator", { value: { storage }, configurable: true, writable: true });
}

beforeEach(() => {
  g.indexedDB = new IDBFactory();
  resetStoreConnection();
});

afterEach(() => {
  if (navegadorOriginal) Object.defineProperty(globalThis, "navigator", navegadorOriginal);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

// Claves de prueba registradas una vez para todo el fichero (cada fichero corre en su propio proceso).
const KEY_PRUEBA = "test:prueba";
const KEY_ROMPE = "test:rompe";
const KEY_AVISA = "test:avisa";
registerKey(KEY_PRUEBA, (raw) => (typeof raw === "number" ? raw : null), 7, "prueba");
registerKey(KEY_ROMPE, () => {
  throw new Error("validador roto");
}, null);
registerKey(KEY_AVISA, (raw, warn) => {
  if (!Array.isArray(raw)) return null;
  const buenos = raw.filter((x) => typeof x === "string");
  if (buenos.length < raw.length) warn("entrada suelta descartada");
  return buenos;
}, [] as string[], "avisa");

test("registro: clavesRegistradas lista las del juego con su etiqueta y si admiten nulo", () => {
  const claves = clavesRegistradas();
  const porClave = new Map(claves.map((c) => [c.key, c]));
  assert.deepEqual(porClave.get(KEY_RANKINGS), { key: KEY_RANKINGS, label: "ranking", admiteNulo: false });
  assert.deepEqual(porClave.get(KEY_GARAGE), { key: KEY_GARAGE, label: "garaje", admiteNulo: false });
  assert.deepEqual(porClave.get(KEY_EVOLUTION), { key: KEY_EVOLUTION, label: "evolución", admiteNulo: true });
  assert.deepEqual(porClave.get(KEY_LINEAGE), { key: KEY_LINEAGE, label: "linaje", admiteNulo: false });
  assert.deepEqual(porClave.get(KEY_SPECIES), { key: KEY_SPECIES, label: "especies", admiteNulo: false });
  assert.deepEqual(porClave.get(META_KEY), { key: META_KEY, label: "ajustes", admiteNulo: false });
  // Sin etiqueta, la etiqueta es la propia clave.
  assert.deepEqual(porClave.get(KEY_ROMPE), { key: KEY_ROMPE, label: KEY_ROMPE, admiteNulo: true });
});

test("validarEstricto: una clave que no está registrada no se acepta", () => {
  assert.deepEqual(validarEstricto("dd:v1:desconocida", 1), { ok: false });
});

test("validarEstricto: null solo vale en las claves cuyo valor de fábrica es null", () => {
  assert.deepEqual(validarEstricto(KEY_EVOLUTION, null), { ok: true, value: null });
  assert.deepEqual(validarEstricto(KEY_ROMPE, null), { ok: true, value: null });
  assert.deepEqual(validarEstricto(KEY_RANKINGS, null), { ok: false });
  assert.deepEqual(validarEstricto(KEY_PRUEBA, null), { ok: false });
});

test("validarEstricto: acepta lo válido, rechaza lo inválido y lo que el validador no puede leer", () => {
  assert.deepEqual(validarEstricto(KEY_PRUEBA, 42), { ok: true, value: 42 });
  assert.deepEqual(validarEstricto(KEY_PRUEBA, "42"), { ok: false });
  assert.deepEqual(validarEstricto(KEY_ROMPE, { algo: 1 }), { ok: false });
  assert.deepEqual(validarEstricto(KEY_RANKINGS, emptyRankings()), { ok: true, value: emptyRankings() });
});

test("validarEstricto: una sola entrada suelta mala rechaza el valor entero", () => {
  assert.deepEqual(validarEstricto(KEY_AVISA, ["a", "b"]), { ok: true, value: ["a", "b"] });
  assert.deepEqual(validarEstricto(KEY_AVISA, ["a", 3, "b"]), { ok: false });
});

test("loadAll: un validador que lanza descarta la clave, usa el valor de fábrica y avisa con la etiqueta", async () => {
  await save(KEY_ROMPE, { algo: 1 });
  await save(KEY_PRUEBA, "no es un número");
  await save(KEY_AVISA, ["a", 3]);
  const r = await loadAll();
  assert.equal(r.data[KEY_ROMPE], null);
  assert.equal(r.data[KEY_PRUEBA], 7);
  // Al cargar, una entrada suelta mala se descarta sola y se avisa; el resto se queda.
  assert.deepEqual(r.data[KEY_AVISA], ["a"]);
  assert.ok(r.warnings.includes(`Lo guardado en ${KEY_ROMPE} no era válido y se ha descartado.`));
  assert.ok(r.warnings.includes("Lo guardado en prueba no era válido y se ha descartado."));
  assert.ok(r.warnings.includes("entrada suelta descartada"));
  assert.equal(r.available, true);
});

test("leerGuardado: solo trae las claves que existen, ya validadas", async () => {
  assert.deepEqual(await leerGuardado(), {});
  await save(KEY_PRUEBA, 5);
  await save(KEY_AVISA, ["x", 1]);
  await save(KEY_ROMPE, "roto");
  assert.deepEqual(await leerGuardado(), { [KEY_PRUEBA]: 5, [KEY_AVISA]: ["x"], [KEY_ROMPE]: null });
});

test("save: null y undefined borran la clave", async () => {
  await save(KEY_PRUEBA, 3);
  assert.equal(await leerClave(KEY_PRUEBA), 3);
  await save(KEY_PRUEBA, null);
  assert.equal(await leerClave(KEY_PRUEBA), undefined);
  await save(KEY_PRUEBA, 4);
  await save(KEY_PRUEBA, undefined);
  assert.equal(await leerClave(KEY_PRUEBA), undefined);
});

test("sin IndexedDB: se guarda en memoria, loadAll avisa y dice que no hay almacén", async () => {
  delete g.indexedDB;
  resetStoreConnection();
  await save(KEY_PRUEBA, 11);
  assert.equal(await leerClave(KEY_PRUEBA), 11);
  const r = await loadAll();
  assert.equal(r.available, false);
  assert.equal(r.data[KEY_PRUEBA], 11);
  assert.deepEqual(r.data[META_KEY], DEFAULT_META);
  assert.ok(r.warnings.includes(MENSAJE_SIN_ALMACEN));
  await save(KEY_PRUEBA, null);
  assert.equal(await leerClave(KEY_PRUEBA), undefined);
});

test("sin IndexedDB: resetStoreConnection olvida la memoria, como una pestaña nueva", async () => {
  delete g.indexedDB;
  resetStoreConnection();
  await save(KEY_PRUEBA, 12);
  resetStoreConnection();
  assert.equal(await leerClave(KEY_PRUEBA), undefined);
});

test("persistencia: tras guardar se pide una sola vez por pestaña si aún no es persistente", async () => {
  let pedidas = 0;
  conNavegador({ persisted: async () => false, persist: async () => (pedidas++, true) });
  await save(KEY_PRUEBA, 1);
  await espera();
  await save(KEY_PRUEBA, 2);
  await espera();
  assert.equal(pedidas, 1);
  resetStoreConnection();
  await save(KEY_PRUEBA, 3);
  await espera();
  assert.equal(pedidas, 2);
});

test("persistencia: si ya es persistente no se vuelve a pedir", async () => {
  let pedidas = 0;
  conNavegador({ persisted: async () => true, persist: async () => (pedidas++, true) });
  await save(KEY_PRUEBA, 1);
  await espera();
  assert.equal(pedidas, 0);
});

test("persistencia: sin persisted se pide directamente; un rechazo o una API ausente no rompen el guardado", async () => {
  let pedidas = 0;
  conNavegador({ persist: async () => (pedidas++, true) });
  await save(KEY_PRUEBA, 1);
  await espera();
  assert.equal(pedidas, 1);

  resetStoreConnection();
  conNavegador({ persisted: async () => false, persist: async () => Promise.reject(new Error("denegado")) });
  await save(KEY_PRUEBA, 2);
  await espera();

  resetStoreConnection();
  conNavegador(undefined);
  await save(KEY_PRUEBA, 3);
  await espera();
  assert.equal(await leerClave(KEY_PRUEBA), 3);
});

test("persistente: dice lo que contesta el navegador o «unknown» si no puede saberlo", async () => {
  conNavegador({ persisted: async () => true });
  assert.equal(await persistente(), true);
  conNavegador({ persisted: async () => false });
  assert.equal(await persistente(), false);
  conNavegador({});
  assert.equal(await persistente(), "unknown");
  conNavegador(undefined);
  assert.equal(await persistente(), "unknown");
  conNavegador({ persisted: async () => Promise.reject(new Error("no")) });
  assert.equal(await persistente(), "unknown");
});

test("época: nuevaEpoca y reemplazarTodo la avanzan; guardar una clave suelta no", async () => {
  const e0 = epocaActual();
  nuevaEpoca();
  assert.equal(epocaActual(), e0 + 1);
  await save(KEY_PRUEBA, 1);
  assert.equal(epocaActual(), e0 + 1);
  await reemplazarTodo({});
  assert.equal(epocaActual(), e0 + 2);
});

test("reemplazarTodo: escribe lo que trae la copia y borra las claves registradas que no vengan", async () => {
  await save(KEY_PRUEBA, 1);
  await save(KEY_AVISA, ["a"]);
  await reemplazarTodo({ [KEY_AVISA]: ["b"] });
  assert.equal(await leerClave(KEY_PRUEBA), undefined);
  assert.deepEqual(await leerClave(KEY_AVISA), ["b"]);
});
