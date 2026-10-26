import { test, expect, type Page } from "@playwright/test";
import { PHYSICS_VERSION } from "../../src/sim/constants";
import { STOCK_CAR, genomeHash, normalizeGenome, type Genome } from "../../src/sim/genome";
import { simulateCar } from "../../src/sim/race";
import { getTrack } from "../../src/sim/tracks";

/** Transform del lienzo del Taller (lo publica la escena con ?pruebas=1): el coche se encuadra a su caja, no a una escala fija. */
async function encuadre(page: Page) {
  return page.evaluate(() => (window.__debug!.estado() as unknown as { tallerEncuadre: { escalaPxM: number; origenPx: { x: number; y: number } } }).tallerEncuadre);
}

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "taller-10";

const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];

type Estado = {
  pantalla: string;
  pistaEnCarrera: string | null;
  genomaEnPista: Genome | null;
  genomaEnTaller: Genome | null;
  ultimoResultado: { distance: number; trackId: string } | null;
  rankings: Record<string, { distance: number; origin: string }[]>;
  garaje: number;
};

const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const adelantar = (page: Page, s: number) => page.evaluate((x) => window.__debug!.adelantarSimulacion(x), s);
const coma = (m: number) => `${m.toFixed(1).replace(".", ",")} m`;

async function abrir(page: Page, escenario: Record<string, unknown> = { vacio: true }) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate((e) => window.__debug!.cargarEscenario(e), escenario);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
}

async function abrirTaller(page: Page) {
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
  await page.waitForTimeout(300);
}

/** Posición en pantalla del vértice i: la misma proyección que usa la escena (7 m caben en el lado menor). */
async function vertice(page: Page, i: number) {
  // La escena se dibuja sobre el canvas, no sobre su contenedor: las coordenadas salen de su caja real.
  const caja = (await page.locator("canvas").boundingBox())!;
  const g = (await estado(page)).genomaEnTaller!;
  const enc = (await encuadre(page))!;
  const s = enc.escalaPxM;
  const v = g.body[i];
  return {
    x: caja.x + enc.origenPx.x + Math.cos(v.angle) * v.length * s,
    y: caja.y + enc.origenPx.y - Math.sin(v.angle) * v.length * s,
    cx: caja.x + enc.origenPx.x,
    cy: caja.y + enc.origenPx.y,
  };
}

async function arrastrar(page: Page, i: number, hacia: (p: { x: number; y: number; cx: number; cy: number }) => { x: number; y: number }) {
  const p = await vertice(page, i);
  const fin = hacia(p);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + fin.x) / 2, (p.y + fin.y) / 2, { steps: 4 });
  await page.mouse.move(fin.x, fin.y, { steps: 4 });
  await page.mouse.up();
}

/** Espera a que el lienzo deje de cambiar de tamaño: al tocar una rueda aparece o se va el panel de radio y la escena se recoloca tras el ResizeObserver. */
async function lienzoQuieto(page: Page) {
  let previa = "";
  await expect
    .poll(async () => {
      const b = await page.locator("canvas").boundingBox();
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      const actual = JSON.stringify(b);
      const quieto = actual === previa;
      previa = actual;
      return quieto;
    })
    .toBe(true);
}

async function tocar(page: Page, i: number) {
  await lienzoQuieto(page);
  const p = await vertice(page, i);
  await page.mouse.click(p.x, p.y);
}

/** Tocar elige el punto; la rueda se pone o se quita con el botón del panel «Punto N». */
async function ponerRueda(page: Page, i: number) {
  await tocar(page, i);
  await expect(page.getByTestId("punto-titulo")).toHaveText(`Punto ${i + 1}`);
  await page.getByTestId("poner-rueda").click();
}

async function quitarRueda(page: Page, i: number) {
  await tocar(page, i);
  await expect(page.getByTestId("punto-titulo")).toHaveText(`Punto ${i + 1}`);
  await page.getByTestId("quitar-rueda").click();
}

async function elegirPista(page: Page, id: string) {
  await page.getByTestId("selector-pista").click();
  await page.getByTestId(`pista-${id}`).click();
}

async function meta(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ seenHelp: string[] } | null>((resolve, reject) => {
        const req = indexedDB.open("darwin-drive-pruebas");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction("datos", "readonly").objectStore("datos").get("dd:v1:meta");
          get.onsuccess = () => resolve((get.result as { seenHelp: string[] } | undefined) ?? null);
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

// Con detmath el núcleo da la misma marca en Node y en Chromium: la igualdad es exacta (tl-9, ev-9).
function expectMismaMarca(navegador: number, nucleo: number) {
  expect(navegador).toBe(nucleo);
}

async function cpu(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

test("tl-1 diseñar, elegir pista, probar y entrar en el ranking, y persiste", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await abrirTaller(page);
  const antes = (await estado(page)).genomaEnTaller!;
  await arrastrar(page, 1, (p) => {
    const d = Math.hypot(p.x - p.cx, p.y - p.cy);
    return { x: p.x + ((p.x - p.cx) / d) * 60, y: p.y + ((p.y - p.cy) / d) * 60 };
  });
  await ponerRueda(page, 3);
  const g = (await estado(page)).genomaEnTaller!;
  expect(g.body[1].length).toBeGreaterThan(antes.body[1].length);
  expect(g.wheels.filter((w) => w.vertex >= 0).map((w) => w.vertex)).toContain(3);
  await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 3/4");
  await page.screenshot({ path: `${DIR}/${ID}-diseno-360x640.png` });

  await elegirPista(page, "rampa");
  await page.getByTestId("probar").click();
  await expect(page.getByTestId("pista")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  const enPista = await estado(page);
  expect(enPista.genomaEnPista).toEqual(enPista.genomaEnTaller);
  expect(enPista.pistaEnCarrera).toBe("rampa");

  await adelantar(page, 200);
  const fin = await estado(page);
  const cifra = coma(fin.ultimoResultado!.distance);
  await expect(page.getByTestId("fin-distancia")).toHaveText(cifra);
  await expect(page.getByTestId("tarjeta-ranking")).toHaveText(`¡Nuevo récord en La Rampa! ${cifra}`);
  // El aviso flotante ya no se monta con la tarjeta de fin: la línea del récord es la de tarjeta-ranking.
  await expect(page.getByTestId("aviso-ranking")).toHaveCount(0);
  await expect(page.getByTestId("tarjeta-puesto")).toHaveText("Puesto 1 de 10 en La Rampa");
  await page.screenshot({ path: `${DIR}/${ID}-record-360x640.png` });

  // Mismo coche otra vez: ya está, no se duplica.
  await page.getByTestId("repetir").click();
  await adelantar(page, 200);
  await expect(page.getByTestId("tarjeta-ranking")).toHaveText("Ya está en el ranking de La Rampa: puesto 1");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("tarjeta-rampa")).toContainText(`n.º 1: ${cifra} · diseño`);
  for (const id of ["cordillera", "dunas", "pedregal"]) await expect(page.getByTestId(`tarjeta-${id}`)).toContainText("sin marcas todavía");
  const r = await estado(page);
  expect(r.rankings.rampa).toHaveLength(1);
  expect(coma(r.rankings.rampa[0].distance)).toBe(cifra);
  expect(r.rankings.cordillera.length + r.rankings.dunas.length + r.rankings.pedregal.length).toBe(0);
  await page.screenshot({ path: `${DIR}/${ID}-portada-360x640.png` });
});

test("tl-9 cada pista tiene su marca: la distancia es la del núcleo y entra solo en su ranking", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const refCordillera = simulateCar(STOCK_CAR, "cordillera").distance;
  const refPedregal = simulateCar(STOCK_CAR, "pedregal").distance;
  expect(refCordillera).not.toBe(refPedregal);
  await abrir(page, { vacio: true, genoma: STOCK_CAR });
  await abrirTaller(page);
  await page.getByTestId("guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText("Guardado en este dispositivo");

  await elegirPista(page, "cordillera");
  await page.getByTestId("probar").click();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  await adelantar(page, 200);
  const a = (await estado(page)).ultimoResultado!;
  expect(a.trackId).toBe("cordillera");
  expectMismaMarca(a.distance, refCordillera);
  await expect(page.getByTestId("tarjeta-ranking")).toBeVisible();
  await page.getByTestId("volver-fin").click();
  await expect(page.getByTestId("taller")).toBeVisible();

  await elegirPista(page, "pedregal");
  await page.getByTestId("probar").click();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  await adelantar(page, 200);
  const b = (await estado(page)).ultimoResultado!;
  expect(b.trackId).toBe("pedregal");
  expectMismaMarca(b.distance, refPedregal);
  await expect(page.getByTestId("tarjeta-ranking")).toBeVisible();

  const e = await estado(page);
  expect(e.rankings.cordillera).toHaveLength(1);
  expect(e.rankings.pedregal).toHaveLength(1);
  expect(e.rankings.rampa).toHaveLength(0);
  expect(e.rankings.dunas).toHaveLength(0);

  await page.getByTestId("volver-fin").click();
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("marcas")).toHaveText(`La Cordillera ${coma(a.distance)} · El Pedregal ${coma(b.distance)}`);
  await page.screenshot({ path: `${DIR}/${ID}-garaje-marcas-360x640.png` });
});

test("tl-2 el editor no deja hacer un coche imposible y responde al dedo", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await cpu(page, 4);
  await abrirTaller(page);
  const antes = (await estado(page)).genomaEnTaller!;
  const caja = (await page.getByTestId("lienzo").boundingBox())!;
  const p = await vertice(page, 0);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.cx + 30, p.cy + 30, { steps: 5 });
  await page.screenshot({ path: `${DIR}/${ID}-arrastrando-360x640.png` });
  await page.mouse.move(caja.x + 5, caja.y + caja.height - 5, { steps: 8 });
  await page.mouse.up();
  const g = (await estado(page)).genomaEnTaller!;
  expect(g.body[0].angle).toBeGreaterThanOrEqual(0.087 - 1e-6);
  expect(g.body[0].angle).toBeLessThanOrEqual(0.698 + 1e-3);
  expect(g.body[0].length).toBeLessThanOrEqual(2.5);
  for (let i = 1; i < 8; i++) {
    expect(g.body[i]).toEqual(antes.body[i]);
    expect(g.body[i].angle).toBeGreaterThan(g.body[i - 1].angle);
  }
  await page.screenshot({ path: `${DIR}/${ID}-limite-360x640.png` });

  // Fuera del lienzo: el asa queda en su último punto válido y el gesto termina.
  const q = await vertice(page, 2);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x, -40, { steps: 5 });
  await page.mouse.up();
  const h = (await estado(page)).genomaEnTaller!;
  expect(h.body[2].length).toBeLessThanOrEqual(2.5);

  const lat = await page.evaluate(() => window.__debug!.latencias().filter((l) => l.evento === "arrastrar-vertice"));
  expect(lat.length).toBeGreaterThan(0);
  for (const l of lat) expect(l.ms).toBeLessThanOrEqual(200);
});

test("tl-3 guardar en el garaje persiste y se ve", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("garaje-vacio")).toContainText("Tu garaje está vacío. Diseña un coche en el Taller o evoluciona uno y guárdalo aquí.");
  await page.screenshot({ path: `${DIR}/${ID}-garaje-vacio-360x640.png` });
  await page.getByTestId("ir-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await page.getByTestId("guardar").click();
  await expect(page.getByTestId("aviso-guardado")).toHaveText("Guardado en este dispositivo");
  await page.screenshot({ path: `${DIR}/${ID}-guardado-360x640.png` });
  await expect(page.getByTestId("aviso-guardado")).toBeHidden({ timeout: 5000 });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-garaje").click();
  await expect(page.getByTestId("tarjeta-coche")).toHaveCount(1);
  await expect(page.getByTestId("origen")).toHaveText("diseño");
  await expect(page.getByTestId("marcas")).toHaveText("sin probar");
  await expect(page.getByTestId("silueta")).toBeVisible();
  expect((await estado(page)).garaje).toBe(1);
  await page.screenshot({ path: `${DIR}/${ID}-garaje-1-360x640.png` });

  // Abrir en el taller y borrar.
  await page.getByTestId("garaje-abrir").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await page.getByTestId("volver").click();
  await page.getByTestId("acceso-garaje").click();
  await page.getByTestId("garaje-borrar").click();
  await expect(page.getByTestId("garaje-vacio")).toBeVisible();
});

test("tl-4 la ayuda está donde la acción no es obvia", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrir(page);
  await abrirTaller(page);
  const ayuda = page.getByTestId("ayuda-taller");
  await expect(ayuda).toHaveText("Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda. Elige abajo en qué pista lo pruebas.");
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-360x640.png` });
  await ponerRueda(page, 3);
  await expect(ayuda).toBeHidden();
  await expect(page.getByTestId("etiqueta-radio")).toHaveText("Radio: 0,5 m");
  await expect.poll(async () => (await meta(page))?.seenHelp).toContain("taller");
  // El «?» global abre el panel de ayuda del Taller (guia-ayuda); la pista de la primera vez ya no se reabre.
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByTestId("ayuda-panel")).toBeVisible();
  await page.getByTestId("ayuda-cerrar").click();

  // Sin ruedas.
  // El toque anterior añadió una rueda: se espera a verla en el contador antes de leer el estado, o la lectura va un toque por detrás.
  await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 3/4");
  // Cada toque se confirma en el contador antes del siguiente: dos clics seguidos en la CI lenta se solapan con el repintado y uno se pierde.
  const conRueda = (await estado(page)).genomaEnTaller!.wheels.filter((r) => r.vertex >= 0);
  for (const [k, w] of conRueda.entries()) {
    await quitarRueda(page, w.vertex);
    await expect(page.getByTestId("contador-ruedas")).toHaveText(`Ruedas: ${conRueda.length - k - 1}/4`);
  }
  await expect(page.getByTestId("aviso-sin-ruedas")).toHaveText("Sin ruedas no hay motor: este coche no avanzará.");
  await page.screenshot({ path: `${DIR}/${ID}-sin-ruedas-360x640.png` });
  await ponerRueda(page, 5);
  await ponerRueda(page, 7);
  await expect(page.getByTestId("aviso-sin-ruedas")).toBeHidden();
  await page.screenshot({ path: `${DIR}/${ID}-radio-360x640.png` });
});

test("tl-5 sin guardado disponible avisa una vez y todo lo demás funciona", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error("sin almacenamiento");
    };
  });
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await expect(page.getByTestId("aviso")).toHaveText("Este navegador no deja guardar. Puedes jugar, pero los rankings y el garaje se perderán al cerrar.");
  await page.screenshot({ path: `${DIR}/${ID}-sin-guardado-360x640.png` });
  await page.getByTestId("aviso").click();
  await abrirTaller(page);
  await elegirPista(page, "rampa");
  await page.getByTestId("probar").click();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  await adelantar(page, 200);
  await expect(page.getByTestId("tarjeta-ranking")).toContainText("¡Nuevo récord en La Rampa!");
});

test("tl-6 el Taller se usa bien en los tres tamaños", async ({ page }) => {
  for (const t of TAMANOS) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrir(page);
    await abrirTaller(page);
    await tocar(page, 3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const lienzo = (await page.getByTestId("lienzo").boundingBox())!;
    const panel = (await page.locator(".taller-panel").boundingBox())!;
    if (t.w > t.h && t.w >= 900) expect(lienzo.x + lienzo.width).toBeLessThanOrEqual(panel.x + 1);
    else expect(lienzo.y + lienzo.height).toBeLessThanOrEqual(panel.y + 1);
    for (const id of ["probar", "guardar", "selector-pista"]) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(t.w + 1);
    }
    await page.screenshot({ path: `${DIR}/${ID}-taller-${t.w}x${t.h}.png` });
  }
});

test("tl-8 aviso arriba al entrar en un ranking, y se va a los 2,5 s", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const track = getTrack("dunas")!;
  const otros = [1000, 900, 800].map((distance, i) => {
    const genome = normalizeGenome({ ...STOCK_CAR, bodyDensity: 30 + i * 10 });
    return {
      carId: genomeHash(genome),
      genome,
      genomeHash: genomeHash(genome),
      distance,
      origin: "diseño",
      date: new Date(2026, 9, 1 + i).toISOString(),
      trackId: "dunas",
      trackVersion: track.version,
      physicsVersion: PHYSICS_VERSION,
    };
  });
  await abrir(page, { vacio: true, rankings: { dunas: otros } });
  await abrirTaller(page);
  await elegirPista(page, "dunas");
  await page.getByTestId("probar").click();
  await expect.poll(async () => (await estado(page)).genomaEnPista !== null).toBe(true);
  await adelantar(page, 200);
  // El resultado llega del worker: se espera a la tarjeta antes de leerlo del estado.
  await expect(page.getByTestId("fin-distancia")).toBeVisible();
  const cifra = coma((await estado(page)).ultimoResultado!.distance);
  await expect(page.getByTestId("fin-distancia")).toHaveText(cifra);
  await page.screenshot({ path: `${DIR}/${ID}-puesto-4-360x640.png` });
  await expect(page.getByTestId("tarjeta-ranking")).toHaveText(/^Entra en el ranking de Las Dunas: puesto [1-4] de 10$/);
  await expect(page.getByTestId("aviso-ranking")).toBeHidden();
  await page.screenshot({ path: `${DIR}/${ID}-puesto-4-despues-360x640.png` });
});
