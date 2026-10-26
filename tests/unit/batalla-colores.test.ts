import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { resolverColores } from "../../src/app/components/batalla/Configurar";
import { COLORES_COCHE } from "../../src/game/colores-coche";

const color = fc.constantFrom(...COLORES_COCHE);

test("resolverColores: los jugadores activos nunca comparten color, sea cual sea la entrada", () => {
  fc.assert(
    fc.property(fc.array(color, { minLength: 4, maxLength: 4 }), fc.integer({ min: 2, max: 4 }), (colores, n) => {
      const fichas = colores.map((c, i) => ({ nombre: `J${i}`, color: c }));
      const r = resolverColores(fichas, n);
      assert.equal(new Set(r.slice(0, n).map((f) => f.color)).size, n);
      assert.deepEqual(r.map((f) => f.nombre), fichas.map((f) => f.nombre));
    }),
  );
});

test("resolverColores: no toca un color que ya era único", () => {
  const fichas = [
    { nombre: "A", color: "naranja" as const },
    { nombre: "B", color: "azul" as const },
  ];
  assert.deepEqual(resolverColores(fichas, 2), fichas);
});
