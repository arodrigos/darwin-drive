import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { TRACKS } from "../../src/sim/tracks";
import { AYUDA, FICHAS_PISTA, PANTALLAS_AYUDA, SECCIONES_GUIA } from "../../src/app/ayuda/textos";

test("gui-6: toda pantalla tiene título, al menos 3 controles y una sección de la guía", () => {
  const ids = new Set(SECCIONES_GUIA.map((s) => s.id));
  assert.equal(PANTALLAS_AYUDA.length, 10);
  fc.assert(
    fc.property(fc.constantFrom(...PANTALLAS_AYUDA), (p) => {
      const t = AYUDA[p];
      return t.titulo.length > 0 && t.resumen.length > 0 && t.controles.length >= 3 && ids.has(t.seccionGuia);
    }),
  );
});

test("gui-6: toda pista de TRACKS tiene ficha con mecánica y «premia»", () => {
  fc.assert(
    fc.property(fc.constantFrom(...TRACKS), (t) => {
      const f = FICHAS_PISTA[t.id];
      return Boolean(f) && f.mecanica.length > 0 && f.premia.length > 0;
    }),
  );
});

test("gui-1: Pista y Evolución nombran sus ritmos y la pausa al apagar la pantalla", () => {
  const pista = JSON.stringify(AYUDA.pista);
  for (const t of ["×1", "×2", "×4", "×8", "Hasta el final", "Repetir", "Si apagas la pantalla o cambias de app, se pausa y sigue al volver"]) {
    assert.ok(pista.includes(t), `Pista sin «${t}»`);
  }
  const evo = JSON.stringify(AYUDA.evolucion);
  for (const t of ["×8", "Turbo", "Mejor", "Top 25 %", "Media", "Guardar campeón", "Favorito", "Estancamiento"]) {
    assert.ok(evo.includes(t), `Evolución sin «${t}»`);
  }
  assert.ok(JSON.stringify(AYUDA.garaje).includes("Medir en todas las pistas"));
  assert.ok(JSON.stringify(AYUDA.garaje).includes("Copia de seguridad"));
});

test("gui-6: los ids de sección son únicos", () => {
  const ids = SECCIONES_GUIA.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("cla-9: la guía de Rankings explica la meta, las tres claves de desempate y la insignia", () => {
  const rk = SECCIONES_GUIA.find((s) => s.id === "rankings-clasificacion")!;
  const texto = rk.parrafos.join(" ");
  for (const t of ["5000 m", "15 minutos", "entero", "más rápido", "antes", "insignia"]) assert.ok(texto.includes(t), `falta «${t}»`);
  assert.equal(rk.titulo, "Rankings y clasificación");
});
