import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { compartirTexto, compartirFichero } from "../../src/app/compartir";
import { runtime } from "../../src/debug/ganchos";
import { COLORES_COCHE, PALETA_COCHES, colorMasCercano } from "../../src/game/colores-coche";

const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const poner = (nav: unknown) => Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "navigator", original);
});
const error = (name: string) => Object.assign(new Error(name), { name });

test("comp-4: share llamado con el texto; AbortError no es error; NotAllowedError cae al portapapeles", async () => {
  const llamadas: unknown[] = [];
  poner({ share: async (d: unknown) => void llamadas.push(d) });
  assert.equal(await compartirTexto("DD1.abc"), "compartido");
  assert.deepEqual(llamadas, [{ text: "DD1.abc" }]);
  assert.equal(runtime.ultimoCompartido, "DD1.abc");

  poner({ share: async () => Promise.reject(error("AbortError")), clipboard: { writeText: async () => assert.fail("no debe copiar") } });
  assert.equal(await compartirTexto("x"), "cancelado");

  const copiados: string[] = [];
  poner({ share: async () => Promise.reject(error("NotAllowedError")), clipboard: { writeText: async (t: string) => void copiados.push(t) } });
  assert.equal(await compartirTexto("y"), "copiado");
  assert.deepEqual(copiados, ["y"]);
});

test("sin share ni portapapeles el resultado es manual, y sin share pero con portapapeles es copiado", async () => {
  poner({ clipboard: { writeText: async () => {} } });
  assert.equal(await compartirTexto("a"), "copiado");
  poner({});
  assert.equal(await compartirTexto("a"), "manual");
  poner({ clipboard: { writeText: async () => Promise.reject(error("NotAllowedError")) } });
  assert.equal(await compartirTexto("a"), "manual");
});

test("compartirFichero pasa solo {files}", async () => {
  const f = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const llamadas: unknown[] = [];
  poner({ share: async (d: unknown) => void llamadas.push(d) });
  assert.equal(await compartirFichero(f), "compartido");
  assert.deepEqual(llamadas, [{ files: [f] }]);
  poner({ share: async () => Promise.reject(error("AbortError")) });
  assert.equal(await compartirFichero(f), "cancelado");
  poner({ share: async () => Promise.reject(error("TypeError")) });
  assert.equal(await compartirFichero(f), "error");
});

test("colorMasCercano: cada color de la paleta vuelve a sí mismo, en mayúsculas o minúsculas, y siempre da uno de la paleta", () => {
  for (const c of COLORES_COCHE) {
    assert.equal(colorMasCercano(PALETA_COCHES[c].hex), c);
    assert.equal(colorMasCercano(PALETA_COCHES[c].hex.toLowerCase()), c);
  }
  fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffff }), (n) => COLORES_COCHE.includes(colorMasCercano(`#${n.toString(16).padStart(6, "0")}`))));
});
