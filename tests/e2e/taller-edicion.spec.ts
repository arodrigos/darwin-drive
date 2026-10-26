import { test, expect, type Page } from "@playwright/test";
import { dimensiones } from "../../src/game/editor";
import type { Genome } from "../../src/sim/genome";

/** Transform del lienzo del Taller (lo publica la escena con ?pruebas=1): el coche se encuadra a su caja, no a una escala fija. */
async function encuadre(page: Page) {
  return page.evaluate(() => (window.__debug!.estado() as unknown as { tallerEncuadre: { escalaPxM: number; origenPx: { x: number; y: number } } }).tallerEncuadre);
}

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "taller-edicion-7";
const TAMANOS = [
  { w: 360, h: 640 },
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
test.setTimeout(150_000);

type Estado = { verticeSeleccionado: number | null; genomaEnTaller: Genome | null; dimensiones: { largo: number; alto: number } | null; pistaEnCarrera: string | null; distanciaLider: number };
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);
const latencia = (page: Page, evento: string) =>
  page.evaluate((e) => window.__debug!.latencias().filter((l) => l.evento === e).map((l) => l.ms), evento);

async function abrirTaller(page: Page, extra = "") {
  await page.goto(`/?pruebas=1${extra}`);
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.getByTestId("acceso-taller").click();
  await expect(page.getByTestId("taller")).toBeVisible();
  await expect.poll(async () => (await estado(page)).genomaEnTaller !== null).toBe(true);
}

/** Espera a que el lienzo deje de cambiar de tamaño: el panel del punto aparece y la escena se recoloca tras el ResizeObserver. */
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

async function tocarVertice(page: Page, i: number) {
  await lienzoQuieto(page);
  const caja = (await page.locator("canvas").boundingBox())!;
  const g = (await estado(page)).genomaEnTaller!;
  const enc = (await encuadre(page))!;
  const s = enc.escalaPxM;
  const v = g.body[i];
  await page.mouse.click(caja.x + enc.origenPx.x + Math.cos(v.angle) * v.length * s, caja.y + enc.origenPx.y - Math.sin(v.angle) * v.length * s);
}

for (const t of TAMANOS) {
  test(`ed-1 tocar elige el punto sin tocar las ruedas y «Poner rueda aquí» la pone @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    const antes = (await estado(page)).genomaEnTaller!;
    await tocarVertice(page, 3);
    await expect(page.getByTestId("punto-titulo")).toHaveText("Punto 4");
    const tras = await estado(page);
    expect(tras.verticeSeleccionado).toBe(3);
    expect(tras.genomaEnTaller!.wheels).toEqual(antes.wheels);
    await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 2/4");
    await lienzoQuieto(page);
    await page.screenshot({ path: `${DIR}/${ID}-punto-elegido-${t.w}x${t.h}.png` });

    await page.getByTestId("poner-rueda").click();
    await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 3/4");
    expect((await estado(page)).genomaEnTaller!.wheels.map((w) => w.vertex)).toContain(3);
    await expect(page.getByTestId("quitar-rueda")).toBeVisible();
    await lienzoQuieto(page);
    await page.screenshot({ path: `${DIR}/${ID}-rueda-puesta-${t.w}x${t.h}.png` });

    const l0 = (await estado(page)).genomaEnTaller!.body[3];
    await page.getByTestId("longitud-mas").click();
    await page.getByTestId("longitud-mas").click();
    await expect.poll(async () => (await estado(page)).genomaEnTaller!.body[3].length).toBeCloseTo(l0.length + 0.2, 6);
    await page.getByTestId("angulo-mas").click();
    await expect.poll(async () => (await estado(page)).genomaEnTaller!.body[3].angle).toBeCloseTo(l0.angle + Math.PI / 180, 6);

    for (const ev of ["seleccionar-vertice", "poner-rueda"]) {
      await expect.poll(async () => (await latencia(page, ev)).length, { message: ev }).toBeGreaterThan(0);
      expect(Math.max(...(await latencia(page, ev)))).toBeLessThanOrEqual(200);
    }
  });
}

test("ed-1 con cuatro ruedas «Poner rueda aquí» se deshabilita y en el tope «+» de Ángulo también", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  for (const v of [3, 1]) {
    await tocarVertice(page, v);
    await expect(page.getByTestId("punto-titulo")).toHaveText(`Punto ${v + 1}`);
    await page.getByTestId("poner-rueda").click();
  }
  await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 4/4");
  await tocarVertice(page, 0);
  await expect(page.getByTestId("punto-titulo")).toHaveText("Punto 1");
  await expect(page.getByTestId("poner-rueda")).toBeDisabled();
  await expect(page.getByTestId("poner-rueda")).toHaveText("Máximo 4 ruedas");
  // El sector tiene menos de 45°: se llega al tope en menos de 50 pasos de 1°.
  const mas = page.getByTestId("angulo-mas");
  for (let k = 0; k < 50 && (await mas.isEnabled()); k++) await mas.click();
  await expect(mas).toBeDisabled();
});

test("ed-1 tocar el vacío suelta el punto y arrastrar lo mueve", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  await tocarVertice(page, 1);
  await expect(page.getByTestId("panel-punto")).toBeVisible();
  const antes = (await estado(page)).genomaEnTaller!.body[1].length;
  await lienzoQuieto(page);
  const caja = (await page.locator("canvas").boundingBox())!;
  const g = (await estado(page)).genomaEnTaller!;
  const enc = (await encuadre(page))!;
  const s = enc.escalaPxM;
  const v = g.body[1];
  const x = caja.x + enc.origenPx.x + Math.cos(v.angle) * v.length * s;
  const y = caja.y + enc.origenPx.y - Math.sin(v.angle) * v.length * s;
  const dx = Math.cos(v.angle) * 60;
  const dy = -Math.sin(v.angle) * 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.screenshot({ path: `${DIR}/${ID}-arrastre-con-cuna-360x640.png` });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await estado(page)).genomaEnTaller!.body[1].length).toBeGreaterThan(antes);
  expect((await estado(page)).verticeSeleccionado).toBe(1);
  await page.mouse.click(caja.x + 10, caja.y + 10);
  await expect.poll(async () => (await estado(page)).verticeSeleccionado).toBeNull();
  await expect(page.getByTestId("panel-punto")).toBeHidden();
});

for (const t of TAMANOS) {
  test(`ed-2 «Tamaño +» agranda el coche entero un 10 % conservando la forma @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    const a = (await estado(page)).genomaEnTaller!;
    const d0 = (await estado(page)).dimensiones!;
    await expect(page.getByTestId("lectura-tamano")).toContainText("Largo");
    await page.screenshot({ path: `${DIR}/${ID}-tamano-antes-${t.w}x${t.h}.png` });
    await page.getByTestId("tamano-mas").click();
    await page.getByTestId("tamano-mas").click();
    await expect.poll(async () => (await estado(page)).dimensiones!.largo / d0.largo).toBeGreaterThan(1.19);
    const d1 = (await estado(page)).dimensiones!;
    expect(d1.largo / d0.largo).toBeLessThan(1.22);
    const b = (await estado(page)).genomaEnTaller!;
    b.body.forEach((v, i) => expect(v.angle).toBe(a.body[i].angle));
    expect(dimensiones(b).largo).toBeCloseTo(d1.largo, 6);
    await page.screenshot({ path: `${DIR}/${ID}-tamano-despues-${t.w}x${t.h}.png` });
    await page.getByTestId("tamano-menos").click();
    await expect.poll(async () => (await estado(page)).dimensiones!.largo / d0.largo).toBeLessThan(1.12);
    await expect.poll(async () => (await latencia(page, "tamano")).length).toBeGreaterThan(0);
    expect(Math.max(...(await latencia(page, "tamano")))).toBeLessThanOrEqual(200);
  });
}

test("ed-2 en el límite «Tamaño +» se deshabilita y la nota nombra el punto", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  await tocarVertice(page, 3);
  await expect(page.getByTestId("punto-titulo")).toHaveText("Punto 4");
  const mas = page.getByTestId("longitud-mas");
  for (let k = 0; k < 30 && (await mas.isEnabled()); k++) await mas.click();
  await expect(page.getByTestId("etiqueta-longitud")).toHaveText("Longitud: 2,5 m");
  await expect(page.getByTestId("tamano-mas")).toBeDisabled();
  await expect(page.getByTestId("nota-tamano")).toHaveText("No puede crecer más: el punto 4 ya mide 2,5 m");
  await page.screenshot({ path: `${DIR}/${ID}-tamano-limite-360x640.png` });
});

for (const t of TAMANOS) {
  test(`ed-3 el panel separa coche, prueba y guardado, con un solo primario @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    const panel = page.locator(".taller-panel");
    await expect(panel.locator(".boton-primario")).toHaveCount(1);
    await expect(panel.locator(".boton-primario")).toHaveText("Probar");
    await expect(page.getByText("Pista para probar")).toBeVisible();
    // «Probar» entero en pantalla nada más abrir el Taller y con un punto elegido (el panel crece), sin desplazar nada.
    const enPantalla = async () => {
      const c = (await page.getByTestId("probar").boundingBox())!;
      expect(c.height).toBeGreaterThanOrEqual(47.5);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y + c.height).toBeLessThanOrEqual(t.h);
    };
    await enPantalla();
    await page.screenshot({ path: `${DIR}/${ID}-panel-abierto-${t.w}x${t.h}.png` });
    await tocarVertice(page, 3);
    await expect(page.getByTestId("punto-titulo")).toHaveText("Punto 4");
    await lienzoQuieto(page);
    await enPantalla();
    await page.screenshot({ path: `${DIR}/${ID}-panel-punto-${t.w}x${t.h}.png` });
    // Los grupos se miden con el panel desplazado al final: ahí el pie fijo de «Probar» está en su sitio natural.
    await panel.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const cajas = [];
    for (const id of ["grupo-coche", "grupo-prueba", "grupo-guardado"]) cajas.push((await page.getByTestId(id).boundingBox())!);
    // Entre grupos hay 16 px de separación como mínimo (en vertical, y en el panel desplazable también).
    expect(cajas[1].y - (cajas[0].y + cajas[0].height)).toBeGreaterThanOrEqual(15.5);
    expect(cajas[2].y - (cajas[1].y + cajas[1].height)).toBeGreaterThanOrEqual(15.5);
    await panel.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await expect(page.getByTestId("probar")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-panel-grupos-${t.w}x${t.h}.png` });

    await page.getByTestId("selector-pista").click();
    await page.getByTestId("pista-rampa").click();
    await page.getByTestId("probar").click();
    await expect.poll(async () => (await estado(page)).pistaEnCarrera).toBe("rampa");
    await page.evaluate(() => window.__debug!.adelantarSimulacion(3));
    await expect.poll(async () => (await estado(page)).distanciaLider).toBeGreaterThan(1);
  });
}

test("ed-4 ?rendimiento=1 enseña seleccionar-vertice, poner-rueda y tamano", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page, "&rendimiento=1");
  const lista = page.getByTestId("rend-latencias");
  const visible = (ev: string) => expect(lista.locator(`li[data-evento="${ev}"]`).first()).toBeVisible();
  await tocarVertice(page, 3);
  await expect(page.getByTestId("punto-titulo")).toHaveText("Punto 4");
  await visible("seleccionar-vertice");
  await page.getByTestId("poner-rueda").click();
  await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 3/4");
  await visible("poner-rueda");
  await page.getByTestId("tamano-mas").click();
  await visible("tamano");
  await page.screenshot({ path: `${DIR}/${ID}-rendimiento-360x640.png` });
});

test("ed-5 el «?» del Taller explica el toque nuevo", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await abrirTaller(page);
  await expect(page.getByTestId("ayuda-taller")).toContainText("Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda.");
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-primera-vez-360x640.png` });
  await page.getByTestId("ayuda-boton").click();
  await expect(page.getByTestId("ayuda-panel")).toContainText("Toca un punto para elegirlo; arrástralo para darle forma. Con el punto elegido puedes ponerle una rueda.");
  await page.screenshot({ path: `${DIR}/${ID}-ayuda-panel-360x640.png` });
});

/** Caja del coche y lienzo deben coincidir: el canvas de Phaser tiene el alto del contenedor y todo lo dibujado cabe bajo la cabecera. */
async function comprobarEncuadre(page: Page, etiqueta: string) {
  await expect
    .poll(async () => {
      const c = await page.evaluate(() => {
        const cv = document.querySelector<HTMLCanvasElement>('[data-testid="lienzo"] canvas')!;
        const lz = document.querySelector<HTMLElement>('[data-testid="lienzo"]')!;
        return { canvas: cv.height, lienzo: lz.clientHeight };
      });
      // El alto del contenedor es fraccionario: clientHeight redondea y Phaser trunca, así que difieren como mucho 1 px.
      return Math.abs(c.canvas - c.lienzo) <= 1;
    }, { message: `${etiqueta}: canvas.height ≈ lienzo.clientHeight (±1 px)` })
    .toBe(true);
  await lienzoQuieto(page);
  const info = await page.evaluate(() => {
    const lz = document.querySelector<HTMLElement>('[data-testid="lienzo"]')!;
    const cab = document.querySelector(".taller .cabecera")!.getBoundingClientRect();
    const r = lz.getBoundingClientRect();
    const e = (window.__debug!.estado() as unknown as { tallerEncuadre: { cajaCochePx: { top: number; bottom: number; left: number; right: number } } }).tallerEncuadre;
    return { caja: e.cajaCochePx, cabeceraBottom: Math.max(0, cab.bottom - r.top), alto: lz.clientHeight, ancho: lz.clientWidth };
  });
  expect(info.caja.top, `${etiqueta}: bajo la cabecera`).toBeGreaterThanOrEqual(info.cabeceraBottom - 1);
  expect(info.caja.bottom, `${etiqueta}: dentro del lienzo`).toBeLessThanOrEqual(info.alto + 1);
  expect(info.caja.left, etiqueta).toBeGreaterThanOrEqual(-1);
  expect(info.caja.right, etiqueta).toBeLessThanOrEqual(info.ancho + 1);
}

for (const t of TAMANOS) {
  test(`ed-2 el lienzo encuadra el coche agrandado, con punto elegido y rueda nueva, bajo la cabecera @tamanos ${t.w}x${t.h}`, async ({ page }) => {
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    await tocarVertice(page, 3);
    await page.getByTestId("poner-rueda").click();
    await expect(page.getByTestId("contador-ruedas")).toHaveText("Ruedas: 3/4");
    await lienzoQuieto(page);
    const p = await (async () => {
      const enc = (await encuadre(page))!;
      const caja = (await page.locator("canvas").boundingBox())!;
      const v = (await estado(page)).genomaEnTaller!.body[1];
      return { x: caja.x + enc.origenPx.x + Math.cos(v.angle) * v.length * enc.escalaPxM, y: caja.y + enc.origenPx.y - Math.sin(v.angle) * v.length * enc.escalaPxM, dx: Math.cos(v.angle) * 40, dy: -Math.sin(v.angle) * 40 };
    })();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + p.dx, p.y + p.dy, { steps: 4 });
    await page.mouse.up();
    await page.getByTestId("tamano-mas").click();
    await page.getByTestId("tamano-mas").click();
    await comprobarEncuadre(page, "tras Tamaño +");
    await page.screenshot({ path: `${DIR}/${ID}-u07-encuadre-${t.w}x${t.h}.png` });
  });
}

test("ed-2 caso límite: punto a 2,5 m con rueda de 1,2 m y «Ver fuerzas» cabe en el lienzo a 820x1180", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await abrirTaller(page);
  await tocarVertice(page, 1);
  for (let i = 0; i < 12; i++) await page.getByTestId("longitud-mas").click();
  await page.getByTestId("poner-rueda").click();
  await page.getByTestId("ver-fuerzas").click();
  await comprobarEncuadre(page, "límite con fuerzas");
  await page.screenshot({ path: `${DIR}/${ID}-u09-limite-fuerzas-820x1180.png` });
});
