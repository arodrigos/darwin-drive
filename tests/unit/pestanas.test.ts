import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { antiguasDe, contarActuales, recargarAntiguas, saludar, VERSION_DATOS } from "../../src/pwa/pestanas";

test("mig-9: las antiguas son lo abierto menos lo que saludó, y sin dato del service worker no se bloquea", () => {
  fc.assert(
    fc.property(fc.option(fc.nat(20), { nil: null }), fc.nat(20), (abiertas, actuales) => {
      const n = antiguasDe(abiertas, actuales);
      assert.ok(n >= 0);
      if (abiertas === null) assert.equal(n, 0);
      else assert.equal(n, Math.max(0, abiertas - actuales));
    }),
  );
});

test("mig-9: cada pestaña con esta versión contesta al saludo y la cuenta incluye la propia", async () => {
  const quitar = [saludar(() => {}), saludar(() => {})];
  assert.equal(await contarActuales(50), 3);
  quitar.forEach((q) => q());
  assert.equal(await contarActuales(50), 1);
});

test("mig-9: «Recargar las otras pestañas» solo recarga las de una versión anterior", async () => {
  let recargadas = 0;
  const quitar = saludar(() => recargadas++);
  recargarAntiguas();
  await new Promise((r) => setTimeout(r, 50));
  // Esta pestaña tiene la misma versión que quien pide: no se recarga a sí misma.
  assert.equal(recargadas, 0);
  assert.ok(VERSION_DATOS >= 1);
  quitar();
});
