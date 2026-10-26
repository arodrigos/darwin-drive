import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { TRACKS } from "../../src/sim/tracks";
import { AYUDA, FICHAS_PISTA, PANTALLAS_AYUDA, SECCIONES_GUIA } from "../../src/app/ayuda/textos";

test("gui-6: toda pantalla tiene título, al menos 3 controles y una sección de la guía", () => {
  const ids = new Set(SECCIONES_GUIA.map((s) => s.id));
  assert.equal(PANTALLAS_AYUDA.length, 11);
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

test("diag-6: la guía explica por qué se para un coche con el límite de 35°, La Rampa y cada causa con consejo", () => {
  const s = SECCIONES_GUIA.find((x) => x.id === "por-que-se-para");
  assert.ok(s, "falta la sección");
  assert.equal(s.titulo, "Por qué se para un coche");
  const texto = s.parrafos.join("\n");
  assert.ok(texto.includes("35°"));
  assert.ok(texto.includes("La Rampa"));
  for (const causa of ["Vuelco", "Sin apoyo", "Panza", "Motor", "Agarre", "Obstáculo"]) {
    const p = s.parrafos.find((x) => x.startsWith(`${causa}.`));
    assert.ok(p && p.length > causa.length + 30, `${causa} sin explicación y consejo`);
  }
  assert.ok(JSON.stringify(AYUDA.pista).includes("¿Por qué?"));
});

test("opa-4: la guía y el «?» del Taller explican qué significa más o menos opaco", () => {
  const seccion = SECCIONES_GUIA.find((s) => s.id === "peso-opacidad");
  assert.ok(seccion, "falta la sección «Peso y opacidad»");
  assert.equal(seccion.titulo, "Peso y opacidad");
  assert.ok(JSON.stringify(seccion).includes("más peso = más opaco"));
  assert.ok(JSON.stringify(AYUDA.taller).includes("más peso = más opaco"));
});

test("ed-5: el «?» y la guía del Taller explican el toque que elige el punto", () => {
  const frase = "Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda.";
  assert.ok(AYUDA.taller.controles.some((c) => c.texto === frase));
  assert.ok(!JSON.stringify(AYUDA.taller).includes("ponerle o quitarle"));
});

test("gu-1: la guía tiene «El Taller» y «Batalla», y el «?» de la batalla abre «Batalla»", () => {
  const titulos = SECCIONES_GUIA.map((s) => s.titulo);
  assert.ok(titulos.includes("El Taller"));
  assert.ok(titulos.includes("Batalla"));
  assert.equal(AYUDA.batalla.seccionGuia, "batalla");
  const texto = SECCIONES_GUIA.find((s) => s.id === "batalla")!.parrafos.join(" ");
  for (const t of ["Pasa el dispositivo", "gana el que llega más lejos", "Terminar mi coche", "Garaje", "ranking", "empate", "Continuar batalla"]) {
    assert.ok(texto.includes(t), `la sección Batalla no dice «${t}»`);
  }
});

test("gu-1: «El Taller» explica suspensión, «Ver fuerzas», nombre y color", () => {
  const texto = SECCIONES_GUIA.find((s) => s.id === "taller")!.parrafos.join(" ");
  for (const t of ["Inclinación de la suspensión", "Ver fuerzas", "centro de masas", "Tamaño +", "Poner rueda aquí", "color"]) {
    assert.ok(texto.includes(t), `El Taller no dice «${t}»`);
  }
});

test("gu-2: la sección de pistas cuenta los 5 km, La Recta y la nueva medición", () => {
  const texto = SECCIONES_GUIA.find((s) => s.id === "pistas")!.parrafos.join(" ");
  for (const t of ["5 km", "La Recta", "contrarreloj", "vuelve a medir"]) assert.ok(texto.includes(t), `Las pistas no dicen «${t}»`);
});

test("gu-3: los textos de la guía no nombran infraestructura ni rutas de máquina", () => {
  const todo = JSON.stringify([SECCIONES_GUIA, AYUDA]);
  for (const prohibido of ["VP" + "S", "Tail" + "scale", "/home" + "/", "claude" + "-fleet", "runs" + "/"]) assert.ok(!todo.includes(prohibido), prohibido);
});
