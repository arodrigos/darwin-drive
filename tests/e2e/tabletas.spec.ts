import { test, expect, type Page } from "@playwright/test";

const DIR = process.env.CAPTURAS_DIR ?? "test-results/capturas";
const ID = process.env.CAPTURAS_PREFIJO ?? "tabletas-1";

const TABLETAS = [
  { w: 820, h: 1180 },
  { w: 1180, h: 820 },
];
const BOTONES = ["ritmo-x1", "ritmo-x2", "ritmo-x4", "ritmo-x8", "ritmo-final"];

type Genoma = { body: { angle: number; length: number }[]; wheels: { vertex: number }[] };
type Estado = {
  genomaEnTaller: Genoma | null;
  distanciaLider: number | null;
  rankings: Record<string, { carId: string }[]>;
};
const estado = (page: Page) => page.evaluate(() => window.__debug!.estado() as unknown as Estado);

async function abrirTaller(page: Page) {
  await page.goto("/?pruebas=1");
  await page.waitForFunction(() => Boolean(window.__debug));
  await page.evaluate(() => window.__debug!.cargarEscenario({ vacio: true }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__debug));
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
  const s = Math.min(caja.width, caja.height) / 7;
  const v = g.body[i];
  return {
    x: caja.x + caja.width / 2 + Math.cos(v.angle) * v.length * s,
    y: caja.y + caja.height / 2 - Math.sin(v.angle) * v.length * s,
    cx: caja.x + caja.width / 2,
    cy: caja.y + caja.height / 2,
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


const sinScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const t of TABLETAS) {
  test(`tb-1 el recorrido principal funciona y se ve bien a ${t.w}x${t.h}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: t.w, height: t.h });
    await abrirTaller(page);
    const antes = (await estado(page)).genomaEnTaller!;
    await arrastrar(page, 1, (p) => {
      const d = Math.hypot(p.x - p.cx, p.y - p.cy);
      return { x: p.x + ((p.x - p.cx) / d) * 60, y: p.y + ((p.y - p.cy) / d) * 60 };
    });
    await tocar(page, 3);
    const g = (await estado(page)).genomaEnTaller!;
    expect(g.body[1].length).toBeGreaterThan(antes.body[1].length);
    expect(g.wheels.map((w) => w.vertex)).toContain(3);
    expect(await sinScroll(page)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-taller-${t.w}x${t.h}.png` });

    await page.getByTestId("selector-pista").click();
    await page.getByTestId("pista-rampa").click();
    await page.getByTestId("probar").click();
    await expect(page.getByTestId("pista")).toBeVisible();
    await expect.poll(async () => (await estado(page)).distanciaLider ?? 0, { timeout: 10_000 }).toBeGreaterThan(1);
    const tops: number[] = [];
    for (const id of BOTONES) tops.push((await page.getByTestId(id).boundingBox())!.y);
    for (const y of tops) expect(Math.abs(y - tops[0])).toBeLessThanOrEqual(2);
    expect(await sinScroll(page)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-pista-${t.w}x${t.h}.png` });

    await page.getByTestId("ritmo-final").click();
    await expect(page.getByTestId("tarjeta-fin")).toBeVisible({ timeout: 90_000 });
    const tarjeta = (await page.getByTestId("tarjeta-fin").boundingBox())!;
    expect(tarjeta.x).toBeGreaterThanOrEqual(0);
    expect(tarjeta.y).toBeGreaterThanOrEqual(0);
    expect(tarjeta.x + tarjeta.width).toBeLessThanOrEqual(t.w);
    expect(tarjeta.y + tarjeta.height).toBeLessThanOrEqual(t.h);
    await expect(page.getByTestId("fin-distancia")).toBeVisible();
    await expect(page.getByTestId("fin-tiempo")).toBeVisible();
    expect(await sinScroll(page)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-tarjeta-${t.w}x${t.h}.png` });

    // La marca queda guardada: tras recargar, La Rampa la enseña como n.º 1.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__debug));
    await page.getByTestId("tarjeta-rampa").click();
    await expect(page.getByTestId("rankings")).toBeVisible();
    const fila = page.getByTestId("fila-ranking").first();
    await expect(fila.getByTestId("fila-tiempo")).toBeVisible();
    await expect(fila.getByTestId("fila-estado")).toBeVisible();
    const hoy = await page.evaluate(() => new Date().toLocaleDateString());
    expect(hoy.length).toBeGreaterThan(0);
    await expect(fila.getByTestId("fila-fecha")).toBeVisible();
    const celdas: { x: number; w: number }[] = [];
    for (const id of ["fila-tiempo", "fila-estado", "fila-fecha"]) {
      const b = (await fila.getByTestId(id).boundingBox())!;
      celdas.push({ x: b.x, w: b.width });
    }
    // En columnas: cada celda empieza donde acaba la anterior, sin solaparse.
    for (let i = 1; i < celdas.length; i++) expect(celdas[i].x).toBeGreaterThanOrEqual(celdas[i - 1].x + celdas[i - 1].w - 0.5);
    expect((await estado(page)).rankings.rampa).toHaveLength(1);
    expect(await sinScroll(page)).toBe(true);
    await page.screenshot({ path: `${DIR}/${ID}-rankings-${t.w}x${t.h}.png` });
  });
}
