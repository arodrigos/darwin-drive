import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import * as lienzo from "../../src/game/lienzo";

// Cada prueba parte de una sesión nueva: la sonda y los contadores viven a nivel de módulo.
const cargar = async (): Promise<typeof lienzo> => {
  lienzo.reiniciarLienzo();
  return lienzo;
};

interface FalsoCanvas {
  getContext(tipo: string): unknown;
}
function falsoDocumento(contextos: Record<string, unknown>, creados: { n: number }) {
  return {
    createElement: (): FalsoCanvas => {
      creados.n++;
      return { getContext: (tipo: string) => contextos[tipo] ?? null };
    },
  };
}
const global = globalThis as unknown as { document?: unknown; getComputedStyle?: unknown };

test("lz-2: sin WebGL ni 2d, puedeDibujar() es false y se sondea una sola vez", async () => {
  const { puedeDibujar, contadoresLienzo } = await cargar();
  const creados = { n: 0 };
  global.document = falsoDocumento({}, creados);
  assert.equal(puedeDibujar(), false);
  assert.equal(puedeDibujar(), false);
  assert.equal(creados.n, 1);
  assert.equal(contadoresLienzo.sondas, 1);
});

test("lz-2: con WebGL, la sonda libera su contexto en el acto", async () => {
  const { puedeDibujar } = await cargar();
  let perdidos = 0;
  const gl = { getExtension: () => ({ loseContext: () => perdidos++ }) };
  global.document = falsoDocumento({ webgl2: gl }, { n: 0 });
  assert.equal(puedeDibujar(), true);
  assert.equal(perdidos, 1);
});

test("lz-1: puedeDibujar() crea como mucho un contexto de sonda sea cual sea el número de llamadas", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 60 }), fc.boolean(), async (llamadas, hayWebgl) => {
      const { puedeDibujar, contadoresLienzo } = await cargar();
      const creados = { n: 0 };
      let perdidos = 0;
      const gl = { getExtension: () => ({ loseContext: () => perdidos++ }) };
      global.document = falsoDocumento(hayWebgl ? { webgl2: gl } : { "2d": {} }, creados);
      for (let i = 0; i < llamadas; i++) puedeDibujar();
      assert.equal(creados.n, 1);
      assert.equal(contadoresLienzo.sondas, 1);
      assert.equal(perdidos, hayWebgl ? 1 : 0);
    }),
    { numRuns: 20 },
  );
});

function falsoJuego(sueltos: { n: number }) {
  const canvas = {
    getContext: () => ({ getExtension: () => ({ loseContext: () => {} }) }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { canvas, events: { once: () => {} }, destroy: () => sueltos.n++ } as never;
}

test("lz-1: tras cualquier secuencia de montar y desmontar, creados − liberados es el número de pantallas montadas (0 o 1)", async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 80 }), async (pasos) => {
      const { gestionarLienzo, contadoresLienzo } = await cargar();
      global.getComputedStyle = () => ({ position: "relative" });
      const parent = { style: {}, appendChild: () => {} } as unknown as HTMLElement;
      const destruidos = { n: 0 };
      let montada: { destruir(): void } | null = null;
      for (const montar of pasos) {
        if (montar && !montada) montada = gestionarLienzo(parent, () => falsoJuego(destruidos));
        else if (!montar && montada) {
          montada.destruir();
          montada = null;
        }
        assert.equal(contadoresLienzo.creados - contadoresLienzo.liberados, montada ? 1 : 0);
      }
      montada?.destruir();
      assert.equal(contadoresLienzo.creados, contadoresLienzo.liberados);
      assert.equal(destruidos.n, contadoresLienzo.creados);
    }),
    { numRuns: 30 },
  );
});

test("lz-2: destruir dos veces una pantalla no libera dos contextos", async () => {
  const { gestionarLienzo, contadoresLienzo } = await cargar();
  global.getComputedStyle = () => ({ position: "relative" });
  const parent = { style: {}, appendChild: () => {} } as unknown as HTMLElement;
  const g = gestionarLienzo(parent, () => falsoJuego({ n: 0 }));
  g.destruir();
  g.destruir();
  assert.equal(contadoresLienzo.liberados, 1);
});
