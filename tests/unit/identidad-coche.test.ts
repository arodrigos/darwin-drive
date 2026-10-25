import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { ADJETIVOS, EXCLUIDOS, generarNombre, nombrePropuesto, SUSTANTIVOS, todosLosNombres } from "../../src/app/nombres";
import { COLORES_COCHE, COLOR_PREDETERMINADO, PALETA_COCHES, colorNumerico, esColorCoche } from "../../src/game/colores-coche";
import { CONTORNO_COCHE } from "../../src/game/opacidad";
import { PALETTES } from "../../src/game/palette";
import { genomeHash, STOCK_CAR } from "../../src/sim/genome";
import { COPIA_FORMAT, validarCopia } from "../../src/storage/copia";
import { emptyRankings, KEY_GARAGE, KEY_RANKINGS, validateGarage, validateRankings, type RankingEntry, type SavedCar } from "../../src/storage/schema";
import { getTrack } from "../../src/sim/tracks";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { seededGenomes } from "./helpers/rng";

const PROHIBIDO = /[\p{Cc}\p{Cf}]/u;
const GENOMAS = seededGenomes(5, 200);

function concuerda(nombre: string): boolean {
  const [s, a] = nombre.split(" ");
  const sus = SUSTANTIVOS.find(([x]) => x === s);
  if (!sus || nombre.split(" ").length !== 2) return false;
  return ADJETIVOS.some((adj) => adj[sus[1] === "m" ? 0 : 1] === a);
}

test("id-6: todas las combinaciones del diccionario concuerdan, caben en 40 y no están excluidas", () => {
  const todos = todosLosNombres();
  assert.ok(todos.length > 1000);
  for (const n of todos) {
    assert.ok(concuerda(n), n);
    assert.ok(n.length <= 40 && !PROHIBIDO.test(n));
    assert.ok(!EXCLUIDOS.has(n));
  }
  assert.ok(!todos.includes("Tortuga Robusto"));
  assert.ok(todos.includes("Tortuga Robusta"));
});

test("id-6: generarNombre concuerda para cualquier aleatorio", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), (r) => {
      const n = generarNombre(() => r);
      assert.ok(concuerda(n) && !EXCLUIDOS.has(n) && n.length <= 40);
    }),
    { numRuns: 500 },
  );
});

test("id-6: nombrePropuesto es determinista, concordado y no excluido para cualquier hash", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 64 }), (h) => {
      const n = nombrePropuesto(h);
      assert.equal(n, nombrePropuesto(h));
      assert.ok(concuerda(n) && !EXCLUIDOS.has(n));
    }),
    { numRuns: 500 },
  );
});

test("la paleta tiene 8 colores y esColorCoche solo acepta sus claves", () => {
  assert.equal(COLORES_COCHE.length, 8);
  assert.equal(PALETA_COCHES.azul.hex, "#0072B2");
  assert.equal(colorNumerico("azul"), 0x0072b2);
  assert.ok(esColorCoche(COLOR_PREDETERMINADO));
  fc.assert(fc.property(fc.anything(), (v) => assert.equal(esColorCoche(v), typeof v === "string" && COLORES_COCHE.includes(v as never))), { numRuns: 300 });
  for (const malo of ["#ff00ff", "toString", "__proto__", "constructor", "", 3, null]) assert.equal(esColorCoche(malo), false);
});

function luminancia(c: number): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
}
const contraste = (a: number, b: number) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test("id-1: para todo color y todo fondo, el contorno oscuro o el trazo del color llega a 3:1", () => {
  const fondos = [0x16222f, ...Object.values(PALETTES).flatMap((p) => [p.skyTop, p.skyBottom])];
  for (const c of COLORES_COCHE) {
    for (const f of fondos) {
      const mejor = Math.max(contraste(CONTORNO_COCHE, f), contraste(colorNumerico(c), f));
      assert.ok(mejor >= 3, `${c} sobre ${f.toString(16)}: ${mejor.toFixed(2)}`);
    }
  }
});

function coche(i: number, extra: Partial<SavedCar> = {}): SavedCar {
  const genome = GENOMAS[i];
  return { id: genomeHash(genome), name: "Rayo Azul", genome, marks: {}, origin: "diseño", savedAt: "2026-10-02T09:00:00.000Z", ...extra };
}
function fila(i: number, extra: Partial<RankingEntry> = {}): RankingEntry {
  const genome = GENOMAS[i];
  return {
    carId: genomeHash(genome), genome, genomeHash: genomeHash(genome), distance: 120, bestStep: 900, piezasPerdidas: 0, origin: "diseño",
    date: "2026-10-01T10:00:00.000Z", trackId: "rampa", trackVersion: getTrack("rampa")!.version, physicsVersion: PHYSICS_VERSION, ...extra,
  };
}

test("id-2: 200 genomas conservan genomeHash al guardar con nombre y color y releer", () => {
  assert.equal(genomeHash(STOCK_CAR), genomeHash(structuredClone(STOCK_CAR)));
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 199 }), fc.constantFrom(...COLORES_COCHE), fc.string({ maxLength: 50 }), (i, color, nombre) => {
      const antes = genomeHash(GENOMAS[i]);
      const garaje = validateGarage(JSON.parse(JSON.stringify([coche(i, { color, name: nombre || "x" })])));
      assert.ok(garaje && garaje.length === 1);
      assert.equal(garaje[0].color, color);
      assert.equal(genomeHash(garaje[0].genome), antes);
      const r = { ...emptyRankings(), rampa: [fila(i, { color, name: "n" })] };
      const rk = validateRankings(JSON.parse(JSON.stringify(r)));
      assert.ok(rk);
      assert.equal(rk.rampa[0].color, color);
      assert.equal(rk.rampa[0].genomeHash, antes);
    }),
    { numRuns: 200 },
  );
});

test("id-4: un color fuera de la paleta descarta solo el color y conserva el coche", () => {
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant({})), (malo) => {
      if (esColorCoche(malo)) return;
      const g = validateGarage([{ ...coche(0), color: malo }]);
      assert.ok(g && g.length === 1 && g[0].color === undefined);
      const rk = validateRankings({ ...emptyRankings(), rampa: [{ ...fila(0), color: malo }] });
      assert.ok(rk && rk.rampa.length === 1 && rk.rampa[0].color === undefined);
    }),
    { numRuns: 200 },
  );
});

function copia(data: Record<string, unknown>): string {
  return JSON.stringify({ format: COPIA_FORMAT, v: 1, exportedAt: "2026-10-20T10:00:00.000Z", data });
}

test("id-4: una copia antigua (sin color) se importa y una manipulada conserva el coche con nombre limpio y sin color", () => {
  const antigua = validarCopia(copia({ [KEY_GARAGE]: [coche(1)] }));
  assert.ok(antigua.ok);
  assert.equal((antigua.data[KEY_GARAGE] as SavedCar[])[0].color, undefined);

  const sucio = "<img src=x onerror=alert(1)>";
  const manipulada = validarCopia(
    copia({ [KEY_GARAGE]: [{ ...coche(2, { name: sucio }), color: "#ff00ff" }], [KEY_RANKINGS]: { ...emptyRankings(), rampa: [{ ...fila(2, { name: "‮x" }), color: "rojo" }] } }),
  );
  assert.ok(manipulada.ok);
  const g = (manipulada.data[KEY_GARAGE] as SavedCar[])[0];
  assert.equal(g.name, sucio);
  assert.equal(g.color, undefined);
  const rk = manipulada.data[KEY_RANKINGS] as ReturnType<typeof emptyRankings>;
  assert.equal(rk.rampa[0].color, undefined);
  assert.equal(rk.rampa[0].name, "x");

  const buena = validarCopia(copia({ [KEY_GARAGE]: [coche(3, { color: "azul" })] }));
  assert.ok(buena.ok);
  assert.equal((buena.data[KEY_GARAGE] as SavedCar[])[0].color, "azul");
});
