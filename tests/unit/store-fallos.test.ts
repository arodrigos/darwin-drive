import "fake-indexeddb/auto";
import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { STOCK_CAR } from "../../src/sim/genome";
import { KEY_GARAGE, KEY_RANKINGS, type SavedCar } from "../../src/storage/schema";
import { ErrorSinAlmacen, almacenDisponible, leerGuardado, loadAll, reemplazarTodo, resetStoreConnection, save, saveToGarage } from "../../src/storage/store";

// #167: un error suelto de IndexedDB dejaba la pestaña trabajando sobre un Map vacío.

const original = IDBDatabase.prototype.transaction;
/** Las próximas `n` transacciones fallan (Infinity: todas), como una conexión perdida o una cuota llena. */
function fallarTransacciones(n: number): void {
  let quedan = n;
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof original>) {
    if (quedan > 0) {
      quedan -= 1;
      throw new DOMException("conexión cerrada", "InvalidStateError");
    }
    return original.apply(this, args);
  } as typeof original;
}

const coche = (n: number): SavedCar => ({ id: `g${n}`, name: `Coche ${n}`, genome: STOCK_CAR, marks: {}, origin: "diseño", savedAt: "2026-10-02T09:00:00.000Z" });
const garaje = async () => ((await loadAll()).data[KEY_GARAGE] as SavedCar[]).map((c) => c.id);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStoreConnection();
});
afterEach(() => {
  IDBDatabase.prototype.transaction = original;
});

test("#167 un fallo pasajero se reintenta reabriendo la conexión: se sigue leyendo y guardando en el dispositivo", async () => {
  await saveToGarage(coche(1));
  resetStoreConnection();
  fallarTransacciones(2);
  const r = await loadAll();
  assert.equal(r.available, true);
  assert.deepEqual((r.data[KEY_GARAGE] as SavedCar[]).map((c) => c.id), ["g1"]);
  fallarTransacciones(1);
  await saveToGarage(coche(2));
  assert.equal(almacenDisponible(), true);
  // Pestaña nueva: lo escrito tras el fallo está en IndexedDB, no solo en memoria.
  resetStoreConnection();
  assert.deepEqual(await garaje(), ["g1", "g2"]);
});

test("#167 si IndexedDB sigue fallando se pasa a memoria con lo último leído, no con datos vacíos, y lo guardado queda intacto", async () => {
  await saveToGarage(coche(1));
  await saveToGarage(coche(2));
  assert.deepEqual(await garaje(), ["g1", "g2"]);
  fallarTransacciones(Infinity);
  await saveToGarage(coche(3));
  const r = await loadAll();
  assert.equal(r.available, false);
  assert.match(r.warnings.join(" "), /no deja guardar/);
  // El cambio se aplica sobre lo que había, no sobre un garaje vacío.
  assert.deepEqual((r.data[KEY_GARAGE] as SavedCar[]).map((c) => c.id), ["g1", "g2", "g3"]);
  // Ni exportar una copia desde memoria ni dar por guardada una importación.
  await assert.rejects(leerGuardado(), ErrorSinAlmacen);
  assert.equal(await reemplazarTodo({ [KEY_GARAGE]: [coche(9)] }), false);
  assert.deepEqual(await garaje(), ["g9"]);
  // Al recargar la pestaña vuelve lo que había en IndexedDB, sin tocar.
  IDBDatabase.prototype.transaction = original;
  resetStoreConnection();
  assert.equal((await loadAll()).available, true);
  assert.deepEqual(await garaje(), ["g1", "g2"]);
});

test("#167 importar una copia con IndexedDB disponible la guarda de una vez y lo dice", async () => {
  await saveToGarage(coche(1));
  await save(KEY_RANKINGS, null);
  assert.equal(await reemplazarTodo({ [KEY_GARAGE]: [coche(5)] }), true);
  resetStoreConnection();
  assert.deepEqual(await garaje(), ["g5"]);
  assert.deepEqual(Object.keys(await leerGuardado()), [KEY_GARAGE]);
});

test("#167 si la importación no llega a IndexedDB, lo que había allí sigue intacto", async () => {
  await saveToGarage(coche(1));
  fallarTransacciones(Infinity);
  assert.equal(await reemplazarTodo({ [KEY_GARAGE]: [coche(7)] }), false);
  IDBDatabase.prototype.transaction = original;
  resetStoreConnection();
  assert.deepEqual(await garaje(), ["g1"]);
});
