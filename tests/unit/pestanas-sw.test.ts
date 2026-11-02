import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  contarActuales,
  contarPestanasAbiertas,
  pestanasAntiguas,
  recargarAntiguas,
  saludar,
  VERSION_DATOS,
} from "../../src/pwa/pestanas";

const CANAL = "dd:pestanas";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

const navegadorOriginal = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const canalOriginal = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");

afterEach(() => {
  if (navegadorOriginal) Object.defineProperty(globalThis, "navigator", navegadorOriginal);
  else delete (globalThis as { navigator?: unknown }).navigator;
  if (canalOriginal) Object.defineProperty(globalThis, "BroadcastChannel", canalOriginal);
});

/** Un service worker de mentira que contesta por el puerto lo que se le diga (o nada). */
function conServiceWorker(contestar: ((puerto: MessagePort) => void) | null): { mensajes: unknown[] } {
  const mensajes: unknown[] = [];
  const controller = {
    postMessage(msg: unknown, puertos: MessagePort[]) {
      mensajes.push(msg);
      if (contestar) contestar(puertos[0]);
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: { controller } }, configurable: true, writable: true });
  return { mensajes };
}

function sinBroadcastChannel(): void {
  Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true, writable: true });
}

test("mig-9: sin service worker que controle la pestaña no se sabe cuántas hay abiertas (null)", async () => {
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  assert.equal(await contarPestanasAbiertas(20), null);
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: { controller: null } }, configurable: true, writable: true });
  assert.equal(await contarPestanasAbiertas(20), null);
});

test("mig-9: el service worker contesta cuántos clientes hay y se le pregunta con dd:clientes", async () => {
  const sw = conServiceWorker((p) => {
    p.postMessage({ clientes: 4 });
    p.close();
  });
  assert.equal(await contarPestanasAbiertas(500), 4);
  assert.deepEqual(sw.mensajes, [{ type: "dd:clientes" }]);
});

test("mig-9: una respuesta del service worker sin número cuenta como no saber (null)", async () => {
  for (const respuesta of [{}, { clientes: "4" }, null, "hola"]) {
    conServiceWorker((p) => {
      p.postMessage(respuesta);
      p.close();
    });
    assert.equal(await contarPestanasAbiertas(500), null, JSON.stringify(respuesta));
  }
});

test("mig-9: un service worker que no contesta (versión antigua) da null al vencer la espera", async () => {
  // No contesta; cerrar el puerto solo evita que el canal deje vivo el proceso de los tests.
  conServiceWorker((p) => setTimeout(() => p.close(), 60));
  const t0 = Date.now();
  assert.equal(await contarPestanasAbiertas(30), null);
  assert.ok(Date.now() - t0 >= 25);
});

test("mig-9: pestanasAntiguas resta a las abiertas las que saludan con esta versión", async () => {
  conServiceWorker((p) => {
    p.postMessage({ clientes: 3 });
    p.close();
  });
  const quitar = saludar(() => {});
  // Abiertas 3 (según el service worker), actuales 2 (esta y la que saluda): 1 antigua.
  assert.equal(await pestanasAntiguas(), 1);
  quitar();
});

test("mig-9: sin service worker pestanasAntiguas no bloquea la migración (0)", async () => {
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  assert.equal(await pestanasAntiguas(), 0);
});

test("mig-9: una pestaña que contesta con una versión anterior no cuenta como actual", async () => {
  const antigua = new BroadcastChannel(CANAL);
  antigua.onmessage = (e: MessageEvent<{ t: string }>) => {
    if (e.data.t === "hola") antigua.postMessage({ t: "aqui", v: VERSION_DATOS - 1 });
  };
  const futura = new BroadcastChannel(CANAL);
  futura.onmessage = (e: MessageEvent<{ t: string }>) => {
    if (e.data.t === "hola") futura.postMessage({ t: "aqui", v: VERSION_DATOS + 1 });
  };
  // La propia más la de una versión posterior; la anterior no.
  assert.equal(await contarActuales(80), 2);
  antigua.close();
  futura.close();
});

test("mig-9: una petición de recarga de una versión posterior sí recarga esta pestaña", async () => {
  let recargas = 0;
  const quitar = saludar(() => recargas++);
  const nueva = new BroadcastChannel(CANAL);
  nueva.postMessage({ t: "recargar", v: VERSION_DATOS + 1 });
  nueva.postMessage({ t: "recargar", v: VERSION_DATOS });
  await espera(50);
  assert.equal(recargas, 1);
  nueva.close();
  quitar();
});

test("mig-9: tras dejar de escuchar, la pestaña ya no contesta ni se recarga", async () => {
  let recargas = 0;
  saludar(() => recargas++)();
  const nueva = new BroadcastChannel(CANAL);
  nueva.postMessage({ t: "recargar", v: VERSION_DATOS + 1 });
  await espera(50);
  nueva.close();
  assert.equal(recargas, 0);
  assert.equal(await contarActuales(50), 1);
});

test("mig-9: sin BroadcastChannel se cuenta solo la propia y saludar/recargar no hacen nada", async () => {
  sinBroadcastChannel();
  assert.equal(await contarActuales(10_000), 1);
  assert.doesNotThrow(() => recargarAntiguas());
  let recargas = 0;
  const quitar = saludar(() => recargas++);
  assert.equal(typeof quitar, "function");
  assert.doesNotThrow(quitar);
  assert.equal(recargas, 0);
});
